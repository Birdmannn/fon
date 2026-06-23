# Testing / Inspection Commands

This note captures the useful commands we used while inspecting deployed freight contract cells and reclaiming locked capacity on CKB testnet.

---

## 1. Check whether a deployed contract cell is still live

### Fresh deployment
```bash
ckb-cli --url https://testnet.ckb.dev/rpc rpc get_live_cell \
  --tx-hash [TARGET_TX_HASH] \
  --index 0 \
  --output-format json
```

### Older default deployment
```bash
ckb-cli --url https://testnet.ckb.dev/rpc rpc get_live_cell \
  --tx-hash [TX_HASH] \
  --index 0 \
  --output-format json
```

If the result is:
- `"status": "live"` → the code cell still exists and can potentially be reclaimed
- `"status": "unknown"` → it has already been consumed

---

## 2. Inspect the owner/lock of an address

### Fresh deployment owner (`...h9`)
```bash
ckb-cli util address-info \
  --address [ADDRESS] \
  --output-format json
```

This corresponds to lock args:
- `[LOCK_ARGS]`

### Older address used in checks (`...mr`)
```bash
ckb-cli util address-info \
  --address ckt1qzda0cr08m85hc8jlnfp3zer7xulejywt49kt2rr0vthywaa50xwsqtej2453mtvaf4rg408apchmgkqjc5ywyqq5c7mr \
  --output-format json
```

This corresponds to different lock args:
- `[LOCK_ARGS]`

Use this to confirm whether a given address actually owns the target deployed contract cell.

---

## 3. Check the current frontend contract target

The current frontend contract reference is in:
- `frontend/lib/contract.ts`

That tells you which deployment the app is currently targeting.

---

## 4. Dry-run the reclaim helper script

### Fresh deployment dry run
```bash
scripts/reclaim-contract-cell.sh \
  --from-address [ADDRESS] \
  --from-account [ACCOUNT] \
  --to-address [TO_ADDRESS] \
  --rpc-url https://testnet.ckb.dev/rpc \
  --capacity 121877.99 \
  --dry-run
```

This:
- verifies the target cell is live
- verifies the target cell lock args match the expected owner
- builds the reclaim transaction
- signs it
- does **not** broadcast it

---

## 5. Understanding capacity

The live cell RPC returns capacity in **shannons**.

Example:
- `0xb15b17d5600`

Convert using:
- `1 CKB = 100,000,000 shannons`

So:
- `0xb15b17d5600`
- = `12187800000000` shannons
- = `121878.00000000 CKB`

That is why the reclaim output was set slightly lower, e.g.:
- `121877.99`

leaving room for the transaction fee.

---

## 6. Final reclaim command

For the fresh deployment owned by the `...h9` address, the final reclaim command is:

```bash
scripts/reclaim-contract-cell.sh \
  --from-address [ADDRESS] \
  --from-account [ADDRESS] \
  --to-address [TO_ADDRESS] \
  --rpc-url https://testnet.ckb.dev/rpc \
  --capacity 121877.99
```

---

## 7. Post-reclaim verification

### Check the old cell is gone
```bash
ckb-cli --url https://testnet.ckb.dev/rpc rpc get_live_cell \
  --tx-hash [RECLAIMED_TX_HASH] \
  --index 0 \
  --output-format json
```

Expected result after successful reclaim:
- `"cell": null`
- `"status": "unknown"`

### Check current balance
```bash
ckb-cli --url https://testnet.ckb.dev/rpc wallet get-capacity \
  --address [ADDRESS]
```

---

## 8. Safety reminder

Only reclaim a contract/code cell if:
- you are sure you no longer need that deployment
- the frontend/scripts are not meant to keep using that outpoint
- the owner address/lock args match the account you are signing with
