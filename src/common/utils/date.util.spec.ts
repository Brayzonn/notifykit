import { addMonths } from './date.util';

describe('addMonths', () => {
  it.each([
    ['2026-11-04T09:00:41.000Z', '2026-12-04T09:00:41.000Z'],
    ['2026-01-31T12:00:00.000Z', '2026-02-28T12:00:00.000Z'],
    ['2028-01-31T12:00:00.000Z', '2028-02-29T12:00:00.000Z'],
    ['2026-03-31T00:00:00.000Z', '2026-04-30T00:00:00.000Z'],
    ['2026-08-31T23:59:59.999Z', '2026-09-30T23:59:59.999Z'],
    ['2026-12-15T08:30:00.000Z', '2027-01-15T08:30:00.000Z'],
    ['2026-12-31T08:30:00.000Z', '2027-01-31T08:30:00.000Z'],
  ])('adds one month to %s -> %s', (input, expected) => {
    expect(addMonths(new Date(input), 1).toISOString()).toBe(expected);
  });

  it('adds multiple months with clamping', () => {
    expect(
      addMonths(new Date('2026-10-31T10:00:00.000Z'), 4).toISOString(),
    ).toBe('2027-02-28T10:00:00.000Z');
  });

  it('does not mutate the input', () => {
    const input = new Date('2026-01-31T12:00:00.000Z');
    addMonths(input, 1);
    expect(input.toISOString()).toBe('2026-01-31T12:00:00.000Z');
  });
});
