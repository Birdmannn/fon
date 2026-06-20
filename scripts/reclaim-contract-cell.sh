#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/reclaim-contract-cell.sh --from-address <ckt1...> [options]

Builds a simple transaction that spends a previously deployed freight contract
code cell back to a normal sighash address, reclaiming the locked capacity.

Options:
  --from-address <address>   Address that owns/signs the contract cell input (required)
  --from-account <account>   Account used for signing (defaults to --from-address)
  --to-address <address>     Address that receives the reclaimed capacity (defaults to --from-address)
  --tx-hash <hash>           Contract cell tx hash (default: current fresh deployment)
  --index <index>            Contract cell output index (default: 0)
  --capacity <ckb>           Output capacity in CKB (default: derive from live cell)
  --rpc-url <url>            CKB RPC URL (default: https://testnet.ckb.dev/rpc)
  --expected-lock-args <hex> Expected lock args for safety check (default: fresh deployment owner)
  --tx-file <path>           Temporary tx file path (default: /tmp/freight-reclaim-tx.json)
  --dry-run                  Generate and inspect only; do not broadcast
  -h, --help                 Show this help

Example:
  scripts/reclaim-contract-cell.sh \
    --from-address ckt1... \
    --from-account ckt1... \
    --to-address ckt1... \
    --dry-run
EOF
}

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

RPC_URL="${RPC_URL:-https://testnet.ckb.dev/rpc}"
FROM_ADDRESS=""
FROM_ACCOUNT=""
TO_ADDRESS=""
TX_HASH="0x22b114ce2919255d7c815e82cfd712d7041ab990aa576dd0ab1f95582cca8bb2"
INDEX="0"
EXPECTED_LOCK_ARGS="0x8da4d7725a1fc36984f5d3b81ddaa148b80aca84"
TX_FILE="/tmp/freight-reclaim-tx.json"
CAPACITY_CKB=""
DRY_RUN=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --from-address) FROM_ADDRESS="$2"; shift 2 ;;
    --from-account) FROM_ACCOUNT="$2"; shift 2 ;;
    --to-address) TO_ADDRESS="$2"; shift 2 ;;
    --tx-hash) TX_HASH="$2"; shift 2 ;;
    --index) INDEX="$2"; shift 2 ;;
    --capacity) CAPACITY_CKB="$2"; shift 2 ;;
    --rpc-url) RPC_URL="$2"; shift 2 ;;
    --expected-lock-args) EXPECTED_LOCK_ARGS="$2"; shift 2 ;;
    --tx-file) TX_FILE="$2"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage >&2; exit 1 ;;
  esac
done

if [[ -z "$FROM_ADDRESS" ]]; then
  echo "Error: --from-address is required" >&2
  usage >&2
  exit 1
fi

FROM_ACCOUNT="${FROM_ACCOUNT:-$FROM_ADDRESS}"
TO_ADDRESS="${TO_ADDRESS:-$FROM_ADDRESS}"

TMP_CELL_JSON="$(mktemp)"
cleanup() {
  rm -f "$TMP_CELL_JSON"
}
trap cleanup EXIT

ckb-cli --url "$RPC_URL" rpc get_live_cell \
  --tx-hash "$TX_HASH" \
  --index "$INDEX" \
  --output-format json \
  > "$TMP_CELL_JSON"

python3 - <<'PY' "$TMP_CELL_JSON" "$TX_HASH" "$INDEX" "$CAPACITY_CKB" "$EXPECTED_LOCK_ARGS"
import json
import sys
from pathlib import Path

cell_path = Path(sys.argv[1])
expected_tx = sys.argv[2]
expected_index = sys.argv[3]
override_capacity = sys.argv[4]
expected_lock_args = sys.argv[5].lower()
obj = json.loads(cell_path.read_text())
if obj.get("status") != "live":
    raise SystemExit(f"Target cell {expected_tx}#{expected_index} is not live (status={obj.get('status')})")
cell = obj.get("cell") or {}
out = cell.get("output") or {}
capacity_hex = out.get("capacity")
if capacity_hex is None:
    raise SystemExit("Live cell response did not include capacity")
lock = out.get("lock") or {}
lock_args = (lock.get("args") or "").lower()
if expected_lock_args and lock_args != expected_lock_args:
    raise SystemExit(f"Target cell lock args {lock_args} did not match expected {expected_lock_args}")
capacity_ckb = int(capacity_hex, 16) / 100_000_000
print(f"Target live cell capacity: {capacity_ckb:.8f} CKB", file=sys.stderr)
print(f"Target live cell lock args: {lock_args}", file=sys.stderr)
if not override_capacity:
    print(f"{capacity_ckb:.8f}")
PY

if [[ -z "$CAPACITY_CKB" ]]; then
  CAPACITY_CKB="$(python3 - <<'PY' "$TMP_CELL_JSON"
import json, sys
from pathlib import Path
obj = json.loads(Path(sys.argv[1]).read_text())
capacity_hex = obj["cell"]["output"]["capacity"]
print(f"{int(capacity_hex, 16) / 100_000_000:.8f}")
PY
)"
fi

CKB_CLI_TX=(ckb-cli --url "$RPC_URL" tx)

rm -f "$TX_FILE"
"${CKB_CLI_TX[@]}" init --tx-file "$TX_FILE"
"${CKB_CLI_TX[@]}" add-input \
  --tx-hash "$TX_HASH" \
  --index "$INDEX" \
  --tx-file "$TX_FILE"
"${CKB_CLI_TX[@]}" add-output \
  --to-sighash-address "$TO_ADDRESS" \
  --capacity "$CAPACITY_CKB" \
  --tx-file "$TX_FILE"

echo "==> Reclaim transaction info"
"${CKB_CLI_TX[@]}" info --tx-file "$TX_FILE"

echo "==> Signing reclaim transaction"
"${CKB_CLI_TX[@]}" sign-inputs \
  --add-signatures \
  --from-account "$FROM_ACCOUNT" \
  --tx-file "$TX_FILE"

if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "==> Dry run only; signed reclaim transaction saved to $TX_FILE"
  exit 0
fi

echo "==> Sending reclaim transaction"
"${CKB_CLI_TX[@]}" send --tx-file "$TX_FILE"

echo "==> Reclaim transaction sent"
echo "    tx file: $TX_FILE"
