#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/deploy.sh --from-address <ckt1...> [options]

Options:
  --from-address <address>   Address used for deploy gen-txs (required)
  --from-account <account>   Account used for sign-txs (defaults to --from-address)
  --profile <default|fresh>  Deployment profile (default: default)
  --rpc-url <url>            CKB RPC URL (default: https://testnet.ckb.dev/rpc)
  --skip-build               Skip rebuilding build/release/freight before deploy
  -h, --help                 Show this help

Examples:
  scripts/deploy.sh --profile fresh --from-address ckt1... --from-account ckt1...
  scripts/deploy.sh --from-address ckt1...
EOF
}

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

PROFILE="default"
RPC_URL="${RPC_URL:-https://testnet.ckb.dev/rpc}"
FROM_ADDRESS=""
FROM_ACCOUNT=""
SKIP_BUILD=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --from-address) FROM_ADDRESS="$2"; shift 2 ;;
    --from-account) FROM_ACCOUNT="$2"; shift 2 ;;
    --profile) PROFILE="$2"; shift 2 ;;
    --rpc-url) RPC_URL="$2"; shift 2 ;;
    --skip-build) SKIP_BUILD=1; shift ;;
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

case "$PROFILE" in
  default)
    DEPLOY_TOML="deployment/deploy.toml"
    MIGRATION_DIR="deployment/migration"
    INFO_FILE="deployment/txs/deploy-info.json"
    ;;
  fresh)
    DEPLOY_TOML="deployment/deploy-fresh.toml"
    MIGRATION_DIR="deployment/migration-fresh"
    INFO_FILE="deployment/txs/deploy-fresh-info.json"
    ;;
  *)
    echo "Error: unsupported profile '$PROFILE' (expected default or fresh)" >&2
    exit 1
    ;;
esac

mkdir -p build/release deployment/txs "$MIGRATION_DIR"

if [[ "$SKIP_BUILD" -eq 0 ]]; then
  echo "==> Building freight contract"
  make -e -C contracts/freight build "TOP=${REPO_ROOT}/" BUILD_DIR=build/release MODE=release
fi

echo "==> Generating deployment transactions"
ckb-cli --url "$RPC_URL" deploy gen-txs \
  --from-address "$FROM_ADDRESS" \
  --deployment-config "$DEPLOY_TOML" \
  --info-file "$INFO_FILE" \
  --migration-dir "$MIGRATION_DIR"

echo "==> Signing deployment transactions"
ckb-cli --url "$RPC_URL" deploy sign-txs \
  --add-signatures \
  --from-account "$FROM_ACCOUNT" \
  --info-file "$INFO_FILE"

echo "==> Applying deployment transactions"
ckb-cli --url "$RPC_URL" deploy apply-txs \
  --info-file "$INFO_FILE" \
  --migration-dir "$MIGRATION_DIR"

echo "==> Deployment flow complete"
echo "    info file: $INFO_FILE"
echo "    migration dir: $MIGRATION_DIR"