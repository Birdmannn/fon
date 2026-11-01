# Fresh testnet payout deployment

Reclaim confirmed: `0xf0ae7209a36629eecb41f3caf8d3f09283ab3be877b091a4dc9f28fa1780e1a9`. Returned 167,693.99 CKB after a 0.01 CKB fee.

Old deployment archived in `deployment/archive-fresh-20261101`. The fresh migration directory has been reset.

Deployment committed on 2026-11-01 with a new identity; no in-place upgrade.

- Committed transaction: `0x31cd234ecd9f82bcd824d80dddf56a203e40d7c2f8f9d57a8d1a5dbd9d986e69`
- Code output: 0
- Type hash: `0x53a6f56d36efe23b00b41c2743542969b7d1852f0a2abe8e2a81f8c8de4ce40c`
- Binary data hash: `0xe8442857aec2750fbbe46d0805e6bcb3f1b05d399f95d08e857fa6ee0790c65a`
- Reserved code capacity: 169,710 CKB
- Network fee: 0.00170185 CKB

The live code cell is confirmed and its bytes exactly match the tested build.
Frontend defaults, .env.example and .env.local now reference the committed type
hash and output. Previous test freights and locked rewards are intentionally
left behind under the consumed contract identity.
