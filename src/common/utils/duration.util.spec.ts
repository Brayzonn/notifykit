import { parseDurationMs } from './duration.util';

describe('parseDurationMs', () => {
  it.each([
    ['30s', 30 * 1000],
    ['15m', 15 * 60 * 1000],
    ['12h', 12 * 60 * 60 * 1000],
    ['7d', 7 * 24 * 60 * 60 * 1000],
  ])('parses %s', (input, expected) => {
    expect(parseDurationMs(input)).toBe(expected);
  });

  it.each(['', '7', '604800', '0d', '7 d', '7days', '1.5h', '-1d', '7w'])(
    'rejects %p',
    (input) => {
      expect(() => parseDurationMs(input)).toThrow('Invalid duration');
    },
  );
});
