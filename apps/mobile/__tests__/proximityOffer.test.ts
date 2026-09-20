import {proximityOfferState} from '../src/features/merchant/MerchantRequestScreen';

const off = {
  supported: true,
  canBroadcast: true,
  enabled: false,
  authorized: false,
  broadcasting: false,
};
const live = {
  supported: true,
  canBroadcast: true,
  enabled: true,
  authorized: true,
  broadcasting: true,
};

describe('what the counter says about being approached instead of scanned', () => {
  it('says a customer may hold their phone here once the radio is on the air', () => {
    expect(proximityOfferState({proximity: live})).toEqual({kind: 'live'});
  });

  it('asks for Bluetooth, which is the only way this counter can be approached', () => {
    // A merchant who is never asked believes the counter is ready and finds out
    // from the first customer that it was never switched on.
    expect(proximityOfferState({proximity: off})).toEqual({kind: 'needs-bluetooth'});
  });

  it('separates permission from a radio that is simply switched off', () => {
    expect(proximityOfferState({proximity: {...off, authorized: true}})).toEqual({kind: 'bluetooth-off'});
  });

  it('points at the QR code when the radio was asked for and refused', () => {
    expect(
      proximityOfferState({
        proximity: {...live, broadcasting: false, broadcastError: 'BLE_UNAVAILABLE'},
      }),
    ).toEqual({kind: 'failed'});
  });

  it('says it is still getting ready rather than claiming to be reachable', () => {
    expect(proximityOfferState({proximity: {...live, broadcasting: false}})).toEqual({kind: 'preparing'});
  });

  it('says nothing at all on a phone with no radio', () => {
    expect(
      proximityOfferState({proximity: {...off, supported: false, canBroadcast: false}}),
    ).toEqual({kind: 'hidden'});
  });
});
