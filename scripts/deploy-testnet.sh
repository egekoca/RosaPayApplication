#!/usr/bin/env bash
set -euo pipefail

: "${ROSAPAY_DEPLOYER:?Set ROSAPAY_DEPLOYER to a configured Stellar CLI identity}"
: "${ROSAPAY_ADMIN:?Set ROSAPAY_ADMIN to the admin G- or C-address}"
: "${ROSAPAY_XLM_SAC:?Set ROSAPAY_XLM_SAC to the verified Testnet native SAC address}"

stellar_config_args=()
if [[ -n "${ROSAPAY_STELLAR_CONFIG_DIR:-}" ]]; then
  stellar_config_args+=(--config-dir "$ROSAPAY_STELLAR_CONFIG_DIR")
fi

stellar contract build --manifest-path contracts/Cargo.toml
stellar contract deploy \
  "${stellar_config_args[@]}" \
  --wasm contracts/target/wasm32v1-none/release/rosapay_settlement.wasm \
  --source-account "$ROSAPAY_DEPLOYER" \
  --network testnet \
  -- \
  --admin "$ROSAPAY_ADMIN" \
  --initial_asset "$ROSAPAY_XLM_SAC"
