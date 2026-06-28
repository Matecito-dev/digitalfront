#!/usr/bin/env bash
# Tras tests o al terminar el agente: libera viewer-server / vitest huérfanos.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
npm run test:cleanup --silent 2>/dev/null || npx tsx scripts/test-cleanup.ts 2>/dev/null || true
exit 0
