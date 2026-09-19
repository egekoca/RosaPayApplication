# Lumenade Pay Settlement Contract

The contract accepts only registered merchants and allowlisted SEP-41 token contracts. A payment
binds the network ID, settlement contract, customer, merchant, recipient, token, integer amount,
nonce, intent ID, and ledger expiry. The customer authorizes the exact invocation and the merchant
signs the contract intent digest. Consumed intent IDs use persistent storage with proactive TTL
extension; expiry is checked explicitly and never relies on TTL.

Build with Rust 1.84+ and Stellar CLI 27:

```sh
stellar contract build --manifest-path contracts/Cargo.toml
cargo test --manifest-path contracts/Cargo.toml
```

The committed TypeScript binding is generated from the optimized WASM with Stellar CLI 27.1.0 and exported through `packages/stellar`. Its source comment records the matching WASM hash. Regenerate it whenever the public contract spec changes, then run the repository typecheck because generated code must satisfy the monorepo's strict TypeScript settings.

The current Testnet deployment is `CAV65DKNKPQZMY2MBXEDDBBCLMTVNIZUJVYFNDRUSKNCATIFKX66CSVO`. Public deployment metadata and the first native XLM settlement evidence are recorded in `config/`; signer identities remain outside version control.
