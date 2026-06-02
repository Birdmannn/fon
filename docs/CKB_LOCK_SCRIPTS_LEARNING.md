# Understanding CKB Lock Scripts, Type Scripts, and Transaction Validation

## Overview

This document captures key learnings about how CKB (Nervos Network) handles asset ownership, transaction validation, and the distinction between lock scripts, type scripts, and off-chain validation. It addresses common misconceptions when coming from Ethereum or other blockchain backgrounds.

---

## Core Concepts

### What is a Cell?

A **cell** is CKB's fundamental data structure - think of it as a box that can hold:
- **Capacity** (CKB tokens)
- **Data** (arbitrary bytes)
- **Lock Script** (who can spend it)
- **Type Script** (optional - what rules govern state transitions)

**Mental Model:** A cell is like a safe that holds value. The lock script is the lock on the safe, and the type script is the rulebook for what can be done with the contents.

---

## Lock Scripts vs Type Scripts

### Lock Script
**Purpose:** Controls **who** can spend a cell

**Question it answers:** "Is this person/entity authorized to unlock this cell?"

**Common examples:**
- Single signature lock: "Only the owner of this private key can spend"
- Multisig lock: "Requires 2 of 3 signatures"
- Timelock: "Can only be spent after block X"
- Passkey/WebAuthn lock: "Requires a valid passkey proof"
- Social recovery: "Owner can spend now, or 3 guardians after 30 days"

**When to use:** When the rule is about **authorization to spend**

---

### Type Script
**Purpose:** Controls **what** state transitions are valid

**Question it answers:** "Is this transformation from input cells to output cells valid?"

**Common examples:**
- Token conservation: "Input tokens must equal output tokens"
- State machine rules: "Status can only go from Created → Active → Completed"
- Approval requirements: "This state change requires 2 signatures"
- Business logic: "Certain fields must update in specific ways"

**When to use:** When the rule is about **valid transformation of state**

---

## The Three Layers of Validation

### 1. Off-Chain Client Code (Wallet/SDK)
**What it does:**
- Builds transactions
- Encodes data into proper formats
- Pre-validates before submission
- Provides UX feedback
- Simulates transaction outcomes

**What it CANNOT do:**
- Enforce rules at the network level
- Prevent other clients from bypassing your checks
- Provide real security guarantees

**Mental Model:** Your client code is like a form validator on a website - it helps users fill things out correctly, but someone can still bypass it and submit raw data.

**Example:**
```javascript
// This only prevents YOUR app from building invalid transactions
function validateTransaction(inputs, outputs) {
  if (!hasTwoSignatures(inputs)) {
    throw new Error("Need 2 signatures");
  }
  // ... build transaction
}
```

---

### 2. Lock Script (On-Chain Authorization)
**What it does:**
- Runs in CKB-VM during transaction verification
- Checks if the spender is authorized
- Reads script args (configuration) and witness (proof)
- Returns pass (0) or fail (non-zero)

**What it enforces:**
- Who can spend the cell
- What proof is required (signature, passkey, etc.)
- Authorization rules that apply universally

**Mental Model:** The lock script is the actual lock mechanism - CKB nodes execute it and reject transactions that don't satisfy it.

**Example flow:**
```
Cell created with lock:
  code_hash: 0xabc... (points to multisig script)
  hash_type: type
  args: [pubkeyA_hash, pubkeyB_hash, threshold=2]

Transaction spending it:
  witness: [sigA, sigB]

CKB verification:
  1. Load multisig script code from code_hash
  2. Run script in CKB-VM
  3. Script reads args → expects 2 signatures
  4. Script reads witness → finds sigA and sigB
  5. Script verifies both signatures
  6. Script returns 0 (success) or error
```

---

### 3. Type Script (On-Chain State Validation)
**What it does:**
- Runs in CKB-VM during transaction verification
- Validates input → output transformations
- Checks business logic and state transitions
- Can inspect all cells in its "type group"

**What it enforces:**
- Conservation laws (tokens in = tokens out)
- State machine rules
- Application-specific logic
- Multi-party approval for state changes

**Mental Model:** The type script is the rulebook that says "if you're changing this cell, here are the rules you must follow."

**Example flow:**
```
Input cell (type script attached):
  data: { status: "Created", balance: 100 }

Output cell (same type script):
  data: { status: "Active", balance: 100 }

Type script verification:
  1. Read all input cells with this type
  2. Read all output cells with this type
  3. Check: balance unchanged? ✓
  4. Check: valid status transition? ✓
  5. Check: required approvals in witness? ✓
  6. Return 0 (success)
```

---

## Script Components Explained

### Script Args
**What:** Fixed configuration stored with the cell

**Purpose:** Parameterize the script for this specific cell

**Examples:**
- Lock script args: pubkey hash, multisig threshold, guardian addresses
- Type script args: token ID, policy parameters

**Mental Model:** Args are like the serial number or configuration of the lock - they're set when the cell is created and don't change.

```rust
// Lock script args example
args: blake160(pubkey) // "This cell belongs to this key"

// Multisig args example  
args: [hash(pubkeyA), hash(pubkeyB), threshold: 2]
```

---

### Witness
**What:** Per-transaction proof data provided at spend time

**Purpose:** Provide the evidence needed to satisfy the script

**Examples:**
- Signatures
- Passkey proofs
- Multiple signatures for multisig
- Custom authorization data

**Mental Model:** The witness is like showing your ID and signature when you want to open the safe - it's the proof you provide each time.

```rust
// Simple signature witness
witness: [signature_bytes]

// Multisig witness
witness: [sigA, sigB, signer_bitmap]

// Custom witness
witness: [mode_byte, signature, recovery_proof, extra_data]
```

**Important:** Witnesses are just bytes at the protocol level. Your script defines what those bytes mean.

---

### Cell Data
**What:** Arbitrary data stored in the cell

**Purpose:** Hold state, tokens, or application data

**Examples:**
- Token balances
- NFT metadata
- Application state
- Campaign information

**Mental Model:** Cell data is what's inside the box - the actual content being protected and transformed.

---

## Transaction Verification Flow

### When a Transaction is Built (Client-Side)

**The wallet/app provides:**
1. **Inputs** - references to cells being spent
2. **Outputs** - new cells being created
3. **Output Data** - data for new cells
4. **Cell Deps** - references to script code cells
5. **Header Deps** - block headers if needed
6. **Witnesses** - proofs/signatures

**Example:**
```javascript
const tx = {
  inputs: [
    { previousOutput: { txHash: "0xabc...", index: 0 } }
  ],
  outputs: [
    {
      capacity: "100 CKB",
      lock: { codeHash: "0x...", hashType: "type", args: "0x..." },
      type: null
    }
  ],
  outputsData: ["0x"],
  cellDeps: [
    { outPoint: { txHash: "0xdef...", index: 0 }, depType: "code" }
  ],
  witnesses: ["0x5500..."] // signature
};
```

---

### When CKB Verifies (On-Chain)

**The node does:**
1. **Fetch** the actual input cells from chain state
2. **Load** script code from cell deps
3. **Group** inputs/outputs by script
4. **Execute** each lock script for inputs
5. **Execute** each type script for inputs and outputs
6. **Check** all scripts return success (0)

**What scripts can access:**
- Their own args
- The witness data
- All inputs and outputs in the transaction
- Cell deps and header deps
- Transaction structure

**Example lock script execution:**
```rust
// Pseudocode for what happens inside CKB-VM
fn verify_lock() -> i8 {
    let args = load_script_args(); // pubkey hash
    let witness = load_witness(); // signature
    let tx_hash = load_tx_hash();
    
    if verify_signature(witness, tx_hash, args) {
        return 0; // success
    } else {
        return 1; // failure
    }
}
```

---

## Common Misconceptions

### ❌ "I wrote validation in my client code, so the transaction will fail"
**Reality:** Your client code only prevents YOUR app from building invalid transactions. Other clients can bypass your checks.

**Fix:** Implement the rule in an on-chain script if it needs network-level enforcement.

---

### ❌ "Witnesses are like Ethereum ABI function parameters"
**Reality:** Witnesses are arbitrary proof data, not typed function parameters. CKB scripts don't expose named functions like `transfer(address, uint256)`.

**Better analogy:** Witnesses are like the payload you submit to satisfy a verification rule, not a function call.

---

### ❌ "The lock script is created by the wallet"
**Reality:** The lock script **code** is usually written by developers and deployed once. The wallet just **references** that code and provides args when creating cells.

**Example:** The standard secp256k1 lock exists once on-chain. Your wallet just says "use that lock with my pubkey hash as args."

---

### ❌ "Args and witnesses are the same thing"
**Reality:** 
- **Args** = fixed configuration stored with the cell
- **Witness** = per-transaction proof provided at spend time

**Example:** Args say "this cell belongs to Alice," witness provides Alice's signature.

---

### ❌ "Client-side validation is enough for security"
**Reality:** Client-side validation is only off-chain. For real security:
- Lock script = controls who can spend
- Type script = controls what transformations are valid

---

## The IDL Problem

### Why CKB Needs Interface Description

**The Challenge:**
CKB allows completely custom lock scripts, but wallets have no standard way to understand them.

**What a wallet sees:**
```
Lock script:
  code_hash: 0x1234abcd...
  hash_type: type
  args: 0x5678ef...
```

**What the wallet doesn't know:**
- What do these args mean?
- What witness format is expected?
- What proof type is needed (signature, passkey, multisig)?
- How should I present this to the user?

**The IDL Solution:**
An Interface Description Language (IDL) would provide machine-readable metadata:

```json
{
  "name": "2-of-3 Multisig Lock",
  "codeHash": "0x1234abcd...",
  "args": {
    "format": "fixed",
    "fields": [
      { "name": "pubkey1_hash", "type": "bytes20" },
      { "name": "pubkey2_hash", "type": "bytes20" },
      { "name": "pubkey3_hash", "type": "bytes20" },
      { "name": "threshold", "type": "uint8" }
    ]
  },
  "witness": {
    "format": "dynamic",
    "fields": [
      { "name": "signatures", "type": "bytes65[]" },
      { "name": "signer_bitmap", "type": "uint8" }
    ]
  },
  "description": "Requires any 2 of 3 signatures to unlock"
}
```

**Benefits:**
- Wallets can automatically support new locks
- Hardware signers know what to sign
- Explorers can display human-readable info
- Better UX for custom locks
- More composability across the ecosystem

---

## Practical Decision Tree

### "Where should my validation logic live?"

**Question 1: Is this about who can spend the cell?**
- Yes → **Lock Script**
- No → Go to Question 2

**Question 2: Is this about valid state transitions?**
- Yes → **Type Script**
- No → Go to Question 3

**Question 3: Is this just UX/preflight validation?**
- Yes → **Client code only** (but understand it's not enforced)
- No → Reconsider Questions 1-2

---

### Examples

**"Only Alice can spend this cell"**
→ **Lock Script** with Alice's pubkey hash in args

**"This cell requires 2 of 3 signatures"**
→ **Lock Script** (multisig) with 3 pubkey hashes and threshold in args

**"Token balance must be conserved"**
→ **Type Script** that checks input sum = output sum

**"Status can only go Created → Active → Completed"**
→ **Type Script** that validates state transitions

**"Don't let user submit without filling all fields"**
→ **Client code only** (UX validation)

**"This specific state change needs 2 approvals"**
→ **Type Script** that checks for 2 signatures in witness

---

## Key Takeaways

1. **CKB has three validation layers:**
   - Client code (off-chain, UX)
   - Lock Script (on-chain, authorization)
   - Type Script (on-chain, state transitions)

2. **Lock scripts control WHO, type scripts control WHAT**

3. **Script components serve different purposes:**
   - Args = configuration
   - Witness = proof
   - Cell Data = state

4. **Client validation ≠ Network enforcement**
   - Your client code can validate locally
   - Only on-chain scripts provide real security

5. **CKB scripts are programs, not function interfaces**
   - No ABI-style function calls
   - Scripts just run and return pass/fail
   - Witnesses are arbitrary bytes interpreted by your script

6. **The IDL problem is real**
   - Custom locks are powerful but hard for tools to understand
   - Standard interface descriptions would unlock massive composability

7. **When in doubt:**
   - Authorization → Lock Script
   - State validation → Type Script
   - UX/preflight → Client code

---

## Further Reading

- [CKB Transaction Structure](https://docs.nervos.org/docs/reference/transaction)
- [Script Programming Guide](https://docs.nervos.org/docs/script/intro)
- [Cell Model Explained](https://docs.nervos.org/docs/basics/concepts/cell-model)
- [Lock Script vs Type Script](https://docs.nervos.org/docs/basics/concepts/scripts)

---

*This document reflects learnings from building on CKB and understanding the distinction between client-side validation and on-chain enforcement.*
