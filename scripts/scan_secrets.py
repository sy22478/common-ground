"""Fail if any real key value appears in a tracked or staged file. Prints file and key names only, never values.

Usage: uv run python scripts/scan_secrets.py [extra paths, e.g. a build output folder]
       uv run python scripts/scan_secrets.py --self-test
"""

import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

from _env import ENV_FILES

NAMES = ("QLOO_API_KEY", "NEBIUS_API_KEY", "TAVILY_API_KEY", "HASH_SECRET", "KV_REST_API_TOKEN", "UPSTASH_REDIS_REST_TOKEN", "VERCEL_OIDC_TOKEN",
         "KV_REST_API_READ_ONLY_TOKEN", "KV_URL", "REDIS_URL")
# A key saved under a name not listed above is still checked if its name looks like a secret.
SECRET_NAME = re.compile(r"KEY|TOKEN|SECRET|PASSWORD")
ROOT = Path(__file__).resolve().parent.parent


def values():
    """Every distinct value of each key: the environment, .env and .env.local can each hold a different one."""
    found = [(n, os.environ[n]) for n in NAMES if os.environ.get(n)]
    for env_file in ENV_FILES:
        if not env_file.exists():
            continue
        for line in env_file.read_text().splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                k, v = line.split("=", 1)
                pair = (k.strip().removeprefix("export ").strip(), v.strip().strip('"').strip("'"))
                if (pair[0] in NAMES or SECRET_NAME.search(pair[0])) and pair not in found:
                    found.append(pair)
    return [(n, v) for n, v in found if len(v) >= 8]


def files(extra):
    out = subprocess.run(["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
                         cwd=ROOT, capture_output=True, check=True).stdout.decode().split("\0")
    paths = [ROOT / p for p in out if p]
    for e in extra:
        p = Path(e)
        paths += [x for x in p.rglob("*") if x.is_file()] if p.is_dir() else [p]
    return paths


def scan(paths, secrets):
    hits = []
    for path in paths:
        try:
            text = path.read_bytes().decode("utf-8", "ignore")
        except (FileNotFoundError, IsADirectoryError):
            continue
        for name, value in secrets:
            if value in text:
                hits.append((path, name))
    return hits


def names(secrets):
    return ", ".join(dict.fromkeys(n for n, _ in secrets))


def self_test():
    """The path that must fail: plant each key value in a private temporary file outside the repo and require the scan
    to name it. Shows that a key added since the last run (the Qloo key, 2026-10-11) is really covered."""
    secrets = values()
    if not secrets:
        print("scan_secrets self-test: no key values available; nothing to plant")
        return
    problems = []
    with tempfile.TemporaryDirectory() as tmp:
        clean = Path(tmp) / "clean.txt"
        clean.write_text("X-Api-Key: [redacted]\n")
        if scan([clean], secrets):
            problems.append("a clean file was flagged")
        for i, (name, value) in enumerate(secrets):
            planted = Path(tmp) / f"planted-{i}.txt"
            planted.write_text(f"X-Api-Key: {value}\n")
            if (planted, name) not in scan([planted], secrets):
                problems.append(f"a planted {name} was not caught")
            planted.unlink()
    if problems:
        print("scan_secrets self-test: FAIL\n" + "\n".join(problems))
        sys.exit(1)
    print(f"scan_secrets self-test: ok (planted and caught: {names(secrets)})")


def main():
    if sys.argv[1:] == ["--self-test"]:
        return self_test()
    secrets = values()
    if not secrets:
        print("scan_secrets: no key values available to compare; nothing was checked")
    hits = scan(files(sys.argv[1:]), secrets)
    if hits:
        print("scan_secrets: FAIL\n" + "\n".join(
            f"{path.relative_to(ROOT) if path.is_relative_to(ROOT) else path}: contains {name}" for path, name in hits))
        sys.exit(1)
    print(f"scan_secrets: ok ({len(secrets)} key values checked against tracked, staged and untracked files: {names(secrets)})")


if __name__ == "__main__":
    main()
