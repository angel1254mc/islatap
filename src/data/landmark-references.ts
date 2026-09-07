// Independent reference coordinates for every curated landmark, with provenance.
//
// WHY THIS FILE EXISTS
// --------------------
// curated.ts once claimed its landmarks were "individually verified" while
// carrying six coordinates that put the answer outside its own acceptance
// circle -- Cueva Ventana by 3.9 km, the Camuy caves by 4.6 km. Two of the six
// were not estimates but substitutions: a same-named administrative record had
// been copied in place of the landmark.
//
//   Castillo San Cristóbal  <- GNIS "San Cristóbal Subbarrio" [Civil]
//   Parque de Bombas        <- GNIS "Ponce" [Populated Place]
//
// Both look plausible next to the real thing, which is exactly why eyeballing
// missed them: the San Cristóbal subbarrio centroid is 250 m north of the
// fort, out over the cliff into the Atlantic, and the Ponce town point sits on
// Plaza Las Delicias a block from the firehouse.
//
// Every row below was resolved from a named feature in an external gazetteer,
// never from curated.ts. landmark-coords.test.ts asserts that each landmark's
// acceptance circle actually contains its reference, which is the property all
// six defects violated. Regenerate with: node scripts/audit-coords.mjs
//
// CHOOSING A SOURCE
//   gnis:<feature_id>  USGS Geographic Names Information System, the federal
//     authority. Best for natural features -- summits, capes, beaches,
//     islands. It has no entry for modern tourist sites, and its two
//     "(historical) Military" fort points are themselves 200-250 m off, so it
//     is the wrong source for the forts.
//   osm:<type>/<id>    OpenStreetMap. Best for buildings and man-made
//     landmarks, because it carries real footprint polygons -- containment is
//     a stronger test than distance to a single point.
//
// Deliberately NOT used: Census TIGER. Reaching into an administrative layer
// for a landmark point is the bug this file exists to prevent.

/** A landmark's true position, established independently of curated.ts. */
export interface LandmarkReference {
  /** GameLocation.id in curated.ts. */
  id: number;
  /** Name at the time of writing, for readability only; the id is the key. */
  name: string;
  lat: number;
  lng: number;
  /** `gnis:<feature_id>` or `osm:<type>/<id>` -- resolvable, not a bare claim. */
  source: string;
  /** Only when the reference needs justifying beyond its source id. */
  note?: string;
}

export const LANDMARK_REFERENCES: LandmarkReference[] = [
  // --- San Juan forts and palace: OSM footprints, not GNIS ------------------
  { id: 79, name: 'Castillo San Felipe del Morro', lat: 18.47087, lng: -66.124317, source: 'osm:way/561634537' },
  { id: 80, name: 'Castillo San Cristóbal', lat: 18.46728, lng: -66.110809, source: 'osm:way/142863669',
    note: 'Was the San Cristóbal subbarrio centroid (GNIS 1: 18.4692798,-66.111866), 250 m north of the fort and in the water.' },
  { id: 81, name: 'La Fortaleza', lat: 18.464182, lng: -66.119254, source: 'osm:relation/3501975' },

  // --- Man-made landmarks with no GNIS entry --------------------------------
  { id: 82, name: 'Observatorio de Arecibo', lat: 18.34623, lng: -66.752309, source: 'osm:node/1024483397',
    note: 'Curated point is the dish centre, 234 m away against radiusKm 0.25 -- only 16 m of margin.' },
  { id: 90, name: 'Cabo Rojo (Faro Los Morrillos)', lat: 17.933653, lng: -67.192189, source: 'osm:way/206528023',
    note: 'The lighthouse building. GNIS "Cabo Rojo" is the cape, 712 m away, and the municipio shares the name.' },
  { id: 96, name: 'Parque de las Cavernas del Río Camuy', lat: 18.343992, lng: -66.826188, source: 'osm:way/268778721',
    note: 'Centroid of the reserve polygon. Cueva Clara, the cave visitors actually tour, is 690 m east and outside radiusKm 0.3.' },
  { id: 97, name: 'Cueva Ventana', lat: 18.3712185, lng: -66.6915575, source: 'osm:node/4185357807' },
  { id: 98, name: 'Destilería Bacardí', lat: 18.457888, lng: -66.14068, source: 'osm:way/60252378' },
  { id: 99, name: 'Aeropuerto Luis Muñoz Marín', lat: 18.4431995, lng: -65.9974304, source: 'osm:relation/6004891' },
  { id: 100, name: 'Parque de Bombas de Ponce', lat: 18.011908, lng: -66.613742, source: 'osm:way/88319416',
    note: 'Was the GNIS "Ponce" town point (1: 18.0110768,-66.6140616), 98 m out against radiusKm 0.08.' },
  { id: 101, name: 'La Guancha (Ponce)', lat: 17.96543, lng: -66.614949, source: 'osm:way/317002115',
    note: 'The Paseo Tablado boardwalk itself; the community-centre node 390 m southwest also carries the name.' },

  // --- Natural features: GNIS is authoritative -------------------------------
  { id: 83, name: 'El Yunque', lat: 18.3105057, lng: -65.7912759, source: 'gnis:1611657' },
  { id: 84, name: 'Cerro de Punta', lat: 18.172281, lng: -66.5916862, source: 'gnis:1609905' },
  { id: 85, name: 'Isla de Mona', lat: 18.081345, lng: -67.8912971, source: 'gnis:1611188' },
  { id: 86, name: 'Isla de Culebra', lat: 18.3146783, lng: -65.2829352, source: 'gnis:1611182' },
  { id: 87, name: 'Isla de Vieques', lat: 18.1230192, lng: -65.4162695, source: 'gnis:1612910' },
  { id: 88, name: 'Isla Caja de Muertos', lat: 17.8946917, lng: -66.5198926, source: 'gnis:1611179' },
  { id: 89, name: 'Isla Desecheo', lat: 18.3840427, lng: -67.4807507, source: 'gnis:2575416' },
  { id: 91, name: 'Playa Flamenco', lat: 18.3280112, lng: -65.3162695, source: 'gnis:1611706' },
  { id: 92, name: 'Balneario de Luquillo', lat: 18.38495, lng: -65.7301626, source: 'gnis:1609601' },
  { id: 93, name: 'Playa Sun Bay', lat: 18.096909, lng: -65.4604365, source: 'gnis:1992553' },
  { id: 94, name: 'Playa Boquerón', lat: 18.0102408, lng: -67.1754569, source: 'gnis:1991868' },
  { id: 95, name: 'Bahía Mosquito (Bio Bay)', lat: 18.0980202, lng: -65.4412696, source: 'gnis:1992548',
    note: 'Mosquito Bay Beach. The bay proper (OSM "Puerto Mosquito") is 553 m north, just outside radiusKm 0.5.' },
  { id: 102, name: 'El Vigía (Ponce)', lat: 18.0213715, lng: -66.6200457, source: 'gnis:1990933',
    note: 'Cerro el Vigía, the hill. The Cruceta monument is 259 m south and outside radiusKm 0.15.' },
  { id: 103, name: 'Monte Guilarte', lat: 18.141562, lng: -66.7689796, source: 'gnis:1611536' },
  { id: 104, name: 'Faro de Punta Tuna', lat: 17.9883007, lng: -65.8848843, source: 'gnis:1611868' },
];
