"""Before the repo goes public: look for real Qloo response data in the tracked files, in every past version of them
and in the commit messages. Qloo's guide: "Do not store Qloo response data in a public repository".

What counts as real is read from the private .qloo/ folder (raw responses, traces, saved plans):
  id     an entity id (any UUID seen there)
  tag    a tag id (urn:tag:kind:scope:slug)
  score  an affinity, score or popularity at full precision
  name   a name Qloo returned, or a card title from a real plan. Left out: what the family or a probe typed itself,
         tag names (plain words such as a genre), dishes and activities (the family's own words) and web results
It also lists every line of the notes (.md) that gives a figure from 0 to 1, and every line of code that speaks of
affinity and gives one, since a rounded figure cannot be matched against the raw data. Every hit is a candidate for
a person to judge: tests hold invented names on purpose, limits and caps are figures too, and Qloo sometimes returns
the same title an invented list already had.

The output quotes the matched text, so it is Qloo data too: keep it out of the repo, the bus and any issue.

Usage: uv run python scripts/scan_qloo_data.py           the files now, their history and the commit messages
       uv run python scripts/scan_qloo_data.py --tree    the files now only
       uv run python scripts/scan_qloo_data.py --new     only the lines added since origin/main (or --new <commit>),
                                                         and the messages of the commits not yet pushed. Run it
                                                         before every push: it is short enough to read in full
Exit 0 when nothing is found, 1 otherwise, 3 when there is no .qloo/ folder to compare with.
"""

import json
import re
import subprocess
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PRIVATE = ROOT / ".qloo"
UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", re.I)
TAG_ID = re.compile(r"urn:tag:[a-z0-9_]+:[a-z0-9_]+:[a-z0-9_]+", re.I)
FIGURE = re.compile(r"(?<![\d.$])0\.\d{2,}(?!\d)")  # a figure from 0 to 1 that is not a dollar amount
SKIP = {"package-lock.json"}
# Typed by us, so not Qloo's data even where Qloo gave the same words back: the sample family (lib/family.ts).
OURS = {"pedro infante", "roman holiday", "javier solis", "javier solís", "bad bunny", "spirited away", "san antonio", "texas"}
MIN_NAME = 4
# Written by a live test that runs on the invented Qloo data of tests/helpers.ts, so it holds nothing of Qloo's.
SYNTHETIC = {"gather-trace.json"}
OWN_WORDS = {"dish", "activity", "event"}  # card kinds that do not come from Qloo


def git(*args):
    return subprocess.run(["git", *args], cwd=ROOT, capture_output=True, check=True).stdout.decode("utf-8", "ignore")


def walk(node, found, typed):
    """Collects names, scores and what was typed from one parsed .qloo file."""
    if isinstance(node, dict):
        name = node.get("name")
        is_tag = any(str(node.get(k, "")).startswith("urn:tag") for k in ("id", "tag_id", "type", "subtype"))
        if isinstance(name, str) and is_tag:
            found["tag name"].add(name.strip().lower())
        elif isinstance(name, str) and (node.get("entity_id") or UUID.fullmatch(str(node.get("id", "")))):
            found["name"].add(name)
        if isinstance(node.get("title"), str) and node.get("kind") not in OWN_WORDS and "url" not in node:
            found["name"].add(node["title"])
        if isinstance(node.get("names"), list) and name != "web_search" and node.get("source") != "tavily":
            found["name"].update(n for n in node["names"] if isinstance(n, str))
        for key in ("affinity", "score", "popularity"):
            value = node.get(key)
            if isinstance(value, float) and len(repr(value)) >= 8:
                found["score"].add(repr(value))
        for key in ("query", "filter.query", "filter.location.query"):
            if isinstance(node.get(key), str):
                typed.add(node[key].lower())
        for value in node.values():
            walk(value, found, typed)
    elif isinstance(node, list):
        for value in node:
            walk(value, found, typed)
    elif isinstance(node, str) and node[:1] in "[{":
        # tool results and model arguments are JSON kept as text inside the traces
        try:
            walk(json.loads(node), found, typed)
        except ValueError:
            pass


def needles():
    found = defaultdict(set)
    typed = set(OURS)
    for path in sorted(PRIVATE.rglob("*")):
        if not path.is_file() or path.suffix not in {".json", ".jsonl", ".txt", ".log"} or path.name in SYNTHETIC:
            continue
        text = path.read_text("utf-8", "ignore")
        found["id"].update(m.lower() for m in UUID.findall(text))
        found["tag"].update(m.lower() for m in TAG_ID.findall(text))
        chunks = [text] if path.suffix == ".json" else [line.removeprefix("data: ") for line in text.splitlines()]
        for chunk in chunks:
            try:
                walk(json.loads(chunk), found, typed)
            except ValueError:
                continue
    def plain(name):
        return name.strip().strip(",.").lower()

    found["name"] = {n.strip() for n in found["name"] if len(n.strip()) >= MIN_NAME and plain(n) not in typed and plain(n) not in found["tag name"]}
    return found


def matcher(found):
    patterns = {}
    for kind in ("id", "tag", "score"):
        if found[kind]:
            patterns[kind] = re.compile("|".join(re.escape(v) for v in sorted(found[kind], key=len, reverse=True)), re.I)
    if found["name"]:
        names = "|".join(re.escape(v) for v in sorted(found["name"], key=len, reverse=True))
        patterns["name"] = re.compile(rf"(?<![\w]){'(?:' + names + ')'}(?![\w])", re.I)
    return patterns


def hits_in(text, patterns):
    out = set()
    for kind, pattern in patterns.items():
        out.update((kind, m.group(0)) for m in pattern.finditer(text))
    return out


def blobs(tree_only):
    """Every version of every tracked file: (blob id, path) with the commits that hold it, oldest first."""
    commits = ["HEAD"] if tree_only else git("log", "--all", "--reverse", "--format=%h").split()
    seen = defaultdict(list)
    for commit in commits:
        for line in git("ls-tree", "-r", commit).splitlines():
            meta, path = line.split("\t", 1)
            if meta.split()[1] == "blob" and Path(path).name not in SKIP:
                seen[(meta.split()[2], path)].append(commit)
    return seen


def scan_new(patterns, base):
    """Only what is not pushed yet: the lines added since the base, and the messages of the commits after it."""
    hits = 0
    path = ""
    for line in git("diff", base, "--unified=0", "--no-color", "--", ".", ":!package-lock.json").splitlines():
        if line.startswith("+++ "):
            path = line[6:]
        elif line.startswith("+"):
            for kind, value in sorted(hits_in(line[1:], patterns)):
                hits += 1
                print(f"{kind:5} {path}: {value!r} in: {line[1:].strip()[:140]}")
    for message in [m for m in git("log", f"{base}..HEAD", "--format=%h%x00%B%x01").split("\x01") if m.strip()]:
        commit, _, body = message.strip().partition("\x00")
        for kind, value in sorted(hits_in(body, patterns)):
            hits += 1
            print(f"{kind:5} (message of {commit}): {value!r}")
    print(f"scan_qloo_data: {hits} matches against .qloo/ in what was added since {base}")
    return 1 if hits else 0


def main():
    if not PRIVATE.is_dir():
        print("scan_qloo_data: no .qloo/ folder here, so there is nothing to compare with")
        return 3
    args = sys.argv[1:]
    tree_only = "--tree" in args
    found = needles()
    patterns = matcher(found)
    if "--new" in args:
        after = args[args.index("--new") + 1 :]
        return scan_new(patterns, after[0] if after else "origin/main")
    print("scan_qloo_data: comparing with " + ", ".join(f"{len(found[k])} {k}s" for k in ("id", "tag", "score", "name")))
    head = {line.split("\t", 1)[1]: line.split()[2] for line in git("ls-tree", "-r", "HEAD").splitlines()}

    rows = defaultdict(lambda: {"commits": set(), "now": False})
    figures = []
    for (blob, path), commits in blobs(tree_only).items():
        text = git("cat-file", "blob", blob)
        now = head.get(path) == blob
        for kind, value in hits_in(text, patterns):
            row = rows[(path, kind, value.lower())]
            row["commits"].update(commits)
            row["now"] = row["now"] or now
        if now:
            for number, line in enumerate(text.splitlines(), 1):
                # In the notes a figure can sit on the line after the word, so every figure there is listed.
                if FIGURE.search(line) and (path.endswith(".md") or re.search(r"affinit", line, re.I)):
                    figures.append((path, number, line.strip()[:160]))

    messages = [] if tree_only else [m for m in git("log", "--all", "--format=%h%x00%B%x01").split("\x01") if m.strip()]
    for message in messages:
        commit, _, body = message.strip().partition("\x00")
        for kind, value in hits_in(body, patterns):
            row = rows[("(commit message)", kind, value.lower())]
            row["commits"].add(commit)

    order = git("log", "--all", "--reverse", "--format=%h").split()
    for (path, kind, value), row in sorted(rows.items()):
        first = min(row["commits"], key=lambda c: order.index(c) if c in order else -1)
        where = "in the files now" if row["now"] else "in history only"
        print(f"{kind:5} {path}: {value!r} ({where}; first in {first}, {len(row['commits'])} commits)")
    for path, number, line in figures:
        print(f"figure {path}:{number}: {line}")
    print(f"scan_qloo_data: {len(rows)} matches against .qloo/, {len(figures)} lines with a figure from 0 to 1")
    return 1 if rows or figures else 0


if __name__ == "__main__":
    sys.exit(main())
