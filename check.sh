#!/usr/bin/env bash
# Offline gate (STACK_AND_GATE.md, layer 1). Free: no network calls to paid APIs, no keys needed.
# The Stop hook runs this after every turn. Exit 0 = pass, 1 = fail, 3 = blocked on something only Sonu can fix.
set -uo pipefail
cd "$(dirname "$0")"
export NEXT_TELEMETRY_DISABLED=1

failed=()
run() {
  local name="$1"
  shift
  echo "== $name"
  if ! "$@"; then
    failed+=("$name")
  fi
}

if [ ! -d node_modules ]; then
  echo "node_modules is missing: run npm ci"
  exit 1
fi

run "typecheck" npx tsc --noEmit
run "lint" npx eslint . --max-warnings=0
run "unit tests" npx vitest run
run "build" npx next build
run "secret scan: catches a planted copy of every key" uv run python scripts/scan_secrets.py --self-test
run "secret scan: repo" uv run python scripts/scan_secrets.py
# public/ is named here because the saved plan in it is ignored by git (Qloo data) but still deployed and served.
run "secret scan: build output and public files" uv run python scripts/scan_secrets.py .next/static .next/server public
run "deploys never upload .env" bash -c 'grep -qx ".env" .vercelignore && grep -qx ".env.\*" .vercelignore'
run "no keys in public variables" bash -c '! grep -rnE "NEXT_PUBLIC_[A-Z_]*(KEY|TOKEN|SECRET)" app lib --include="*.ts" --include="*.tsx"'

if [ ${#failed[@]} -gt 0 ]; then
  echo "check.sh: FAILED: ${failed[*]}"
  exit 1
fi
echo "check.sh: all passed"
