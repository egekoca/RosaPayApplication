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
- **SEP-12** — customer-information exchange. `getCustomerInfo` and
  `submitCustomerInfo` speak the authenticated `GET/PUT /customer` shape. For
  the hackathon demo, `createMockSep12Anchor()` provides an in-memory anchor
  that progresses from `NEEDS_INFO` to `ACCEPTED` using only field names and
  status; submitted identity values are discarded. This is a protocol demo,
  not KYC, identity storage, or regulated onboarding.

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

Standards references: [SEP-12](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0012.md),
[SEP-24](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0024.md)
and [SEP-45](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0045.md).

## The lira anchor

`tr-mock-anchor.fly.dev` is the TRY sandbox anchor published for the Rise In x
Stellar Pro Hackathon. It is a sandbox in the sense that the bank is simulated -
no real lira moves - but the Stellar leg is real testnet USDC and the rate is a
live Reflector feed, so every number the app shows came from the anchor rather
than from this repository.

Rosa Pay talks to it through the standards door and holds no API key. The
anchor offers a partner API, which is better documented and takes a key, and its
own dashboard points wallets away from it: *"Building a wallet instead? Use the
SEP-6 door - no key needed, just SEP-10."* That is the right advice for the same
reason it is the right design. A wallet that speaks one company's partner API is
welded to that company; SEP-6 is what any anchor with a bank behind it offers, so
the same screens work against a real Turkish anchor the day there is one.

| | |
|---|---|
| Home domain | `tr-mock-anchor.fly.dev` |
| Signing key | `GDXYO6FJCNXZEWGXD54GT76FGFYLOLSOGSOJLNQ6WGHCGEQPO7NTE73M` |
| Transfer server | `https://tr-mock-anchor.fly.dev/sep6` |
| Asset | `USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5` |
| Standards used | SEP-1, SEP-10, SEP-38, SEP-6 |

`npm run testnet:try-ramp` proves both legs and writes
`config/testnet-try-ramp-evidence.json`. On 2026-09-06 it bought `10.2714512`
USDC with `500` TRY at `48.6786132` TRY/USDC (tx `93aed2e4…`) and sold
`5.1357256` USDC back for `247.51` TRY to an IBAN (tx `914371c5…`), both legs
reaching `completed`.

### Money that arrives without arriving

The anchor advertises `features.claimable_balances: true`, and means it: a
destination with no trustline for USDC gets a *claimable balance* rather than a
payment - and the transfer is still reported as `completed`.

That combination is the trap. A wallet that reads only the status would show a
finished deposit next to a balance that had not moved, which is the one thing
this product refuses to do. So `readLiraTransfer` reads `claimable_balance_id`
and a deposit carrying one is not settled, whatever the anchor calls it. The
screen then claims it - one more transaction, which only the customer's own key
can send - and the deposit settles when the money is actually in the wallet.

The app opens the trustline before starting a deposit, so this should not
normally happen. It is handled because "should not normally" is not a property
anyone can rely on with someone else's money.

### The bridge, and the three tests that decided it

This anchor cannot see a contract account at all. Three separate things say so,
each checked against the live service rather than assumed:

1. **SEP-10 authenticates an account.** It works by having an account sign a
   challenge transaction. A contract cannot; SEP-45 exists for exactly this and
   this anchor does not publish it.
2. **A deposit must land on a `G…`.** All three doors - `/sep6/deposit`,
   `/sep6/deposit-exchange`, and with `claimable_balance_supported=true` -
   answer `'account' must be a Stellar G... or M... address (contract addresses
   are not supported)`.
3. **A contract cannot pay a withdrawal.** Two independent reasons. A Soroban
   transaction cannot carry a memo at all (`Soroban transactions do not support
   memos`), and the memo is what routes the withdrawal. The anchor also matches
   by *muxed id*, and a Stellar Asset Contract will happily transfer to a muxed
   address - but that transfer reaches Horizon as `invoke_host_function` rather
   than as a payment, so a watcher reading the payments stream never sees it.

So the app carries a **bridge**: a classic account that exists to stand where
the anchor can see it, and holds nothing at rest.

```text
in    anchor ──payment──▶ bridge (G) ──SAC transfer──▶ smart wallet (C)
out   smart wallet (C) ──SAC transfer──▶ bridge (G) ──payment+memo──▶ anchor
```

The bridge key is not something the customer backs up. It never holds a balance
between transfers, and a lost one is replaced rather than recovered — which is
precisely what lets the wallet's own key stay in the secure element where it
cannot be copied. It is stored apart from the wallet key and without a biometric
prompt, because it guards nothing a prompt would protect.

A deposit is **not settled while the money is still on the bridge**, however
complete the anchor calls the transfer. The same rule as a claimable balance,
for the same reason.

`npm run testnet:bridge` proves both legs against the live anchor, calling the
app's own `anchorBridge` module rather than a copy of it. On 2026-09-07 it
turned `300` TRY into `6.1621396` USDC on the bridge, swept it into the smart
wallet, then sent `3.0810698` USDC back out through the bridge and the anchor
paid `148.50` TRY to an IBAN. The bridge held nothing at either end.

### What is still not possible

A wallet with no classic account anywhere still cannot reach this anchor: the
bridge *is* a classic account, software-held, and someone has to fund it with a
little XLM for the reserve and fees. On Testnet that is Friendbot; on a real
network it would be the operator's float. Closing that properly needs SEP-45 at
the anchor, which is the anchor's decision and not this app's.

## A bug in this anchor, worked around narrowly

On 2026-09-07 the anchor began refusing the SEP-38 asset identifier it
publishes. `/sep38/info` advertises `stellar:USDC:GBBD47IF…`, and both
`/sep6/deposit-exchange` and `/sep6/withdraw-exchange` answer:

```json
{"error":"unsupported destination_asset 'stellar:USDC:GBBD47IF…'; this anchor ramps USDC"}
```

Only a bare `USDC` is accepted. SEP-6 defines these fields as SEP-38 asset
identifiers, so the qualified form is the correct one and the anchor contradicts
its own `/sep38/info`. It appeared between two runs of `npm run testnet:bridge`
on the same day, alongside a treasury top-up, so it looks like a regression in a
redeploy rather than a deliberate change. **It has been reported to the
organisers.**

The app asks the spec-correct way first and retries with the bare code only on
that one error message. Nothing here has to change when they fix it, and a
genuinely unsupported asset still surfaces as one rather than being silently
retried into something else.
