import { useEffect } from 'react';
import L from 'leaflet';
import {
  MapContainer,
  Marker,
  Polyline,
  TileLayer,
  Tooltip,
  ZoomControl,
  useMap,
  useMapEvents,
} from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import type { GameLocation } from '../data/locations';
import type { LatLng } from '../lib/scoring';

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
}

function ViewController({ roundIndex, revealed, guess, target }: ViewControllerProps) {
  const map = useMap();

  useEffect(() => {
    map.flyTo(INITIAL_CENTER, INITIAL_ZOOM, { duration: 0.8 });
  }, [roundIndex, map]);

  useEffect(() => {
    if (revealed && guess && target) {
      const bounds = L.latLngBounds([guess.lat, guess.lng], [target.lat, target.lng]);
      map.flyToBounds(bounds.pad(0.4), { duration: 0.8, maxZoom: 13 });
    }
  }, [revealed, guess, target, map]);

  return null;
}

interface MapViewProps {
  roundIndex: number;
  interactive: boolean;
  revealed: boolean;
  guess: LatLng | null;
  target: GameLocation | null;
  onGuess: (guess: LatLng) => void;
}

export default function MapView({
  roundIndex,
  interactive,
  revealed,
  guess,
  target,
  onGuess,
}: MapViewProps) {
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
        <ViewController roundIndex={roundIndex} revealed={revealed} guess={guess} target={target} />

        {revealed && guess && target && (
          <>
            <Polyline
              positions={[
                [guess.lat, guess.lng],
                [target.lat, target.lng],
              ]}
              pathOptions={{
                color: '#ffffff',
                weight: 2.5,
                opacity: 0.9,
                dashArray: '6 8',
                className: 'guess-line',
              }}
            />
            <Marker position={[guess.lat, guess.lng]} icon={GUESS_ICON}>
              <Tooltip direction="top" permanent className="map-tag map-tag--guess">
                Tu toque
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
