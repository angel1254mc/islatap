import type { ResultRow } from './round-state';
import { formatDistance } from './scoring';

const ROUND_EMOJI = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣'] as const;

function medalFor(points: number): string {
  if (points >= 4500) return '🟩';
  if (points >= 3000) return '🟨';
  if (points >= 1500) return '🟧';
  return '🟥';
}

/**
 * "Name, Municipio" when the place needs qualifying, bare name otherwise.
 * Barrio names collide constantly across municipios — Quebrada Arenas exists
 * six times — so the qualifier is part of the identity, not decoration.
 */
function label(row: ResultRow): string {
  return row.municipio ? `${row.name}, ${row.municipio}` : row.name;
}

export interface ShareOptions {
  total: number;
  /** Perfect score for THIS game. The server owns the round count now. */
  maxTotal: number;
  /** 'YYYY-MM-DD' for a daily puzzle; omitted for an undated practice game. */
  gameDate?: string | null;
  /** Consecutive days played, ending today. Shown only when it is > 1. */
  streak?: number;
}

export function buildShareText(rows: readonly ResultRow[], options: ShareOptions): string {
  const date = options.gameDate ? ` — ${options.gameDate}` : '';
  const header =
    `IslaTap${date} — ${options.total.toLocaleString('en-US')}` +
    ` / ${options.maxTotal.toLocaleString('en-US')} 🇵🇷`;

  const lines = rows.map((row, index) => {
    // Falls back to a plain number past the fifth round: the emoji list is a
    // nicety, not a limit on how long a puzzle may be.
    const badge = ROUND_EMOJI[index] ?? `${index + 1}.`;
    const distanceLabel = row.inside ? '¡Adentro!' : formatDistance(row.distanceKm);
    return `${badge} ${medalFor(row.points)} ${label(row)} — ${distanceLabel} — ${row.points.toLocaleString('en-US')}`;
  });

  const streak = options.streak && options.streak > 1 ? [`🔥 ${options.streak} day streak`] : [];
  return [header, ...lines, ...streak].join('\n');
}
