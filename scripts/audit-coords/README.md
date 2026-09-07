# audit-coords

Re-verifies the coordinates in `src/data/curated.ts` against the independent
sources recorded in `src/data/landmark-references.ts`.

```bash
node scripts/audit-coords/audit-coords.mjs          # local checks only, no network
node scripts/audit-coords/audit-coords.mjs --live   # also re-fetch OSM objects by id
```

Exits non-zero on any problem, so it works in CI, but it is not wired into the
build.

## What it checks

Every curated landmark must have a reference, every reference must belong to a
landmark that still exists, and the names must still agree — a rename that
swaps two rows would otherwise silently repoint a reference at the wrong place.

The real assertion is the last one: **a landmark's acceptance circle must
actually contain the real landmark.** A row with `radiusKm` is checked against
its own radius; a row with a `geoid` scores by polygon instead, so its point
only aims the reveal camera and is checked against a loose 5 km bound.

`--live` adds one thing the offline checks cannot do: it re-fetches every
`osm:` reference by id and reports drift, catching a way that has been redrawn,
retagged or deleted upstream since the reference was recorded. GNIS references
are a static federal dataset and are not re-fetched.

## When to run it

- After editing any landmark coordinate, radius, or reference.
- With `--live` occasionally — quarterly is plenty — to catch upstream drift.
- When a player reports that an answer is in the wrong place.

For everyday work you do not need this script at all. The same invariant is
asserted offline by `src/data/landmark-coords.test.ts`, which runs in
`npm test`. This tool exists for the network half and for readable output when
something is actually wrong.

## Why it looks objects up by id, not by name

This matters, and the instinct to "improve" it by searching for names is the
thing to resist.

The audit that originally found six bad coordinates searched by name, and both
obvious ways to rank the candidates produced confident wrong answers:

| Ranking | Failure |
|---|---|
| By distance | Confirms whatever coordinate is already in the file. A 4 km error simply matches something 4 km away and reads as a pass. This is how the Camuy and Cueva Ventana defects survived review in the first place. |
| By name | `Cabo Rojo` matches the **municipality**, 13.6 km from the lighthouse — and the bad point falls *inside* its polygon, so even a containment check reads as a pass. `El Vigía` matches a same-named building 75 km away. |

Only a bounding box **and** a name filter together resolved the ambiguous
cases. Recording the resolved object id in `landmark-references.ts` retires the
problem entirely: re-verification becomes a direct lookup with nothing left to
rank.

## Two implementation notes

Overpass is queried once for every id rather than once per landmark, because it
rate-limits aggressively and answers `429` with no body.

The drift tolerance scales with each object's own size. `out bb` returns a
bounding box, whose centre is not an area centroid, so the two disagree more
the larger and less symmetric the object is — a fixed 0.5 km limit flagged the
airport relation at 0.522 km as a false positive. Half the bbox diagonal is the
most a bbox centre can sit from any point inside it, which is the honest bound.
(`out bb center` looks tidier but silently drops `bounds`, leaving nothing to
size the tolerance with.)

## Related

- `src/data/landmark-references.ts` — the reference coordinates and their
  provenance, plus guidance on which source to trust for which kind of feature.
- `src/data/landmark-coords.test.ts` — the same invariant, offline, in
  `npm test`.
