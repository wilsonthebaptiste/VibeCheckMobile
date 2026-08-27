# VibeCheck Mobile — Build Progress

MVP scope: single feature — anonymous crowdsourced venue liveliness reporting.
No user accounts, no social layer, no venue control, single city launch.

## Current status: Chunk 6 complete — verified end-to-end on a physical
iPhone (2026-08-27). Chunks 1–5 are done and were verified the same way.
No further chunks are defined yet.

### Chunk 1 — Backend foundation ✅ complete (separate repo)
See `../VibeCheck/CLAUDE.md`. Venue/Report models, migrations, Django admin.

### Chunk 2 — Backend API layer ✅ complete (separate repo)
`GET /api/venues/nearby/`, `GET /api/venues/<id>/` (with time-decayed
aggregated liveliness), `POST /api/venues/<id>/reports/` (proximity check +
rate limiting), CORS configured.

### Chunk 3 — React Native app scaffold ✅ complete
- Expo project created (SDK 57 → downgraded to SDK 56 after an unresolved
  Expo Go crash bug, expo/expo#48390)
- Default "Home" tab repurposed as "Map"; tabs nested inside a Stack so
  `venue/[id]` can be pushed on top instead of being a tab
- `react-native-maps` + `expo-location` installed, iOS permission string
  configured in `app.json`
- Map screen: location permission → fetch nearby venues → render real pins
  → tap pin links to venue detail (still a placeholder)
- `.env`/`.env.example` set up for `EXPO_PUBLIC_API_URL`
- Anonymous persistent device UUID (`src/utils/device.ts`)
- Verified end-to-end on a physical iPhone via Expo Go
- **Known bug found/fixed during Chunk 4 (2026-08-24):** the Map screen's pin
  navigation didn't actually work — `Marker` children in `react-native-maps`
  replace the pin's rendered content rather than acting as a tappable overlay,
  and MapKit's native tap handling generally swallows touches meant for a
  nested `<Link>`/`<Pressable>` before they reach it. Fixed in
  `src/app/(tabs)/index.tsx` by moving navigation onto `Marker`'s own
  `onPress` prop with `useRouter().push(...)`, instead of nesting a `<Link>`
  inside the marker.

### Chunk 4 — Report submission flow ✅ complete

Goal: tap a venue → see its info + current status → pick a liveliness level
(1–5) → submit → see confirmation or a clear error → status refreshes.

1. [x] Build the real Venue Detail screen UI in `src/app/venue/[id].tsx`:
       fetch `GET /api/venues/<id>/`, display venue name/address/category
       plus `current_status`, add a liveliness picker (1–5, labeled
       Dead/Quiet/Moderate/Busy/Packed to match the backend's
       `Report.LIVELINESS_CHOICES`)
2. [x] Wire the submit button to `POST /api/venues/<id>/reports/`, using
       `getDeviceId()` and the device's current location (same
       `expo-location` pattern already used in the Map screen)
3. [x] Handle backend error responses distinctly: HTTP 403 = not close enough
       to the venue, HTTP 429 = already reported recently — surface the
       backend's `error` message text to the user for both
4. [x] After a successful submit (201), refetch the venue detail so
       `current_status` reflects the new report immediately
5. [x] Full end-to-end test: tap a venue pin on the Map screen → submit a
       real report → confirm the updated status appears on the detail screen
       — verified on a physical iPhone against a temporary test venue seeded
       at the tester's real location (happy path + 429 rate limit), and
       against the existing "Blue Cue" venue ~0.4mi away (403 proximity
       check). Backend contract (all status codes/response shapes) was also
       verified directly against the running Django server before the device
       pass. Picker/status UI reuses the app's `ThemedText`/`ThemedView`
       token system (`backgroundSelected`/`backgroundElement`), matching the
       same selected-chip pattern already used in the tab bar.

## Known environment gotchas
- Project is pinned to SDK 56 — see AGENTS.md before touching Expo APIs or
  upgrading
- Physical iPhone testing requires the sign.expo.dev + Expo Orbit (USB) path,
  not the App Store Expo Go build
- Backend must run via `python manage.py runserver 0.0.0.0:8000`, and its
  `ALLOWED_HOSTS` must include the dev machine's current LAN IP
- `EXPO_PUBLIC_API_URL` in `.env` must match that same current LAN IP —
  update both if you reconnect to a different WiFi network
### Chunk 5 — Real venues from OpenStreetMap ✅ complete

Replaced hand-seeded pins with real bars/pubs/nightclubs/biergartens sourced
from OSM via the Overpass API. Chosen over Google Places because it needs no
API key or billing account, and ODbL permits storing venue data indefinitely
(Google's terms cap coordinate caching at 30 days).

Tapping Google's *native* POI labels turned out to be impossible in Expo Go:
`onPoiClick` is Google-Maps-only on iOS, `PROVIDER_GOOGLE` needs a native key
injected at `expo prebuild`, and Expo Go ships a fixed binary that never runs
config plugins. Rendering our own markers over Apple Maps is the workable path
without a $99/yr dev build.

- `Venue` gained OSM provenance (`osm_type`, `osm_id`, `osm_synced_at`), unique
  on `(osm_type, osm_id)` so re-syncs upsert
- `venues/overpass.py`: tile cache, process-wide lock, failure backoff
- Address made optional — ~32% of OSM venues (the real Blue Cue included) have
  no `addr:*` tags at all
- **Two bugs found and fixed on device:** a pan crash from RN wrapping fetch
  aborts as plain `Error`s, and pans producing no new pins because the fetched
  centre was only claimed on success (so a slow cold sync aborted itself in a
  loop). Both fixes are still load-bearing — see mobile `CLAUDE.md`.

### Chunk 6 — Nationwide venues, search, and Yelp-style scores ✅ complete

Goal: every US venue available instantly, a search box that works nationwide,
and scores visible from the map as star ratings.

**The number that reframed the design:** OSM has **40,483** US bars/pubs/
nightclubs/biergartens, not the 100k+ first assumed. That is a ~7MB table, so
ingesting the whole country up front is entirely practical — which removes
Overpass from the request path completely.

1. [x] WAL mode + `OSM_LIVE_SYNC` kill switch. Also raised `VENUE_STALE_AFTER`
       30d → 365d: with lazy syncing off, the 30-day window would have silently
       blanked the entire map one month after the first ingest
2. [x] `venues/scoring.py` — one code path for every score. Plain 60-minute
       rolling mean (replaces time-decay weighting), one query for a whole
       queryset instead of 3 per venue
3. [x] `seed_reports` command — the DB had 0 reports, so nothing was visually
       verifiable without it
4. [x] `GET /api/venues/in-bounds/` — bbox only, server picks venues-vs-bins
       and returns the zoom envelope over which that choice stays valid
5. [x] `ingest_us` — 52 state boxes, ledger-based resume, retry-then-subdivide.
       **Full run: 40,611 venues in 39m53s, 51/51 regions, 0 duplicates,
       7.1MB, `OsmSyncTile` still 123 rows** (proof the 6.15M-row explosion
       was avoided)
6. [x] `GET /api/venues/search/` — local names on keystroke, Nominatim on
       submit only (their policy forbids autocomplete), with a required cache
7. [x] Mobile: map rewrite, `<StarRating>`, `<VenueCard>`, `<BinMarker>`,
       `<SearchBar>`; detail screen widened to fractional scores
8. [x] On-device end-to-end verification on a physical iPhone — search,
       fly-to, bins, pins, card, detail, report submission and score
       refresh all confirmed working

Verified so far (automated, against the running server):
- 79 backend tests pass
- `npx tsc --noEmit` clean
- Response contract matches `src/types/venue.ts` exactly
- Refetch-gate simulation: 23 region settles → 19 fetches, **zero
  oscillation**, marker count bounded (max 127) from street zoom to
  whole-country zoom and back
- Country view: 40,261 venues collapsed to 177 bubbles in 165ms

**One real bug caught by that simulation:** the server was deriving the zoom
envelope from the *expanded* served box while the client compares its own
viewport span, putting the client permanently below `valid_span_min` — it
would have refetched on every single region change when zoomed out. Fixed, and
pinned with a test.

### Chunk 6 follow-ups (found during on-device testing) ✅ complete

**Rating-render + expiry test data.** `seed_reports` gained `--reports-per-venue`
(exact count; `--max-reports` only ever gave a random 1–N), `--spread`,
`--expiring-soon` and `--expire-in`. `--spread` keeps values random but spaces
each venue's target *average* across 1.0–5.0, so a batch is guaranteed to
exercise 1-star, 5-star and the **half-star** glyph — a separate branch in
`StarRating` that random chance may never hit. `--expiring-soon` rigs venues so
half their reports leave the window together a few minutes out, making the
60-minute roll watchable instead of requiring an hour's wait.

**Tapping a pin selected its neighbour.** Reported on device: the card popped up
with one venue then jumped to the next. Two independent causes, both confirmed
in the react-native-maps source:

1. A single tap can deliver **more than one** marker press. Each marker gets its
   own `UITapGestureRecognizer` with `cancelsTouchesInView = NO`
   (`AIRMapMarker.m`), and `_handleTap:` fires `onPress` *and* calls
   `selectAnnotation:` — with overlapping views those resolve to different
   markers, and each one called `setSelected`.
2. No marker passed `zIndex`, so every `zPriority` was 0 and MapKit had no
   defined stacking order among overlapping pins — the same tap could resolve
   to a different venue as the map moved.

This is not an edge case: one street-zoom viewport over Sacramento holds **28
venue pairs whose pins physically overlap** (The Golden Bear ↔ Der Biergarten
40 ft, Blue Cue ↔ Barwest Midtown 69 ft). Fixed with a 250ms press lockout
(first press wins — that is the marker that hit-tested topmost), latitude-ranked
`zIndex` for stable stacking, and a distinct colour on the selected pin so it is
identifiable underneath the card. Pins keep their true coordinates; spreading or
clustering them was considered and rejected, since report submission is gated on
physically standing near the venue.
