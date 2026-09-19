import {hashPaymentIntent, paymentIntentV1Schema, type PaymentAsset} from '@rosapay/protocol';
import {Address, Asset, Networks, StrKey, hash} from '@stellar/stellar-sdk';
import {Buffer} from 'buffer';

import type {PaymentIntent as ContractPaymentIntent} from './generated/settlement';

const INTENT_ID_DOMAIN = 'RosaPay/Settlement/IntentId\0';
const MERCHANT_ID_DOMAIN = 'RosaPay/Settlement/MerchantId\0';
const NONCE_DOMAIN = 'RosaPay/Settlement/Nonce\0';
const MAX_I128 = (1n << 127n) - 1n;

export type SettlementEnvelopeContext = {
  customer: string;
  networkPassphrase: string;
  settlementContractId: string;
};

export type SettlementEnvelope = {
  intent: ContractPaymentIntent;
  rtpIntentHash: Buffer;
};

export type SignedSettlementEnvelope = SettlementEnvelope & {
  merchantSignature: Buffer;
};

export class SettlementEnvelopeError extends Error {
  constructor(
    public readonly code:
      | 'INVALID_ADDRESS'
      | 'INVALID_AMOUNT'
      | 'INVALID_LEDGER'
      | 'INVALID_SIGNATURE'
      | 'WRONG_NETWORK',
    message: string,
  ) {
    super(message);
    this.name = 'SettlementEnvelopeError';
  }
}

function assertAddress(value: string, label: string): void {
  try {
    Address.fromString(value);
  } catch {
    throw new SettlementEnvelopeError('INVALID_ADDRESS', `${label} is not a valid Stellar address`);
  }
}

function hashDomainValue(domain: string, value: string): Buffer {
  return hash(Buffer.concat([Buffer.from(domain, 'utf8'), Buffer.from(value, 'utf8')]));
}

export function settlementIntentId(value: string): Buffer {
  return hashDomainValue(INTENT_ID_DOMAIN, value);
}

export function settlementMerchantId(value: string): Buffer {
  return hashDomainValue(MERCHANT_ID_DOMAIN, value);
}

export function settlementNonce(value: string): Buffer {
  return hashDomainValue(NONCE_DOMAIN, value);
}

export function decimalToContractAmount(amount: string, decimals: number): bigint {
  const [whole, fraction = ''] = amount.split('.');
  if (!whole || fraction.length > decimals || !/^\d+$/.test(whole) || (fraction && !/^\d+$/.test(fraction))) {
    throw new SettlementEnvelopeError(
      'INVALID_AMOUNT',
      `Amount cannot be represented with ${decimals} decimal places`,
    );
  }

  const units = BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, '0') || '0');
  if (units <= 0n || units > MAX_I128) {
    throw new SettlementEnvelopeError('INVALID_AMOUNT', 'Amount is outside the contract i128 range');
  }
  return units;
}

export function assetContractId(asset: PaymentAsset, networkPassphrase: string): string {
  if (asset.type === 'sac') {
    if (!asset.contractId || !StrKey.isValidContract(asset.contractId)) {
      throw new SettlementEnvelopeError('INVALID_ADDRESS', 'SAC asset contract is not valid');
    }
    return asset.contractId;
  }
  if (asset.type === 'native') {
    return Asset.native().contractId(networkPassphrase);
  }
  if (!asset.issuer || !StrKey.isValidEd25519PublicKey(asset.issuer)) {
    throw new SettlementEnvelopeError('INVALID_ADDRESS', 'Credit asset issuer is not valid');
  }
  try {
    return new Asset(asset.code, asset.issuer).contractId(networkPassphrase);
  } catch {
    throw new SettlementEnvelopeError('INVALID_ADDRESS', 'Credit asset cannot be represented on Stellar');
  }
}

export function buildSettlementEnvelope(
  input: unknown,
  context: SettlementEnvelopeContext,
): SettlementEnvelope {
  const rtpIntent = paymentIntentV1Schema.parse(input);
  const expectedPassphrase = rtpIntent.network === 'testnet' ? Networks.TESTNET : Networks.PUBLIC;
  if (context.networkPassphrase !== expectedPassphrase) {
    throw new SettlementEnvelopeError(
      'WRONG_NETWORK',
      `RTP/1 intent targets ${rtpIntent.network}, but the settlement context uses another network`,
    );
  }

  assertAddress(context.customer, 'Customer');
  assertAddress(rtpIntent.recipient, 'Recipient');
  if (!StrKey.isValidContract(context.settlementContractId)) {
    throw new SettlementEnvelopeError('INVALID_ADDRESS', 'Settlement contract ID is not valid');
  }
  if (rtpIntent.expiresAtLedger > 0xffff_ffff) {
    throw new SettlementEnvelopeError('INVALID_LEDGER', 'Expiry ledger exceeds the contract u32 range');
  }

  return {
    intent: {
      amount: decimalToContractAmount(rtpIntent.amount, rtpIntent.asset.decimals),
      customer: context.customer,
      expires_at_ledger: rtpIntent.expiresAtLedger,
      intent_id: settlementIntentId(rtpIntent.intentId),
      merchant_id: settlementMerchantId(rtpIntent.merchantProfileId),
      network_id: hash(Buffer.from(context.networkPassphrase, 'utf8')),
      nonce: settlementNonce(rtpIntent.nonce),
      recipient: rtpIntent.recipient,
      settlement_contract: context.settlementContractId,
      token: assetContractId(rtpIntent.asset, context.networkPassphrase),
    },
    rtpIntentHash: Buffer.from(hashPaymentIntent(rtpIntent), 'hex'),
  };
}

export function attachMerchantContractSignature(
  envelope: SettlementEnvelope,
  signature: Uint8Array,
): SignedSettlementEnvelope {
  if (signature.byteLength !== 64) {
    throw new SettlementEnvelopeError('INVALID_SIGNATURE', 'Merchant contract signature must be 64 bytes');
  }
  return {...envelope, merchantSignature: Buffer.from(signature)};
}
