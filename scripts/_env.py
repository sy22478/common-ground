"""Load API keys from the environment or the ignored .env file. Never print them."""

import os
from pathlib import Path

ENV_FILE = Path(__file__).resolve().parent.parent / ".env"
ENV_FILES = [ENV_FILE, ENV_FILE.with_name(".env.local")]


def key(name: str) -> str:
    value = os.environ.get(name)
    if value:
        return value
    for env_file in ENV_FILES:
        if not env_file.exists():
            continue
        for line in env_file.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            if k.strip() == name:
                v = v.strip().strip('"').strip("'")
                if v:
                    return v
    raise SystemExit(f"{name} is not set (environment or .env)")


def redact(text: str, *names: str) -> str:
    """Remove any key value from text before it is printed or saved."""
    for name in names:
        try:
            value = key(name)
        except SystemExit:
            continue
        text = text.replace(value, "[redacted]")
    return text
