# VibeCheck Mobile — Build Progress

MVP scope: single feature — anonymous crowdsourced venue liveliness reporting.
No user accounts, no social layer, no venue control, single city launch.

## Current status: Chunk 7 steps 1–2 complete and **verified on a physical
iPhone in Expo Go** (2026-08-27) — all ten test-plan steps passed. Steps 3–4
(native build + real background geofencing) are written but **not yet run**:
they need a CI build and a Sideloadly install, which is the next action.
Chunks 1–6 are complete and were verified end-to-end the same way.

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

### Chunk 7 — "Going to" intent, arrival & dwell notifications

Goal: stop relying on people remembering to open the app. Declare you're
heading somewhere, and the phone prompts you at the two moments a report is
actually worth writing — on arrival, and again once you've settled in.

**The constraint that shaped this.** Expo Go cannot do background location or
geofencing (SDK 56 docs: *"You must use a development build…"*). Since the
notifications must fire with the app closed, Expo Go can't be the final target.
Research settled it: from Apple's developer forums, **`UIBackgroundModes` is an
Info.plist property, not an entitlement** — so background location needs no
signed entitlement and a **free** Apple ID can ship it. Only *push* needs the
entitlement a free account lacks, and this feature uses only **local**
notifications, which work in Expo Go and in a native build alike. That makes a
$0 path real: `expo prebuild` → GitHub Actions `macos-latest` (free and
unlimited for public repos) → unsigned IPA → Sideloadly + free Apple ID over
USB, re-signed every 7 days (~30s, no rebuild).

Sequencing is **feature first, then go native**: steps 1–2 are fully testable in
Expo Go today, and step 4 changes exactly one effect.

#### Step 1 — Backend intent model ✅ complete (separate repo)

`VisitIntent`, with `device_id` **unique** — that constraint *is* the "only one
venue per device" rule, since declaring is an `update_or_create` and a new
declaration overrides the old one by construction rather than by cleanup code.
Endpoints: `PUT /api/venues/<pk>/intent/`, `GET`/`DELETE /api/intent/`,
`POST /api/intent/arrived/`, `GET /api/venues/here/`. The threshold selection
was extracted out of `submit_report` into `proximity_threshold_for(venue)` so
arrival and submission can never disagree. New `manage.py create_test_venue`.

- **101 → 154 backend tests**, all passing.
- Two subtle traps caught and pinned with tests: `created_at` must **not** be
  `auto_now_add` (it only fires on INSERT, so an upsert would keep the original
  timestamp and a re-declared intent could be born already past its TTL), and
  `/venues/here/`'s bbox pre-filter must correct longitude by `cos(lat)` — at
  64°N a degree of longitude is 30 mi, not 69. Both were verified by breaking
  the code and confirming the test fails.

#### Step 2 — Notifications, UI, intent logic ✅ complete, device-verified

`expo-notifications` (via `npx expo install`), `src/utils/notifications.ts`,
`src/utils/visit-intent.ts`, `src/utils/distance.ts`,
`src/hooks/use-visit-intent.tsx` (mounted at the app root),
`src/components/going-button.tsx` in the venue card and the detail screen.
Three notifications: nudge at `nudge_minutes`, arrival, and a **scheduled**
dwell prompt at arrival + `dwell_minutes` (scheduled, not `setTimeout`, so it
survives the app being closed). Arrival uses foreground `watchPositionAsync`
for now — that one effect becomes `startGeofencingAsync` in step 4.

Verified before it reaches the phone:
- `./node_modules/.bin/tsc --noEmit` clean
- Every endpoint exercised over HTTP against the running server
- **Client/server arrival agreement simulation**: 58 positions, including a
  dense sweep through the 0.1 mi boundary, comparing the client's local
  haversine decision against what the server actually answers. Zero
  disagreements, and **zero positions where the client would POST forever**
  because it thinks it arrived and the server keeps saying 403. That loop would
  have been completely silent on a device.

All ten device steps passed on 2026-08-27, including the two that matter
most: declaring on Far Bar never fired an arrival, and the dwell prompt fired
with the app fully swiped closed.

#### Step 3 — Native build ✅ written, ⏳ never run

`.github/workflows/ios-build.yml` — manual trigger, `macos-latest` (free and
unlimited for public repos), `expo prebuild` → `xcodebuild archive` with signing
disabled → unsigned `.ipa` artifact. `expo-dev-client` added so the JS loop
stays as fast as Expo Go. `ios/`/`android/` stay gitignored (Continuous Native
Generation) — `app.json` plus config plugins remain the single source of truth,
and the Windows dev machine never has to prebuild, which it cannot do for iOS.

**The trap this turned up:** `expo-notifications` ships an `app.plugin.js`, so
Expo autolinking applies its config plugin *whether or not it is listed in
app.json*, and it sets **`aps-environment`** — the remote-push entitlement, and
precisely the one a free Apple ID cannot sign. VibeCheck sends only local
notifications, so it bought nothing and would have broken sideloading with a
provisioning-profile error that never mentions notifications.
`plugins/with-no-push-entitlement.js` strips it, and the workflow fails the
build if it ever returns. Verified via `expo config --type introspect`:
entitlements are now `{}` while `UIBackgroundModes` keeps `location`.

#### Step 4 — Real geofencing ✅ written, ⏳ untested

`expo-task-manager` + `Location.startGeofencingAsync`. Arrival logic was
factored out of the React hook into `src/utils/arrival.ts` first, because iOS
runs a **headless** JS context when it wakes a terminated app — there is no
provider and no state to set there.

Geofencing **supplements** the foreground watcher rather than replacing it, and
that is deliberate: iOS only fires ENTER on *crossing* a boundary, so declaring
while already inside the radius (exactly what the device test does, since the
test venue is at your feet) may fire nothing at all. Each covers the other's
blind spot, and both funnel into the same idempotent `completeArrival`.

### Chunk 7 device test plan

Two levers make this testable without going anywhere.

1. `python manage.py create_test_venue` seeds **VibeCheck Test Bar** at
   38.5796707, -121.4678853 (2711 E St, Sacramento — a house-level Nominatim
   match) and **VibeCheck Far Bar** 0.5 mi north. The far one is the point:
   without it, "arrival fired" proves nothing, because a bug that fires arrival
   unconditionally also passes.
2. Set `DWELL_MINUTES = 2` in the backend's `settings.py` while testing. It is
   served to the client, so switching back to 30 needs no app change.

| # | Step | Expected |
|---|---|---|
| 1 | Declare "going" on **Far Bar** | No arrival notification, ever |
| 2 | Declare on **Test Bar** | Backend holds exactly **one** `VisitIntent` row, now pointing at Test Bar (check `/admin/`) |
| 3 | Wait ~15s | "You made it." with **Yes** / **Not right now** |
| 4 | Tap **Not right now** | Dismisses; the intent stays arrived |
| 5 | Tap **Yes** | Opens Test Bar's report screen; submit and confirm the score updates |
| 6 | Wait 2 minutes | The dwell prompt fires |
| 7 | Re-declare, arrive, then fully background the app before the timer | Dwell still fires |
| 8 | Declare, then tap **Cancel** | No notifications after; backend row gone |
| 9 | With the app open and foregrounded | A visible banner. If not, `shouldShowBanner` is wrong |
| 10 | *(after step 4 only)* Kill the app, then approach Test Bar | Arrival fires with the app closed — the payoff the native build buys |

Steps 1–9 passed in Expo Go on 2026-08-27. **Step 10 is still outstanding** and
cannot be done in Expo Go at all — it needs the native build (steps 3–4).

Afterwards: put `DWELL_MINUTES` back to 30 and run
`manage.py create_test_venue --clear`.
