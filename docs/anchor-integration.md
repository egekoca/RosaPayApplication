# Fiat on and off ramp

Rosa Pay is not an anchor. It is a non-custodial client that talks to licensed
anchors over the SEP standards, so a customer can bring real money in and take it
back out without Rosa Pay ever touching their identity documents or their bank
details.

## What is implemented

`packages/anchor` is a provider-independent client for four standards:

- **SEP-1** — reads an anchor's `stellar.toml` to learn its endpoints, its
  signing key and the assets it handles. An anchor that publishes no signing key
  or no network is refused, because nothing it said afterwards could be checked.
- **SEP-10** — the handshake that proves a customer controls their account. The
  challenge is a real Stellar transaction handed over by a third party, so it is
  verified before the customer's key goes near it: signed by the key the anchor
  published, sequence zero so it can never reach the ledger, naming this
  customer, this anchor and this network.
- **SEP-45** — authenticates Rosa Pay's contract account. Both authorization
  entries must name the published web-auth contract and the exact
  `web_auth_verify` arguments. The anchor entry is checked against its SEP-1
  signing key and live-ledger expiry before the device is asked to sign. The
  device-signed entry is checked again, simulated, and refused if the write
  footprint contains anything except the allowed auth nonce/instance data.
- **SEP-24** — hosted deposit and withdrawal. The anchor returns a URL Rosa Pay
  opens and a transaction id to follow. Rosa Pay understands the current SEP-24
  status set, reduces it to action-required/pending/completed/failed, and keeps
  bounded polling resumable rather than presenting a timeout as failure.

SEP-24 is chosen over SEP-6 deliberately. Identity documents and payment details
are the anchor's regulated business, and Rosa Pay is better off never holding
them.

## What the client refuses

- A challenge signed by anyone but the anchor, or naming another account, or for
  another network — and the device is never asked to sign it.
- An interactive URL outside the anchor's HTTPS domain tree, unless its exact
  HTTPS origin is listed in deployment configuration. A shared registrable
  domain is not enough. Testanchor's separately hosted UI is therefore approved
  only as `https://anchor-ref-ui-testanchor.stellar.org`.
- A SEP-45 challenge with altered arguments, another contract/function,
  sub-invocations, an impostor or expired anchor signature, a signer-mutated
  client entry, a failed simulation, or an unexpected write footprint.

## The account question

Rosa Pay's customer wallet is a contract account, so the mobile integration uses
SEP-45 and passes the smart wallet's `C...` address as the SEP-24 destination or
source. It does not create a classic bridge account.

That decision avoids the classic-account trustline-and-sweep path. Native XLM can
land directly in the contract account. When a verified USDC asset is enabled,
the contract account will hold its SAC balance directly; a classic trustline is
only relevant if a future provider forces a separate `G...` destination. SEP-24
permits the authenticated account and transfer source/destination to differ, but
Rosa Pay keeps them equal unless a later product decision explicitly introduces
that bridge.

## Mobile behavior

- Wallet exposes **Add money** and **Withdraw** for Testnet XLM.
- The hosted flow opens in Safari View Controller / Chrome Custom Tabs, with a
  platform-browser fallback.
- The SEP-24 bearer token and transaction id are stored only in the existing
  Keychain/Keystore-backed encrypted session so polling survives browser/app
  closure. Final transfers clear that saved session; sign-out clears it too.
- Withdrawal initiation and status tracking are implemented. A
  `pending_user_transfer_start` result remains action-required: sending the
  anchor's requested payment from the smart wallet is a separate authorization
  step and is not falsely reported as complete.

## Live Testnet proof

On 2026-08-25, `npm run testnet:anchor` performed a real SEP-1 discovery,
Friendbot-funded SEP-10 authentication, SEP-24 native-XLM deposit start, and
authenticated transaction lookup against `testanchor.stellar.org`.

- transaction id: `00b77ef6-0a20-4d45-8f8b-faa8866f519e`
- interactive origin: `https://anchor-ref-ui-testanchor.stellar.org`
- observed status: `incomplete` / action required

The proof account was ephemeral and its secret was never written or printed.
`incomplete` is expected before a person finishes the hosted sandbox form; it is
not presented as settlement success.

## Next

1. Add the smart-wallet payment step required when a withdrawal reaches
   `pending_user_transfer_start`, including amount/asset/recipient/memo review.
2. Complete a physical-device SEP-45 + hosted-browser run; the Node proof covers
   live SEP-10/SEP-24 and unit tests cover SEP-45 XDR/security behavior.
3. MoneyGram Ramps sandbox, which needs allowlisting and a published domain.

Standards references: [SEP-24](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0024.md)
and [SEP-45](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0045.md).
