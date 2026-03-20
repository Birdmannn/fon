# CKB Constructor Pattern & Type Script Args

## CKB's "constructor" IS the type script args

In CKB there is no separate deploy-then-construct step. The pattern is:

1. **Deploy the binary once** — the contract code (`freight`) lives in a cell. Its hash is the "class identity".
2. **Create a campaign cell** with that binary set as the type script, and pass `[admin_address][admin_pubkey]` as the **type script args** at creation time.

Those args are **permanently bound to that cell**. Nobody can mutate them. If you spend (consume) the cell, the cell is gone. If a new cell is created with the same script code but different args, it is a *different* contract instance. This is exactly the constructor pattern — it just lives in the args instead of separate storage.

So **no hardcoding needed**. The args ARE the immutable constructor.

---

## Type script args layout (fixed)

`main.rs` keeps the selector at `args[0]`. The constructor args (admin identity) sit
immediately after, followed by any instruction-specific data:

```
args[0]        = selector                  (1 byte,  read by main.rs)
args[1..21]    = admin_address             (20 bytes, constructor arg, index = 1)
args[21..54]   = admin_pubkey              (33 bytes, constructor arg, index = 21)
args[54..]     = instruction-specific data (varies per operation)
```

For `verify_participant` (selector = 3):
```
args[0]        = 3
args[1..21]    = admin_address
args[21..54]   = admin_pubkey
args[54..119]  = signature (65 bytes)   ← instruction_args[53..118]
```

`get_admin_address(index)` and `get_admin_pubkey(index)` both call `load_script()` and
read from the full type script args starting at the given `index`. This keeps the
constructor data cleanly separated while allowing each instruction to specify exactly
where in the args its admin fields live.

`AddressKey::Admin(usize)` carries the index directly, e.g.
`extract_caller_address(AddressKey::Admin(1))` → calls `get_admin_address(1)` → reads
`args[1..21]`.

---

## The real trust question

Anyone can create a cell using the freight binary as a type script with *their own* pubkey as args and call it a "campaign". The contract code enforces rules internally, but it cannot prevent someone from instantiating it with arbitrary args.

The off-chain indexer / front-end must filter campaigns by checking:
- The type script **code hash** matches the known deployed freight binary, AND
- The **admin_address** in `args[0..20]` matches a known trusted admin

This is the standard CKB trust model: the code is trusted, the args define the instance.

---

## TODO

- Write a full `verify_participant` success test once a real secp256k1 admin key pair is available for signing
- Implement `distribute()` and call `extract_caller_address(AddressKey::Admin(1))` to enforce admin-only access
