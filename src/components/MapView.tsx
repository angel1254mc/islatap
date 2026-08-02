import { useEffect, useState } from 'react';
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
import type { GameLocation } from '../data/locations';
import {
  haversineKm,
  nearestPointOnShape,
  pointTowardKm,
  type MultiPolygon,
  type LatLng,
} from '../lib/scoring';
import { getShapesByLayer, startShapeLoad, type ShapeLayer } from '../lib/shapes';

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
  target: GameLocation | null;
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
  revealed: boolean;
  guess: LatLng | null;
  target: GameLocation | null;
  targetShape: MultiPolygon | null;
  targetRadiusKm: number | null;
  inside: boolean;
  onGuess: (guess: LatLng) => void;
}

export default function MapView({
  roundIndex,
  interactive,
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
          ? pointTowardKm(target, guess, targetRadiusKm)
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
        {DEBUG_SHAPES && <DebugShapesOverlay />}
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
            <Marker position={[guess.lat, guess.lng]} icon={GUESS_ICON}>
              <Tooltip direction="top" permanent className="map-tag map-tag--guess">
                {inside ? '¡Adentro!' : 'Tu toque'}
              </Tooltip>
            </Marker>
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
