"""Copy a key from the local environment, .env or .env.local into Vercel as a Sensitive variable, without printing it.

Usage: uv run python scripts/push_env.py SOURCE_NAME TARGET_NAME production [preview]

The value goes to `vercel env add` on stdin only. Output from the CLI is shown with the value redacted.
"""

import subprocess
import sys

from _env import key

ALLOWED_TARGETS = {"production", "preview"}


def main() -> int:
    if len(sys.argv) < 4 or not set(sys.argv[3:]) <= ALLOWED_TARGETS:
        print(__doc__)
        return 2
    source, target_name, targets = sys.argv[1], sys.argv[2], sys.argv[3:]
    value = key(source)
    failed = 0
    for target in targets:
        result = subprocess.run(
            ["vercel", "env", "add", target_name, target, "--sensitive", "--yes"],
            input=value, text=True, capture_output=True,
        )
        out = (result.stdout + result.stderr).replace(value, "[redacted]")
        lines = [l for l in out.splitlines() if l.strip() and not l.startswith("Vercel CLI")]
        status = "ok" if result.returncode == 0 else f"FAILED (exit {result.returncode})"
        print(f"{target_name} -> {target}: {status}")
        if result.returncode != 0:
            failed += 1
            print("  " + "\n  ".join(lines[-6:]))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
