// URL-only QA overlays, kept out of MapView because none of this is game state.
//
// Both are read once at module load and never react to anything: switching one
// on means editing the address bar and reloading. Neither renders unless its
// flag is present, so <DebugOverlays /> is inert on a normal visit.
//
//   ?debug=shapes     every boundary outline at once, to eyeball edge alignment
//                     against the imagery. &layer=barrio|comunidad|subbarrio|all
//                     switches the Census layer.
//   ?debug=landmarks  every curated landmark: acceptance circle, the ref point
//                     it is checked against, and a line joining the two.
//
// MapView only mounts mid-round, so reaching either means starting a game.
// Practice is the cheap way in -- it scores on the client and needs no server.
import { Fragment, useEffect, useState } from 'react';
import { Circle, CircleMarker, Polygon, Polyline, Tooltip } from 'react-leaflet';
import { haversineKm } from '../lib/scoring';
import { getShapesByLayer, startShapeLoad, type ShapeLayer } from '../lib/shapes';

// Boundary QA overlay: ?debug=shapes renders every municipio outline at once so
// edge alignment between neighbors can be eyeballed against the imagery;
// &layer=barrio|comunidad|subbarrio|all switches the Census layer. Read once at
// module load — it's a URL-only debug tool with no game-state interaction.
const DEBUG_QUERY = new URLSearchParams(window.location.search);
const DEBUG_SHAPES = DEBUG_QUERY.get('debug') === 'shapes';
const DEBUG_LAYERS: readonly ShapeLayer[] = ['municipio', 'barrio', 'comunidad', 'subbarrio', 'all'];
const DEBUG_LAYER: ShapeLayer = (DEBUG_LAYERS as readonly string[]).includes(
  DEBUG_QUERY.get('layer') ?? '',
)
  ? (DEBUG_QUERY.get('layer') as ShapeLayer)
  : 'municipio';

// Landmark QA overlay: ?debug=landmarks draws every curated landmark with its
// acceptance circle and its independently sourced reference point, so an
// answer sitting off its own landmark is visible against the imagery rather
// than inferred from a number.
//
// This is the sibling ?debug=shapes never had. Boundary rows could always be
// eyeballed; the 26 rows that score by radius could not, and six of them were
// wrong for months -- one of them 250 m out over the Atlantic -- because
// nothing in the app ever drew them.
const DEBUG_LANDMARKS = DEBUG_QUERY.get('debug') === 'landmarks';

function DebugShapesOverlay() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let mounted = true;
    void startShapeLoad().then(() => {
      if (mounted) setReady(true);
    });
    return () => {
      mounted = false;
    };
  }, []);

  if (!ready) return null;
  return (
    <>
      {getShapesByLayer(DEBUG_LAYER).map(([geoid, shape]) =>
        shape.map((part, index) => (
          <Polygon
            key={`${geoid}-${index}`}
            positions={part}
            interactive={false}
            pathOptions={{ color: '#38bdf8', weight: 1, fillColor: '#38bdf8', fillOpacity: 0.04 }}
          />
        )),
      )}
    </>
  );
}

interface DebugLandmark {
  id: number;
  name: string;
  lat: number;
  lng: number;
  radiusKm: number | null;
  ref: { lat: number; lng: number; source: string } | null;
  km: number | null;
}

function DebugLandmarksOverlay() {
  const [rows, setRows] = useState<DebugLandmark[]>([]);

  useEffect(() => {
    let mounted = true;
    // Dynamic, for the same reason loadPracticeGame() is: a static edge from
    // MapView into curated.ts would pull the whole location table into the
    // first-load bundle for every daily player, undoing the chunk split.
    void import('../data/curated').then(({ CURATED_LOCATIONS }) => {
      if (!mounted) return;
      setRows(
        CURATED_LOCATIONS.filter((l) => l.category === 'landmark').map((l) => ({
          id: l.id,
          name: l.name,
          lat: l.lat,
          lng: l.lng,
          radiusKm: l.radiusKm ?? null,
          ref: l.ref ?? null,
          km: l.ref ? haversineKm(l, l.ref) : null,
        })),
      );
    });
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <>
      {rows.map((row) => {
        // Red is the whole point of the overlay: the acceptance circle does
        // not reach the real landmark, so the round cannot be won by tapping
        // the right place. Amber is a healthy circle.
        const broken = row.km != null && row.radiusKm != null && row.km > row.radiusKm;
        const color = broken ? '#ef4444' : '#f59e0b';
        const label =
          `${row.name}` +
          (row.radiusKm != null ? ` — r ${row.radiusKm} km` : ' — scored by shape') +
          (row.km != null ? `, ref ${row.km.toFixed(3)} km (${row.ref?.source})` : '');

        return (
          <Fragment key={row.id}>
            {row.radiusKm != null && (
              <Circle
                center={[row.lat, row.lng]}
                radius={row.radiusKm * 1000}
                interactive={false}
                pathOptions={{ color, weight: 1.5, fillColor: color, fillOpacity: 0.12 }}
              />
            )}
            {/* Reference and answer joined by a line, so a drift reads as a
                visible offset even when both dots overlap at low zoom. */}
            {row.ref && (
              <Polyline
                positions={[
                  [row.lat, row.lng],
                  [row.ref.lat, row.ref.lng],
                ]}
                interactive={false}
                pathOptions={{ color: '#ffffff', weight: 1, opacity: 0.7 }}
              />
            )}
            {row.ref && (
              <CircleMarker
                center={[row.ref.lat, row.ref.lng]}
                radius={4}
                pathOptions={{ color: '#22c55e', weight: 2, fillColor: '#22c55e', fillOpacity: 1 }}
              >
                <Tooltip>{`reference: ${row.ref.source}`}</Tooltip>
              </CircleMarker>
            )}
            <CircleMarker
              center={[row.lat, row.lng]}
              radius={5}
              pathOptions={{ color: '#ffffff', weight: 2, fillColor: color, fillOpacity: 1 }}
            >
              <Tooltip>{label}</Tooltip>
            </CircleMarker>
          </Fragment>
        );
      })}
    </>
  );
}

/**
 * Renders whichever QA overlay the URL asked for, or nothing at all.
 *
 * One component rather than two exported flags so MapView carries a single
 * inert line instead of knowing which debug modes exist.
 */
export default function DebugOverlays() {
  if (DEBUG_SHAPES) return <DebugShapesOverlay />;
  if (DEBUG_LANDMARKS) return <DebugLandmarksOverlay />;
  return null;
}
