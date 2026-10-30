"""Lay the narration on the take: each line in .qloo/submission/voice/ at the start of its caption in take.json,
with its quiet trimmed and one loudness for all lines, and a look-ahead limiter on the few peaks above -2 dBFS
that the one gain brings. Then check the result from the encoded files themselves:
each line starts within 0.1 s of its caption and ends before the next caption starts, and the sound is as long as
the picture.

Writes next to the take, all ignored by git since the picture shows what Qloo returned:
common-ground-demo-narrated.mp4, common-ground-demo-narrated-no-captions.mp4, narration.wav, narration.json.

Usage: uv run python scripts/lay_voice.py
"""

import array
import json
import math
import re
import subprocess
import sys
import wave
from pathlib import Path

VIDEO = Path(".qloo/submission/video")
VOICE = Path(".qloo/submission/voice")
RATE = 48000
QUIET = 0.003  # -50 dBFS: a line's quiet ends at its first sample above this, and starts after its last
HEARD = 0.01  # -40 dBFS: what counts as speech in the encoded file, above the encoder's own noise
BEFORE, AFTER = 0.01, 0.05  # seconds kept before a line's first sound and after its last
TARGET_LUFS = -18.0  # every line is brought to this, by one gain each; at -16 the limiter acts on up to 8% of speech
LIMIT_DBFS = -2.0  # the limiter holds the peaks here; it compensates its own delay, so no line moves
CEILING_DBTP = -1.0  # what the encoded sound may reach, between samples included
PAIRS = (
    ("common-ground-demo.mp4", "common-ground-demo-narrated.mp4"),
    ("common-ground-demo-no-captions.mp4", "common-ground-demo-narrated-no-captions.mp4"),
)

checks = []


def check(name, ok, detail=""):
    checks.append({"name": name, "ok": bool(ok), "detail": detail})
    print(f"{'pass' if ok else 'FAIL'}  {name}{f'  ({detail})' if detail else ''}")


def samples(path):
    with wave.open(str(path)) as w:
        if (w.getframerate(), w.getnchannels(), w.getsampwidth()) != (RATE, 1, 2):
            sys.exit(f"{path}: not 48 kHz mono 16-bit")
        return array.array("h", w.readframes(w.getnframes()))


def loudness(pcm):
    """Integrated loudness (LUFS) and true peak (dBTP), by ffmpeg's EBU R128 meter."""
    err = subprocess.run(
        ["ffmpeg", "-nostats", "-hide_banner", "-f", "s16le", "-ar", str(RATE), "-ac", "1", "-i", "-",
         "-af", "ebur128=peak=true", "-f", "null", "-"],
        input=pcm.tobytes(), capture_output=True, check=True,
    ).stderr.decode()
    summary = err[err.rindex("Summary:"):]
    return float(re.search(r"I:\s+(-?[\d.]+) LUFS", summary)[1]), float(re.search(r"Peak:\s+(-?[\d.]+) dBFS", summary)[1])


def sounds(pcm, start, end, limit):
    """The first and last sample in [start, end) louder than limit, or None."""
    level = limit * 32768
    start, end = max(0, start), min(len(pcm), end)
    first = next((i for i in range(start, end) if abs(pcm[i]) > level), None)
    last = next((i for i in range(end - 1, start - 1, -1) if abs(pcm[i]) > level), None)
    return first, last


def stream(path, entry, kind):
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", kind, *(["-count_packets"] if entry == "nb_read_packets" else []),
         "-show_entries", f"stream={entry}", "-of", "csv=p=0", str(path)],
        capture_output=True, text=True, check=True,
    ).stdout.strip()
    return float(out) if entry == "duration" else int(out)


take = json.loads((VIDEO / "take.json").read_text())
captions = take["captions"]
files = sorted(VOICE.glob("line-[0-9][0-9].wav"))
if len(files) != len(captions):
    sys.exit(f"{len(files)} lines for {len(captions)} captions")
picture = stream(VIDEO / PAIRS[0][0], "duration", "v:0")
starts = [c["from"] for c in captions]
nexts = starts[1:] + [picture]

# Trim each line's quiet, then measure it.
lines = []
for path, start, nxt in zip(files, starts, nexts):
    pcm = samples(path)
    first, last = sounds(pcm, 0, len(pcm), QUIET)
    lead = min(first, round(BEFORE * RATE))
    cut = pcm[first - lead : min(len(pcm), last + 1 + round(AFTER * RATE))]
    lufs, peak = loudness(cut)
    lines.append({"file": path.name, "caption": start, "next": nxt, "pcm": cut, "lead": lead, "lufs": lufs, "peak": peak,
                  "speech": (last - first + 1) / RATE})

# One loudness for all lines. The track is built in floating point, so a peak the gain lifts past full scale is
# kept whole for the limiter rather than clipped.
target = TARGET_LUFS
track = array.array("f", bytes(4 * round(picture * RATE)))
for l in lines:
    l["gain"] = target - l["lufs"]
    k = 10 ** (l["gain"] / 20) / 32768
    scaled = array.array("f", (s * k for s in l["pcm"]))
    l["peak_after_gain"] = 20 * math.log10(max(abs(s) for s in scaled))
    at = round(l["caption"] * RATE) - l["lead"]
    l["end"] = l["caption"] + l["speech"]
    if at < 0 or at + len(scaled) > len(track):
        sys.exit(f"{l['file']} does not fit inside the picture")
    track[at : at + len(scaled)] = scaled

limited = array.array("h", subprocess.run(
    ["ffmpeg", "-loglevel", "error", "-f", "f32le", "-ar", str(RATE), "-ac", "1", "-i", "-",
     "-af", f"alimiter=limit={10 ** (LIMIT_DBFS / 20):.4f}:attack=5:release=50:level=0:latency=1", "-f", "s16le", "-"],
    input=track.tobytes(), capture_output=True, check=True,
).stdout)
if len(limited) != len(track):
    sys.exit(f"the limiter returned {len(limited)} samples for {len(track)}")
track = limited

with wave.open(str(VIDEO / "narration.wav"), "wb") as w:
    w.setnchannels(1)
    w.setsampwidth(2)
    w.setframerate(RATE)
    w.writeframes(track.tobytes())

for src, dst in PAIRS:
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-i", src, "-i", "narration.wav", "-map", "0:v:0", "-map", "1:a:0",
         "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", dst],
        cwd=VIDEO, check=True,
    )

# The checks, on what a viewer gets: the sound decoded from each encoded file.
for src, dst in PAIRS:
    out = VIDEO / dst
    print(f"\n{dst}")
    heard = array.array("h", subprocess.run(
        ["ffmpeg", "-loglevel", "error", "-i", str(out), "-map", "0:a:0", "-f", "s16le", "-ac", "1", "-ar", str(RATE), "-"],
        capture_output=True, check=True,
    ).stdout)
    for n, l in enumerate(lines, 1):
        first, last = sounds(heard, round((l["caption"] - 0.1) * RATE), round(l["next"] * RATE), HEARD)
        if first is None:
            check(f"line {n:02d} is heard", False)
            continue
        began, ended = first / RATE, last / RATE
        check(f"line {n:02d} starts within 0.1 s of its caption", abs(began - l["caption"]) <= 0.1,
              f"caption {l['caption']:.2f} s, speech {began:.2f} s")
        check(f"line {n:02d} ends before the next caption starts", l["end"] < l["next"] and abs(ended - l["end"]) <= 0.1,
              f"ends {ended:.2f} s, next {l['next']:.2f} s")
    video, audio = stream(out, "duration", "v:0"), stream(out, "duration", "a:0")
    check("the sound is as long as the picture", abs(audio - video) <= 1 / 30 and abs(video - picture) <= 1 / 30,
          f"picture {video:.3f} s, sound {audio:.3f} s")
    check("the picture is the take's, frame for frame",
          stream(out, "nb_read_packets", "v:0") == stream(VIDEO / src, "nb_read_packets", "v:0"))
    whole, top = loudness(heard)
    check("the sound is at one loudness, near the target", abs(whole - target) <= 1, f"{whole:.1f} LUFS, target {target:.1f}")
    check(f"the sound peaks at {CEILING_DBTP:.1f} dBTP or below", top <= CEILING_DBTP, f"{top:.1f} dBTP")

limits = [max(0.0, l["peak_after_gain"] - LIMIT_DBFS) for l in lines]
print(f"\nthe limiter: {sum(x > 0 for x in limits)} of {len(lines)} lines touched, by {max(limits):.1f} dB at most")
(VIDEO / "narration.json").write_text(json.dumps({
    "target_lufs": target,
    "limit_dbfs": LIMIT_DBFS,
    "encoded": {"lufs": whole, "true_peak_dbtp": top, "seconds": round(picture, 3)},
    "lines": [{"file": l["file"], "caption": round(l["caption"], 3), "speech_s": round(l["speech"], 3),
               "ends": round(l["end"], 3), "next": round(l["next"], 3), "gain_db": round(l["gain"], 2),
               "limited_db": round(max(0.0, l["peak_after_gain"] - LIMIT_DBFS), 2), "lufs_made": l["lufs"], "peak_made_dbtp": l["peak"]} for l in lines],
    "checks": checks,
}, indent=1))
sys.exit(0 if all(c["ok"] for c in checks) else 1)
