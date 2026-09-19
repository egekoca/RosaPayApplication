# Rosa Pay Agent Instructions

## Sources of truth

- Treat `docs/PRD.md` as the product contract and `docs/TODO.md` as delivery status.
- Treat `config/testnet-deployment.json` as the public Testnet deployment manifest.
- Keep documentation and tests aligned with behavioral or deployment changes.

## Required Stellar workflow

Use the Stellar skills and the `stellar-raven` MCP server for every task that
touches Stellar protocol behavior, SDKs, contracts, wallets, assets, network
data, or deployment.

1. Select and read the matching local skill before changing code:
   - `stellar-dev:smart-contracts` for Soroban Rust, auth, storage, testing,
     deployment, and security.
   - `stellar-dev:dapp` for JavaScript/TypeScript SDK, wallet, transaction,
     simulation, signing, submission, and polling work.
   - `stellar-dev:data` for RPC, Horizon, events, ledgers, and indexing.
   - `stellar-dev:assets` for XLM/SAC, issued assets, trustlines, and USDC.
   - `stellar-dev:standards` for SEP/CAP selection and ecosystem references.
   - `stellar-dev:agentic-payments`, `stellar-dev:cross-chain`, or
     `stellar-dev:zk-proofs` only when that scope is actually requested.
2. Query `stellar-raven` with targeted vocabulary and `kind: "skill"`; never
   guess operation or skill IDs. Read only relevant sections with
   `codemode.skill.read` inside one `execute` call. Skill-read content is
   returned at `.sections`, while service calls return payloads at `.data`.
3. Pair implementation guidance with a `stellarDocs` Raven query whenever the
   claim can change with protocol, SDK, CLI, RPC, network, or standards status.
4. Use live RPC/CLI checks for network-dependent claims such as protocol
   version, contract state, asset addresses, transaction results, and limits.
   Do not infer live state from documentation alone.

## Stellar invariants

- Default to Stellar Testnet and native XLM unless the task explicitly changes
  the network or the asset decision is recorded in the PRD/backlog.
- Use the configured network passphrase, RPC URL, contract ID, and verified SAC;
  do not silently fall back across networks.
- Prefer generated bindings or `contract.Client` over hand-built `ScVal` calls.
- Simulate Soroban transactions before signing, then submit and poll to a final
  status. Never display success based only on submission acceptance.
- Keep private keys and signing material out of JavaScript, Git, logs, fixtures,
  and public deployment manifests. Project-local Stellar identities stay under
  ignored `.stellar/` storage.
- Preserve the separation between the merchant RTP/1 signature, customer
  authorization, and relayer submission.
- Treat amounts as fixed-point integer stroops at contract boundaries; never use
  floating-point arithmetic for settlement values.
- Require authorization, expiry, replay, asset, recipient, amount, network, and
  contract-binding negative tests when settlement behavior changes.

## Verification

Run the smallest relevant checks while iterating and the full affected suite
before handoff:

```bash
npm run check
npm run lint
npm run contract:test
npm run contract:build
```

Use `npm run testnet:smoke` only when the project-local Testnet identities and
live network are available. Never print secret identity material in output.

