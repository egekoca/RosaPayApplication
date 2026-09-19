import {sumAmounts, totalForTransport} from '../src/features/dashboard/DashboardScreen';

describe('dashboard totals', () => {
  it('adds token amounts without floating-point drift', () => {
    expect(sumAmounts(['0.1', '0.2', '1.005'])).toBe('1.305');
  });

  it('separates confirmed QR and NFC activity', () => {
    const receipts = [
      {amount: '10.25', transport: 'qr' as const},
      {amount: '2.5', transport: 'nfc' as const},
      {amount: '4', transport: 'unknown' as const},
    ];
    expect(totalForTransport(receipts, 'qr')).toBe('10.25');
    expect(totalForTransport(receipts, 'nfc')).toBe('2.5');
  });
});
