import {proximityOfferState} from '../src/features/merchant/MerchantRequestScreen';

const nfcOff = {canBroadcast: false, enabled: false, broadcasting: false};
const nfcLive = {canBroadcast: true, enabled: true, broadcasting: true};
const bluetoothOff = {
  supported: true,
  canBroadcast: true,
  enabled: false,
  authorized: false,
  broadcasting: false,
};
const bluetoothLive = {
  supported: true,
  canBroadcast: true,
  enabled: true,
  authorized: true,
  broadcasting: true,
};

describe('what the counter says about being approached instead of scanned', () => {
  it('says a customer may hold their phone here once either radio is on the air', () => {
    expect(proximityOfferState({nfc: nfcLive, proximity: {...bluetoothOff, supported: false}}))
      .toEqual({kind: 'live', bluetooth: false});
    expect(proximityOfferState({nfc: nfcOff, proximity: bluetoothLive}))
      .toEqual({kind: 'live', bluetooth: true});
  });

  it('asks for Bluetooth even while NFC is already serving Android taps', () => {
    // The merchant would otherwise believe the counter is ready and find out
    // from the first iPhone customer that half of it was never switched on.
    expect(proximityOfferState({nfc: nfcLive, proximity: bluetoothOff}))
      .toEqual({kind: 'needs-bluetooth'});
  });

  it('separates permission from a radio that is simply switched off', () => {
    expect(
      proximityOfferState({nfc: nfcOff, proximity: {...bluetoothOff, authorized: true}}),
    ).toEqual({kind: 'bluetooth-off'});
  });

  it('points at the QR code when a radio was asked for and refused', () => {
    expect(
      proximityOfferState({
        nfc: nfcOff,
        proximity: {...bluetoothLive, broadcasting: false, broadcastError: 'BLE_UNAVAILABLE'},
      }),
    ).toEqual({kind: 'failed', bluetooth: true});
    expect(
      proximityOfferState({
        nfc: {canBroadcast: true, enabled: true, broadcasting: false, broadcastError: 'NFC_UNAVAILABLE'},
        proximity: {...bluetoothOff, supported: false},
      }),
    ).toEqual({kind: 'failed', bluetooth: false});
  });

  it('says it is still getting ready rather than claiming to be reachable', () => {
    expect(
      proximityOfferState({nfc: nfcOff, proximity: {...bluetoothLive, broadcasting: false}}),
    ).toEqual({kind: 'preparing', bluetooth: true});
  });

  it('says nothing at all on a phone with neither radio', () => {
    expect(
      proximityOfferState({nfc: nfcOff, proximity: {...bluetoothOff, supported: false, canBroadcast: false}}),
    ).toEqual({kind: 'hidden'});
  });
});
