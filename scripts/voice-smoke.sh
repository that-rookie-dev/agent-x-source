#!/usr/bin/env bash
# Voice smoke checks — run against a live Agent-X server.
# Usage:
#   ./scripts/voice-smoke.sh
#   AGENTX_TOKEN=... ./scripts/voice-smoke.sh
#   AGENTX_BASE=http://127.0.0.1:3000 AGENTX_TOKEN=... ./scripts/voice-smoke.sh

set -euo pipefail

BASE="${AGENTX_BASE:-http://127.0.0.1:3000}"
TOKEN="${AGENTX_TOKEN:-}"

pass() { printf '✓ %s\n' "$1"; }
fail() { printf '✗ %s\n' "$1"; exit 1; }

echo "Voice smoke test → ${BASE}"

# 1. Health (public)
code=$(curl -s -o /dev/null -w '%{http_code}' "${BASE}/api/health" || true)
[[ "$code" == "200" ]] && pass "GET /api/health" || fail "GET /api/health (got ${code})"

# 2. Voice endpoints must reject unauthenticated requests
for path in /api/voice/capabilities /api/voice/assets /api/voice/assets/installed; do
  code=$(curl -s -o /dev/null -w '%{http_code}' "${BASE}${path}" || true)
  [[ "$code" == "401" ]] && pass "unauthenticated ${path} → 401" || fail "expected 401 for ${path}, got ${code}"
done

# 3. Authenticated voice capabilities (optional)
if [[ -n "$TOKEN" ]]; then
  body=$(curl -s -H "Authorization: Bearer ${TOKEN}" "${BASE}/api/voice/capabilities" || true)
  echo "$body" | grep -q '"capabilities"' && pass "authenticated /api/voice/capabilities" || fail "authenticated capabilities response invalid"
else
  echo "• skip authenticated checks (set AGENTX_TOKEN to enable)"
fi

# 4. WebSocket path exists (connection may fail without token — expect upgrade or 401, not 404)
ws_code=$(curl -s -o /dev/null -w '%{http_code}' \
  -H 'Connection: Upgrade' -H 'Upgrade: websocket' \
  -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' \
  "${BASE}/ws/voice" || true)
[[ "$ws_code" != "404" ]] && pass "WS /ws/voice reachable (HTTP ${ws_code})" || fail "WS /ws/voice returned 404"

echo ""
echo "Smoke checks complete. For full manual QA:"
echo "  • Desktop: grant mic from chat pre-prompt; verify DockingStation → Talk now"
echo "  • Telegram: send voice note with channels mode = voice-notes"
echo "  • Chat: push-to-talk, filler audio, final spoken reply"
