# Paying with what you hold

A merchant prices a coffee in USDC. The customer's wallet holds lumens. Until
this landed, that was the end of it: the settlement contract moves one named
token, and a zero balance of that token meant the payment could not happen at
all. It was the last open item in the customer flow, and the reason was
structural rather than a missing screen.

Soroswap closes it. The settlement contract buys the exact amount the merchant
asked for, in the same transaction that pays them.

## What the contract does

`settle_payment_with_swap` takes the merchant's intent and signature unchanged,
plus three things that belong to the customer: a `path`, an `amount_in_max`, and
a `deadline`.

```text
customer authorizes  settlement.settle_payment_with_swap(intent, sig, path, max, deadline)
                       └─ soroswap_router.swap_tokens_for_exact_tokens(amount_out = intent.amount, to = customer)
                            └─ token(path[0]).transfer(customer → pair, amount_in)
                       └─ token(intent.token).transfer(customer → recipient, intent.amount)
```

The order matters. Every check the direct path makes - expiry, network, contract
binding, merchant registration, recipient, asset policy, replay, the customer's
authorization, the merchant's ed25519 signature - runs before the router is
called. A payment that fails any of them never reaches a pool.

## What the merchant signed, and what they did not

The merchant's signature covers the intent: recipient, asset, amount, nonce,
expiry, network, and the settlement contract itself. It does not cover the path,
the ceiling, or the deadline, and it does not need to.

The router is told an exact `amount_out`, taken from the signed intent, and the
transfer that follows is byte-for-byte the one `settle_payment` makes. So no
arrangement of the funding arguments can change who is paid, in what, or how
much. A merchant signature produced before this contract existed still settles
here and still means exactly what it meant.

What the funding arguments *can* change is what the customer spends, which is
why they are the customer's to choose.

## The three things that bound the customer's spend

1. **`amount_in_max`.** The router refuses an input above it. The whole payment
   fails rather than overspending.
2. **The authorization entry.** The customer's device signature covers the exact
   input transfer the swap will make, amount included. If the pool moves between
   simulation and the ledger, the signature no longer matches and the network
   rejects the transaction. This is stricter than the ceiling: a moved pool
   reads as *try again*, never as a surprise on the receipt.
3. **Atomicity.** The swap and the payment share one transaction. A failure
   after the swap rolls the swap back too, so a customer is never left holding a
   balance they did not ask for in place of a payment that did not happen.

## The router is not an argument

The AMM address lives in contract storage and is set by the admin
(`set_swap_router`). It is deliberately not a parameter: the relayer submits the
transaction, and a relayer that could name the router could name a contract of
its own. Until a router is set, the funding path refuses rather than falling
back to anything.

The path is checked before it is used. It must have at least two hops, must end
at the token the merchant asked for, and must not start there.

## What the customer sees

`resolveFundingChoice` prices every asset this wallet holds against the request,
through Soroswap's `router_get_amounts_in`, before the fingerprint prompt. The
confirmation screen then shows what leaves *their* wallet - `0.9465832 XLM` -
alongside the merchant's price, the rate, and the ceiling they are actually
signing for.

Holding the merchant's own token always sorts first: a customer who has USDC
should not be routed through a pool and charged a spread for it. An asset the
wallet cannot cover *at the ceiling* is not offered at all, because a payment
offered and then refused for insufficient funds is worse than one never offered.

## Testnet

| | |
|---|---|
| Settlement contract | `CAV65DKNKPQZMY2MBXEDDBBCLMTVNIZUJVYFNDRUSKNCATIFKX66CSVO` |
| Soroswap router | `CCJUD55AG6W5HAI5LRVNKAE5WDP5XGZBUDS5WNTIVDU7O264UZZE7BRD` |
| Soroswap factory | `CDP3HMUH6SMS3S7NPGNDJLULCOXXEPSHY4JKUKMBNQMATHDHWXRRJTBY` |

Router and factory addresses come from Soroswap's own published deployment
manifest, `soroswap/core/public/testnet.contracts.json`, and the router's
interface is read from the deployed contract rather than from documentation. The
TypeScript client in `packages/stellar/src/generated/soroswapRouter.ts` is
generated from that on-chain spec.

`npm run testnet:swap` proves the whole path against the live network. On
2026-09-06 it settled a `0.10 USDC` request from a smart wallet holding no USDC,
for `0.9465832 XLM`, in transaction
`b4a0cc9b8c7e3a3beb4b7a24c93517465ac2b731862451917c4ff24f2bcd1513` at ledger
`4,540,761`. The evidence is written to `config/testnet-swap-evidence.json` and
the run asserts, among other things, that the merchant received the exact signed
amount, that the customer kept no leftover balance, that the spend stayed under
the signed ceiling, that the relayer was the source and fee payer, and that the
router really was inside the same transaction.

## Limits

- One AMM, and one hop in practice. Multi-hop paths are accepted by the contract
  and the client but nothing selects them yet; Soroswap's own aggregator would
  be the way to do that properly.
- Testnet only, like the rest of the deployment. Soroswap is live on Mainnet,
  which is what makes this worth building rather than mocking.
- The swap adds resource cost to a payment. The relayer pays it, so it lands on
  the operator rather than the customer, but it is not free.
