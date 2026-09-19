# Skills and tooling used

The Pro Hackathon submission asks teams to name the skill files they built with,
by path. This is that record, and it is deliberately a record of what was
actually opened rather than a list of what was available.

## Skill files

Installed from [skills.stellar.org](https://skills.stellar.org) via the
`stellar-build` installer, under `~/.claude/skills/`.

| Path | Used for |
|---|---|
| `stellar-smart-contracts/SKILL.md` | The settlement and wallet contracts: storage and TTL, authorization, cross-contract calls, errors, fees. |
| `stellar-smart-contracts/testing.md` | The contract test suites, including the mock router the swap tests need and the `try_` error assertions. |
| `stellar-smart-contracts/security.md` | The negative-path requirements: replay, expiry, recipient, asset, network and contract binding. |
| `stellar-dapp/SKILL.md` | The JS SDK work: simulation, auth-entry signing, relayer submission, polling to a final status. |
| `stellar-data/SKILL.md` | RPC and Horizon: reading balances through the SAC, contract events, transaction receipts. |
| `stellar-assets/SKILL.md` | XLM and USDC as Stellar Asset Contracts, trustlines, and why a contract account needs none. |
| `stellar-standards/SKILL.md` | Choosing SEP-6 over SEP-24 for the lira rail, and the SEP-1/10/38 handshake around it. |
| `stellar-competitive-landscape/SKILL.md` | Positioning against the 728-project LumenLoop ecosystem database before committing to the Soroswap integration. |

`AGENTS.md` makes reading the matching skill a rule for this repository rather
than a suggestion, and the Stellar Raven MCP server is enabled in
`.codex/config.toml`.

## What the skills did not answer

Naming only the skills would overstate them. Four things in this submission came
from primary sources, because a skill file cannot know them:

- **The Soroswap router interface** was read from the deployed contract itself
  (`stellar contract info interface`), not from documentation, and the typed
  client in `packages/stellar/src/generated/soroswapRouter.ts` is generated from
  that on-chain spec.
- **The WebAuthn verifier** in `contracts/wallet/src/webauthn.rs` is adapted from
  OpenZeppelin's audited Stellar implementation, itself adapted from passkey-kit.
  The attributions are in the file.
- **The anchor's real behaviour** was established by probing the live service:
  that it refuses contract addresses on every SEP-6 door, that it pays a wallet
  with no trustline into a claimable balance while still reporting `completed`,
  and that it currently rejects the SEP-38 asset identifier it publishes.
- **Two Soroban limits** that decided the bridge design were found by trying
  them: a Soroban transaction cannot carry a memo, and a Stellar Asset Contract
  transfer reaches Horizon as `invoke_host_function` rather than as a payment,
  even when sent to a muxed address the SAC accepts.

## Other tooling

- Stellar CLI 27.1.0 — contract build, deploy, interface inspection, TypeScript
  bindings for both the settlement contract and the Soroswap router.
- Stellar RPC and Horizon on Testnet for every live check.
- `stellar-build` installer and Raven MCP (`raven.stellar.buzz`), per `AGENTS.md`.
