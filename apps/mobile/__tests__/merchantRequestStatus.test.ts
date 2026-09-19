import {hashPaymentIntent} from '@rosapay/protocol';
import {ApiClientError, RosaPayApiClient} from '../src/api';
import {publishPaymentRequest} from '../src/features/merchant/merchantRequestStatus';
import {mockSignedIntent} from './fixtures/signedIntent';

jest.mock('../src/api/deviceSession', () => ({
  ensureDeviceSession: jest.fn().mockResolvedValue(undefined),
}));

describe('merchant payment request publication', () => {
  const api = jest.spyOn(RosaPayApiClient.prototype, 'createPaymentIntent');
  const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);

  afterEach(() => {
    api.mockReset();
    consoleError.mockClear();
  });

  it('waits for the API to return the same signed request', async () => {
    api.mockResolvedValue({
      payload: mockSignedIntent,
      payloadHash: hashPaymentIntent(mockSignedIntent.intent),
      idempotencyKey: `intent-${mockSignedIntent.intent.intentId}`,
      status: 'created',
    } as never);

    await expect(publishPaymentRequest(mockSignedIntent)).resolves.toBeUndefined();
    expect(api).toHaveBeenCalledWith(mockSignedIntent, `intent-${mockSignedIntent.intent.intentId}`);
  });

  it('refuses to publish a locally displayed request if the API has a different signature', async () => {
    api.mockResolvedValue({
      payload: {...mockSignedIntent, signature: 'different-signature'},
      payloadHash: hashPaymentIntent(mockSignedIntent.intent),
      idempotencyKey: `intent-${mockSignedIntent.intent.intentId}`,
      status: 'created',
    } as never);

    await expect(publishPaymentRequest(mockSignedIntent)).rejects.toThrow(/different payment request/);
  });

  it('does not mistake a conflicting intent ID for successful publication', async () => {
    api.mockRejectedValue(new ApiClientError('INTENT_CONFLICT', 'Intent ID already exists', 409));

    await expect(publishPaymentRequest(mockSignedIntent)).rejects.toMatchObject({code: 'INTENT_CONFLICT'});
  });
});
