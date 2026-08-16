import type { Difficulty, Subtype } from '../data/types';
import type { PromptView } from '../lib/round-state';

// Labelled by subtype rather than category so a comunidad reads as a comunidad,
// even though it shares the 'barrio' bucket (and therefore the tag colour).
const SUBTYPE_LABELS: Record<Subtype, string> = {
  municipio: 'Municipio',
  landmark: 'Landmark',
  barrio: 'Barrio',
  'barrio-pueblo': 'Pueblo',
  comunidad: 'Comunidad',
};

const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  easy: 'Easy',
  medium: 'Medium',
  hard: 'Hard',
};

interface RoundPromptProps {
  prompt: PromptView;
  roundNumber: number;
  totalRounds: number;
  totalScore: number;
}

export default function RoundPrompt({
  prompt,
  roundNumber,
  totalRounds,
  totalScore,
}: RoundPromptProps) {
  // PromptView leaves subtype and difficulty optional (practice builds prompts
  // from a different source), so the tag row renders only what actually
  // arrived rather than printing "undefined" into a pill.
  const tags = [
    prompt.subtype ? { className: `tag tag--${prompt.category}`, text: SUBTYPE_LABELS[prompt.subtype] } : null,
    prompt.difficulty
      ? { className: `tag tag--${prompt.difficulty}`, text: DIFFICULTY_LABELS[prompt.difficulty] }
      : null,
  ].filter((tag): tag is { className: string; text: string } => tag !== null);

  return (
    <header className="hud">
      <div className="hud__chip">
        Round {roundNumber} / {totalRounds}
      </div>

      {/* Keyed so React remounts the block each round and the CSS entry
          animation replays; the round key is per-day opaque, so it is a safe
          identity to expose. */}
      <div className="hud__prompt" key={prompt.key}>
        <span className="hud__label">Tap as close as you can to</span>
        <h1 className="hud__place">
          {prompt.name}
          {prompt.municipio && <span className="hud__municipio">{prompt.municipio}</span>}
        </h1>
        {tags.length > 0 && (
          <div className="hud__tags">
            {tags.map((tag) => (
              <span key={tag.text} className={tag.className}>
                {tag.text}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="hud__chip hud__chip--score">
        Score<strong>{totalScore.toLocaleString('en-US')}</strong>
      </div>
    </header>
  );
}
