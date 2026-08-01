import type { Difficulty, GameLocation, Subtype } from '../data/locations';

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
  location: GameLocation;
  roundNumber: number;
  totalRounds: number;
  totalScore: number;
}

export default function RoundPrompt({
  location,
  roundNumber,
  totalRounds,
  totalScore,
}: RoundPromptProps) {
  return (
    <header className="hud">
      <div className="hud__chip">
        Round {roundNumber} / {totalRounds}
      </div>

      <div className="hud__prompt" key={location.id}>
        <span className="hud__label">Tap as close as you can to</span>
        <h1 className="hud__place">
          {location.name}
          {location.municipio && <span className="hud__municipio">{location.municipio}</span>}
        </h1>
        <div className="hud__tags">
          <span className={`tag tag--${location.category}`}>
            {SUBTYPE_LABELS[location.subtype]}
          </span>
          <span className={`tag tag--${location.difficulty}`}>
            {DIFFICULTY_LABELS[location.difficulty]}
          </span>
        </div>
      </div>

      <div className="hud__chip hud__chip--score">
        Score<strong>{totalScore.toLocaleString('en-US')}</strong>
      </div>
    </header>
  );
}
