import {greetingFor} from '../src/features/home/greeting';

const at = (hour: number) => new Date(2026, 7, 24, hour, 0, 0);

describe('the home greeting', () => {
  it('names the person by their first name', () => {
    expect(greetingFor('Ege Hidayet Koca', at(9))).toBe('Good morning, Ege');
  });

  it('follows the time of day', () => {
    expect(greetingFor('Ege', at(9))).toBe('Good morning, Ege');
    expect(greetingFor('Ege', at(14))).toBe('Good afternoon, Ege');
    expect(greetingFor('Ege', at(21))).toBe('Good evening, Ege');
  });

  it('greets a session that has no name yet without a dangling comma', () => {
    expect(greetingFor(undefined, at(9))).toBe('Good morning');
    expect(greetingFor('   ', at(14))).toBe('Good afternoon');
  });
});
