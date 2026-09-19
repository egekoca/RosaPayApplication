import {displayAmount} from '../src/shared/displayAmount';

describe('reading an amount off a phone screen', () => {
  it('cuts the seven places a rate conversion leaves behind down to two', () => {
    expect(displayAmount('37.3134329')).toBe('37.31');
    expect(displayAmount('0.3333334')).toBe('0.33');
  });

  it('keeps two places even when the amount is round, because money reads that way', () => {
    expect(displayAmount('24.5')).toBe('24.50');
    expect(displayAmount('10')).toBe('10.00');
    expect(displayAmount(0)).toBe('0.00');
  });

  it('groups the thousands so a large balance is still countable', () => {
    expect(displayAmount('12345.678')).toBe('12,345.68');
    expect(displayAmount('-1234567.1')).toBe('-1,234,567.10');
  });

  it('widens rather than call a small payment free', () => {
    expect(displayAmount('0.0004')).toBe('0.0004');
    expect(displayAmount('0.0000001')).toBe('0.0000001');
  });

  it('stops at the seven places Stellar itself stops at', () => {
    expect(displayAmount('0.00000001')).toBe('0.0000000');
  });

  it('shows what it was given rather than a number it invented', () => {
    expect(displayAmount('')).toBe('');
    expect(displayAmount('lots')).toBe('lots');
  });
});
