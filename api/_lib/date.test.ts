import { describe, expect, it } from 'vitest';
import { addDays, epochDay, fromEpochDay, todayInAst } from './date';

describe('epochDay', () => {
  it('counts days from the unix epoch', () => {
    expect(epochDay('1970-01-01')).toBe(0);
    expect(epochDay('1970-01-02')).toBe(1);
    // Anchor value used by the landmark-cadence tests: 20670 % 3 === 0.
    expect(epochDay('2026-08-05')).toBe(20670);
  });

  it('rejects anything that is not a zero-padded calendar date', () => {
    // A sloppy '2026-8-5' would still parse via Date.UTC and silently produce a
    // valid-looking day number, which would then key a whole day's puzzle to a
    // string the database never stores. Fail loudly instead.
    expect(() => epochDay('2026-8-5')).toThrow();
    expect(() => epochDay('2026-08-05T00:00:00Z')).toThrow();
    expect(() => epochDay('')).toThrow();
  });

  it('rejects dates that do not exist', () => {
    // Date.UTC rolls 2026-02-30 forward to 2026-03-02 without complaint. The
    // round-trip check is what catches it.
    expect(() => epochDay('2026-02-30')).toThrow();
    expect(() => epochDay('2026-13-01')).toThrow();
  });
});

describe('fromEpochDay / addDays', () => {
  it('round-trips', () => {
    expect(fromEpochDay(0)).toBe('1970-01-01');
    expect(fromEpochDay(20670)).toBe('2026-08-05');
    expect(fromEpochDay(epochDay('2027-03-14'))).toBe('2027-03-14');
  });

  it('crosses month, year and leap-day boundaries', () => {
    expect(addDays('2026-08-05', 1)).toBe('2026-08-06');
    expect(addDays('2026-08-31', 1)).toBe('2026-09-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29'); // 2028 is a leap year
    expect(addDays('2026-08-05', 30)).toBe('2026-09-04');
    expect(addDays('2026-08-05', 0)).toBe('2026-08-05');
  });
});

describe('todayInAst', () => {
  it('rolls over at 04:00 UTC, which is midnight in Puerto Rico', () => {
    // AST is UTC-4 with no DST, so this boundary is fixed all year. Using
    // toISOString().slice(0,10) here would roll the puzzle at 20:00 local.
    expect(todayInAst(new Date('2026-08-05T03:59:59Z'))).toBe('2026-08-04');
    expect(todayInAst(new Date('2026-08-05T04:00:00Z'))).toBe('2026-08-05');
    // ...and it must not drift in the northern-hemisphere summer either.
    expect(todayInAst(new Date('2026-01-15T03:59:59Z'))).toBe('2026-01-14');
    expect(todayInAst(new Date('2026-01-15T04:00:00Z'))).toBe('2026-01-15');
  });
});
