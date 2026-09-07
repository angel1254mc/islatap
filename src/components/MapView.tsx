import { useEffect } from 'react';
import L from 'leaflet';
import {
  Circle,
  MapContainer,
  Marker,
  Polygon,
  Polyline,
  TileLayer,
  Tooltip,
  ZoomControl,
  useMap,
  useMapEvents,
} from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import {
  haversineKm,
  nearestPointOnCircle,
  nearestPointOnShape,
  type MultiPolygon,
  type LatLng,
} from '../lib/scoring';
import DebugOverlays from './DebugOverlays';

/**
 * Everything the reveal needs to know about the answer. Deliberately not
 * GameLocation: the daily mode learns the answer from a guess response, which
 * carries exactly these fields, and importing GameLocation here would drag the
 * whole bundled location table into the map's import graph.
 */
export interface TargetView {
  lat: number;
  lng: number;
  name: string;
}

// Base imagery is isolated here so the provider can be swapped later.
const BASE_LAYER_URL =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const BASE_LAYER_ATTRIBUTION =
  'Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics';

// Puerto Rico archipelago: main island plus Vieques, Culebra, Mona, Desecheo,
// and Caja de Muertos.
const PR_BOUNDS = L.latLngBounds([17.8, -68.0], [18.6, -65.1]);
const INITIAL_CENTER: L.LatLngTuple = [18.22, -66.35];
const INITIAL_ZOOM = 9;
const MIN_ZOOM = 9;
const MAX_ZOOM = 16;

// Leaflet's default icon URLs break under bundlers, so pins are explicit
// divIcons with inline SVG instead.
function pinIcon(color: string): L.DivIcon {
  return L.divIcon({
    className: 'pin-icon',
    html: `<svg width="34" height="46" viewBox="0 0 34 46" aria-hidden="true">
      <path d="M17 45C17 45 4 26.6 4 15a13 13 0 1 1 26 0c0 11.6-13 30-13 30z" fill="${color}" stroke="rgba(255,255,255,0.95)" stroke-width="2.5"/>
      <circle cx="17" cy="15" r="5" fill="rgba(255,255,255,0.95)"/>
    </svg>`,
    iconSize: [34, 46],
    iconAnchor: [17, 45],
    tooltipAnchor: [0, -42],
  });
}

const GUESS_ICON = pinIcon('#ff5d73');
const TARGET_ICON = pinIcon('#2dd4a7');

/**
 * The ping shown under the pin while a guess is in flight.
 *
 * A divIcon rather than a Leaflet <Circle>: a Circle's radius is in meters, so
 * it would grow and shrink with zoom and would need a JS animation loop to
 * expand. This is a UI affordance, not a geographic quantity — it wants a fixed
 * pixel size at every zoom level, which CSS gives for free while Leaflet keeps
 * the icon anchored to the tapped coordinate through pans and zooms.
 */
const SONAR_ICON = L.divIcon({
  className: 'sonar-icon',
  html: '<span class="sonar-ring"></span><span class="sonar-ring"></span><span class="sonar-ring"></span>',
  iconSize: [140, 140],
  iconAnchor: [70, 70],
});

interface ClickHandlerProps {
  enabled: boolean;
  onGuess: (guess: LatLng) => void;
}

function ClickHandler({ enabled, onGuess }: ClickHandlerProps) {
  useMapEvents({
    click(event) {
      if (enabled) {
        onGuess({ lat: event.latlng.lat, lng: event.latlng.lng });
      }
    },
  });
  return null;
}

interface ViewControllerProps {
  roundIndex: number;
  revealed: boolean;
  guess: LatLng | null;
  target: TargetView | null;
  targetShape: MultiPolygon | null;
  targetRadiusKm: number | null;
}

// Some municipio shapes include distant offshore parts as separate polygon parts —
// e.g. Mayagüez (geoid 72097) includes Isla de Mona, ~92 km off the west coast.
// Extending the reveal bounds to cover those parts pushes the viewport past
// MIN_ZOOM and centers the camera on open ocean instead of the mainland shape, so
// parts whose nearest vertex is far from the target are excluded from the bounds.
const FAR_PART_KM = 25;

function ViewController({
  roundIndex,
  revealed,
  guess,
  target,
  targetShape,
  targetRadiusKm,
}: ViewControllerProps) {
  const map = useMap();

  useEffect(() => {
    map.flyTo(INITIAL_CENTER, INITIAL_ZOOM, { duration: 0.8 });
  }, [roundIndex, map]);

  useEffect(() => {
    if (revealed && guess && target) {
      const bounds = L.latLngBounds([guess.lat, guess.lng], [target.lat, target.lng]);
      if (targetShape) {
        for (const part of targetShape) {
          const outer = part[0]; // outer ring only
          const nearestKm = outer.reduce(
            (min, [lat, lng]) => Math.min(min, haversineKm(target, { lat, lng })),
            Infinity,
          );
          if (nearestKm > FAR_PART_KM) continue;
          for (const point of outer) bounds.extend(point as L.LatLngTuple);
        }
      } else if (targetRadiusKm) {
        bounds.extend(L.latLng(target.lat, target.lng).toBounds(targetRadiusKm * 2000));
      }
      // Point reveals may zoom closer than shape reveals: a near-miss on a
      // 50 m acceptance circle is invisible at zoom 13.
      map.flyToBounds(bounds.pad(targetShape ? 0.15 : 0.4), {
        duration: 0.8,
        maxZoom: targetShape ? 13 : 15,
      });
    }
  }, [revealed, guess, target, targetShape, targetRadiusKm, map]);

  return null;
}

interface MapViewProps {
  roundIndex: number;
  interactive: boolean;
  /** A guess is in flight: show the ping. False in 'guess-error', so the rings stop while the retry panel is up. */
  pending: boolean;
  revealed: boolean;
  guess: LatLng | null;
  target: TargetView | null;
  targetShape: MultiPolygon | null;
  targetRadiusKm: number | null;
  inside: boolean;
  onGuess: (guess: LatLng) => void;
}

export default function MapView({
  roundIndex,
  interactive,
  pending,
  revealed,
  guess,
  target,
  targetShape,
  targetRadiusKm,
  inside,
  onGuess,
}: MapViewProps) {
  // Outside guesses point at the nearest boundary (polygon edge or acceptance
  // circle edge), not the internal point; inside guesses get no line at all.
  const lineEnd: LatLng | null =
    revealed && guess && target && !inside
      ? targetShape
        ? nearestPointOnShape(guess, targetShape).point
        : targetRadiusKm
          ? nearestPointOnCircle(guess, target, targetRadiusKm)
          : { lat: target.lat, lng: target.lng }
      : null;

  return (
    <div className={`map-shell${interactive ? ' map-shell--armed' : ''}`}>
      <MapContainer
        className="map-root"
        center={INITIAL_CENTER}
        zoom={INITIAL_ZOOM}
        minZoom={MIN_ZOOM}
        maxZoom={MAX_ZOOM}
        maxBounds={PR_BOUNDS}
        maxBoundsViscosity={1.0}
        zoomControl={false}
      >
        <TileLayer url={BASE_LAYER_URL} attribution={BASE_LAYER_ATTRIBUTION} />
        <ZoomControl position="bottomleft" />
        <ClickHandler enabled={interactive} onGuess={onGuess} />
        <DebugOverlays />
        <ViewController
          roundIndex={roundIndex}
          revealed={revealed}
          guess={guess}
          target={target}
          targetShape={targetShape}
          targetRadiusKm={targetRadiusKm}
        />

        {revealed && targetShape &&
          targetShape.map((part, index) => (
            <Polygon
              key={index}
              positions={part}
              pathOptions={{ color: '#2dd4a7', weight: 2, fillColor: '#2dd4a7', fillOpacity: 0.15 }}
            />
          ))}

        {revealed && !targetShape && target && targetRadiusKm && (
          <Circle
            center={[target.lat, target.lng]}
            radius={targetRadiusKm * 1000}
            pathOptions={{ color: '#2dd4a7', weight: 2, fillColor: '#2dd4a7', fillOpacity: 0.15 }}
          />
        )}

        {pending && guess && (
          <Marker
            position={[guess.lat, guess.lng]}
            icon={SONAR_ICON}
            interactive={false}
            zIndexOffset={-1000}
          />
        )}

        {guess && (
          // Outside the `revealed` block on purpose. The marker mounts the
          // instant the player taps and must stay mounted through the reveal.
          // If it remounted, the pin-drop animation in index.css would replay
          // and the coral pin would visibly bounce a second time, making the
          // reveal read as one simultaneous event. Keeping it mounted is what
          // staggers the reveal instead: your pin is already there, and the
          // answer arrives to meet it.
          //
          // There is no automated test for this — the repo runs Vitest under
          // `environment: 'node'` and has no component tests — so verify it by
          // eye if you touch this block. Confirmed on the deployed preview by
          // capturing the pin's DOM node while the guess was in flight and
          // checking document.contains(node) after the reveal.
          <Marker position={[guess.lat, guess.lng]} icon={GUESS_ICON}>
            {revealed && (
              <Tooltip direction="top" permanent className="map-tag map-tag--guess">
                {inside ? '¡Adentro!' : 'Tu toque'}
              </Tooltip>
            )}
          </Marker>
        )}

        {revealed && guess && target && (
          <>
            {lineEnd && (
              <Polyline
                positions={[
                  [guess.lat, guess.lng],
                  [lineEnd.lat, lineEnd.lng],
                ]}
                pathOptions={{
                  color: '#ffffff',
                  weight: 2.5,
                  opacity: 0.9,
                  dashArray: '6 8',
                  className: 'guess-line',
                }}
              />
            )}
            <Marker position={[target.lat, target.lng]} icon={TARGET_ICON}>
              <Tooltip direction="top" permanent className="map-tag map-tag--target">
                {target.name}
              </Tooltip>
            </Marker>
          </>
        )}
      </MapContainer>
    </div>
  );
}
