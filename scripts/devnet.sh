#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/devnet.sh <start|stop|clean> [options]

Commands:
  start   Initialize/run a local CKB devnet node and deploy the freight contract
  stop    Stop the local CKB devnet node/miner started by this script
  clean   Stop devnet and remove local devnet data + pid files

Options:
  --devnet-dir <path>        Devnet working directory (default: .devnet)
  --rpc-url <url>            Local RPC URL (default: http://127.0.0.1:8114)
  --ckb-bin <path>           Path to the ckb node binary (optional)
  --from-address <ckt1...>   Address used for deployment (required for start)
  --from-account <ckt1...>   Account used for signing (defaults to --from-address)
  --skip-deploy              Start node/miner without deploying the contract

Examples:
  scripts/devnet.sh start --from-address ckt1...
  scripts/devnet.sh stop
  scripts/devnet.sh clean --devnet-dir /tmp/freight-devnet
EOF
}

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

COMMAND="${1:-}"
if [[ -z "$COMMAND" ]]; then
  usage >&2
  exit 1
fi
shift || true

DEVNET_DIR="${DEVNET_DIR:-$REPO_ROOT/.devnet}"
RPC_URL="${RPC_URL:-http://127.0.0.1:8114}"
CKB_BIN="${CKB_BIN:-}"
FROM_ADDRESS=""
FROM_ACCOUNT=""
SKIP_DEPLOY=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --devnet-dir) DEVNET_DIR="$2"; shift 2 ;;
    --rpc-url) RPC_URL="$2"; shift 2 ;;
    --ckb-bin) CKB_BIN="$2"; shift 2 ;;
    --from-address) FROM_ADDRESS="$2"; shift 2 ;;
    --from-account) FROM_ACCOUNT="$2"; shift 2 ;;
    --skip-deploy) SKIP_DEPLOY=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage >&2; exit 1 ;;
  esac
done

FROM_ACCOUNT="${FROM_ACCOUNT:-$FROM_ADDRESS}"
NODE_PID_FILE="$DEVNET_DIR/ckb.pid"
MINER_PID_FILE="$DEVNET_DIR/ckb-miner.pid"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Error: required command '$1' not found in PATH" >&2
    exit 1
  fi
}

resolve_ckb_bin() {
  if [[ -n "$CKB_BIN" ]]; then
    if [[ ! -x "$CKB_BIN" ]]; then
      echo "Error: --ckb-bin '$CKB_BIN' is not executable" >&2
      exit 1
    fi
    return
  fi

  if command -v ckb >/dev/null 2>&1; then
    CKB_BIN="$(command -v ckb)"
    return
  fi

  local candidate
  while IFS= read -r candidate; do
    if [[ -x "$candidate" ]]; then
      CKB_BIN="$candidate"
      return
    fi
  done < <(find "$HOME" -maxdepth 5 -type f -name ckb 2>/dev/null)

  echo "Error: required command 'ckb' not found in PATH. Re-run with --ckb-bin /path/to/ckb" >&2
  exit 1
}

start_devnet() {
  resolve_ckb_bin
  require_cmd ckb-cli
  require_cmd cargo
  require_cmd rustc

  mkdir -p "$DEVNET_DIR"

  if [[ ! -f "$DEVNET_DIR/ckb.toml" ]]; then
    echo "==> Initializing local CKB dev chain in $DEVNET_DIR"
    "$CKB_BIN" init --chain dev --ba-advanced --force "$DEVNET_DIR"
  fi

  if [[ -f "$NODE_PID_FILE" ]] && kill -0 "$(cat "$NODE_PID_FILE")" 2>/dev/null; then
    echo "==> Devnet node already running (pid $(cat "$NODE_PID_FILE"))"
  else
    echo "==> Starting devnet node"
    nohup "$CKB_BIN" run --config "$DEVNET_DIR/ckb.toml" --data-dir "$DEVNET_DIR/data" > "$DEVNET_DIR/ckb.log" 2>&1 &
    echo $! > "$NODE_PID_FILE"
  fi

  if [[ -f "$MINER_PID_FILE" ]] && kill -0 "$(cat "$MINER_PID_FILE")" 2>/dev/null; then
    echo "==> Devnet miner already running (pid $(cat "$MINER_PID_FILE"))"
  else
    echo "==> Starting devnet miner"
    nohup "$CKB_BIN" miner --config "$DEVNET_DIR/ckb.toml" --data-dir "$DEVNET_DIR/data" > "$DEVNET_DIR/ckb-miner.log" 2>&1 &
    echo $! > "$MINER_PID_FILE"
  fi

  echo "==> Waiting for local RPC to become ready"
  for _ in $(seq 1 30); do
    if ckb-cli --url "$RPC_URL" rpc get_tip_block_number >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done

  if ! ckb-cli --url "$RPC_URL" rpc get_tip_block_number >/dev/null 2>&1; then
    echo "Error: local RPC did not become ready at $RPC_URL" >&2
    exit 1
  fi

  echo "==> Devnet ready at $RPC_URL"

  if [[ "$SKIP_DEPLOY" -eq 0 ]]; then
    if [[ -z "$FROM_ADDRESS" ]]; then
      echo "Error: --from-address is required unless --skip-deploy is used" >&2
      exit 1
    fi

    echo "==> Deploying freight contract to local devnet"
    ./scripts/deploy.sh \
      --profile fresh \
      --rpc-url "$RPC_URL" \
      --from-address "$FROM_ADDRESS" \
      --from-account "$FROM_ACCOUNT"
  fi
}

stop_devnet() {
  for pid_file in "$MINER_PID_FILE" "$NODE_PID_FILE"; do
    if [[ -f "$pid_file" ]]; then
      pid="$(cat "$pid_file")"
      if kill -0 "$pid" 2>/dev/null; then
        echo "==> Stopping process $pid"
        kill "$pid" || true
      fi
      rm -f "$pid_file"
    fi
  done
}

clean_devnet() {
  stop_devnet
  echo "==> Removing devnet directory $DEVNET_DIR"
  rm -rf "$DEVNET_DIR"
}

case "$COMMAND" in
  start) start_devnet ;;
  stop) stop_devnet ;;
  clean) clean_devnet ;;
  *) echo "Unknown command: $COMMAND" >&2; usage >&2; exit 1 ;;
esac
