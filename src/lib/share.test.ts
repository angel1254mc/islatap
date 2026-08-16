import { describe, expect, it } from 'vitest';
import { buildShareText } from './share';
import type { ResultRow } from './round-state';

const ROW = (overrides: Partial<ResultRow> = {}): ResultRow => ({
  key: 'r1',
  name: 'Hato Rey',
  municipio: 'San Juan',
  points: 1450,
  distanceKm: 12.3,
  inside: false,
  ...overrides,
});

describe('buildShareText', () => {
  it('shows the distance for outside guesses', () => {
    const text = buildShareText([ROW()], { total: 1450, maxTotal: 5000 });
    expect(text).toContain('12.3 km');
    expect(text).not.toContain('¡Adentro!');
  });

  it('shows ¡Adentro! instead of a distance for inside guesses', () => {
    const text = buildShareText([ROW({ points: 5000, distanceKm: 0, inside: true })], {
      total: 5000,
      maxTotal: 5000,
    });
    expect(text).toContain('¡Adentro!');
    expect(text).not.toContain('0 m');
  });

  it('qualifies a place with its municipio when it has one', () => {
    const text = buildShareText([ROW()], { total: 1450, maxTotal: 5000 });
    expect(text).toContain('Hato Rey, San Juan');
  });

  it('leaves an unqualified place alone', () => {
    const text = buildShareText([ROW({ name: 'Adjuntas', municipio: null })], {
      total: 1450,
      maxTotal: 5000,
    });
    expect(text).toContain('Adjuntas —');
    expect(text).not.toContain('Adjuntas,');
  });

  it('derives the denominator from the caller, not a hardcoded constant', () => {
    // The server owns how many rounds a puzzle has, so 25,000 is no longer a
    // compile-time fact.
    const text = buildShareText([ROW()], { total: 1450, maxTotal: 15000 });
    expect(text).toContain('15,000');
    expect(text).not.toContain('25,000');
  });

  it('names the puzzle date when there is one', () => {
    const text = buildShareText([ROW()], { total: 1450, maxTotal: 5000, gameDate: '2026-08-05' });
    expect(text.split('\n')[0]).toContain('2026-08-05');
  });

  it('omits the date line entirely for an undated practice game', () => {
    const text = buildShareText([ROW()], { total: 1450, maxTotal: 5000 });
    expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it('adds a streak line only once a streak is worth bragging about', () => {
    expect(buildShareText([ROW()], { total: 1450, maxTotal: 5000, streak: 1 })).not.toContain('🔥');
    expect(buildShareText([ROW()], { total: 1450, maxTotal: 5000, streak: 4 })).toContain('🔥 4');
  });

  it('numbers rounds past the five stock emoji without crashing', () => {
    const rows = Array.from({ length: 7 }, (_, i) => ROW({ key: `r${i}` }));
    const text = buildShareText(rows, { total: 10150, maxTotal: 35000 });
    expect(text.split('\n')).toHaveLength(8); // header + 7 rounds
    expect(text).toContain('6.');
    expect(text).toContain('7.');
  });
});
