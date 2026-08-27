# VibeCheck — Transfer Plan

**Purpose.** This is a handoff document for a fresh Claude context that will
rebuild VibeCheck as a **single repository** (backend + client together),
possibly on a **different tech stack**, and this time **prepared for real
deployment**.

It deliberately does *not* re-describe things that can be read out of the code.
It records the things that cannot be recovered by reading code: why decisions
were made, what was tried and abandoned, what the real-world numbers turned out
to be, and which bugs cost real debugging time. Treat the "Hard-won knowledge"
and "Bugs that only showed up on a device" sections as the highest-value part of
this file — most of them are not discoverable from documentation, and several
were found only because a simulation was written before trusting the reasoning.

Written 2026-08-27, at the end of Chunk 7.

---

## 1. What the product is

Crowdsourced, real-time venue "liveliness". You stand in or near a bar and
report how busy it is (1–5). The app averages every report from the last 60
minutes into a current score and shows it on a map. That is the entire product.

**MVP scope, deliberately.** No user accounts. No social layer. No venue owner
controls. No photos, comments, or history. These were excluded on purpose, not
deferred by accident — do not reintroduce them without a reason.

The one feature layered on top of reporting is **"going to" intent**: declare
you are heading to a venue, and the phone prompts you at the two moments a
report is actually worth writing — on arrival, and again once you've been there
a while. Its purpose is to stop the app depending on users spontaneously
remembering it exists.

### The identity model

There is **no auth at all**. A client-generated UUID (`device_id`), persisted in
device storage, is the entire identity model. It is used for:

- rate limiting (one report per device per venue per 15 minutes)
- tying a "going to" intent to a device (unique constraint — see §4)

It is `write_only` in the serializer and **must never be surfaced to other
users**. It is also trivially forgeable, which is acceptable for a hobby app and
is *not* acceptable for a deployed one — see §10.

---

## 2. Current state

Two sibling repositories, no shared code, communicating over REST on a LAN:

| Repo | Stack | Commits | Tests |
|---|---|---|---|
| `VibeCheck` (backend) | Django 6.1 + DRF + SQLite | 15 | 154, all passing |
| `VibeCheckMobile` (client) | Expo SDK 56 / RN 0.85.3 | 13 | typecheck only |

Backend is ~3,400 lines across `venues/`. Database is 7.2 MB holding **40,613
venues** and (currently) 1 report.

### What is verified

- Chunks 1–6 verified end-to-end on a physical iPhone.
- Chunk 7 steps 1–2 (intent model, notifications, UI, foreground arrival)
  verified on device in Expo Go — all nine applicable test steps passed.
- Chunk 7 steps 3–4 (native build, geofencing) — the **native build works**:
  CI produces an unsigned IPA, Sideloadly installs it, the app runs, and all
  nine Expo Go test steps pass again on the native build.

### What is NOT verified

**Background geofence arrival with the app force-quit.** This is the one thing
the native build was built to prove, and it remains unproven. The attempt
failed, but for environmental reasons rather than a demonstrated code fault:

1. The build was `Debug`, which does not embed the JS bundle — it loads from the
   Metro dev server. When iOS wakes a force-quit app headlessly for a geofence
   event and the phone is off the dev network, there is no bundle to load.
2. The backend is on a LAN IP, so `POST /api/intent/arrived/` was unreachable
   from outside the house anyway.

Either alone is fatal to the test. **To retry properly**: build `Release` (bakes
the bundle in — the workflow already accepts an `api_url` input for this) and
host the backend somewhere publicly reachable. Until both are true, the result
is inconclusive, not negative.

Useful partial signal from that attempt: the scheduled nudge notification *did*
fire while the app was force-quit, so scheduled local notifications survive
termination correctly. Only the geofence → headless JS → API path is unproven.

Also unverified: **Android is not a supported target at all.**
`react-native-maps` on Android is Google Maps and needs an API key that was
never configured.

---

## 3. Chunk history (what was built, in order)

1. **Backend foundation** — Venue/Report models, migrations, admin.
2. **Backend API** — nearby lookup, venue detail with aggregated liveliness,
   report submission with proximity + rate limiting, CORS.
3. **App scaffold** — Expo project, map screen, location permission, real pins,
   device UUID.
4. **Report submission flow** — venue detail screen, 1–5 picker, distinct 403 /
   429 handling, score refresh after submit.
5. **Real venues from OpenStreetMap** — replaced hand-seeded pins with real OSM
   data via Overpass.
6. **Nationwide venues, search, Yelp-style scores** — full US ingest,
   viewport endpoint, search, star ratings, cluster bubbles.
7. **"Going to" intent, arrival & dwell notifications** — the current chunk.

---

## 4. Domain model

Three real models plus three bookkeeping ones.

**`Venue`** — name, optional address, lat/lng, category, plus OSM provenance
(`osm_type`, `osm_id`, `osm_synced_at`), unique on `(osm_type, osm_id)` so
re-ingesting upserts rather than duplicating.

- `osm_id` null means a **hand-added** venue. These never expire and
  `ingest_us --prune` refuses to delete them. This is a first-class case, not an
  edge case — it's how test venues work.
- **`address` is legitimately blank about a third of the time.** ~32% of real
  OSM venues carry no `addr:*` tags at all. Never render a placeholder for it.
- Categories mirror the OSM `amenity` tag verbatim (`bar`, `pub`, `nightclub`,
  `biergarten`). Deliberately not collapsed into bar/club: a pub is neither, and
  keeping the raw tag makes re-syncs idempotent with no reverse mapping.

**`Report`** — venue FK, liveliness 1–5, `device_id`, submitter lat/lng,
timestamp. Indexed on `created_at` and on `(venue, -created_at)`.

**`VisitIntent`** — `device_id` (**unique**), venue FK, `created_at`,
`arrived_at` (nullable).

- The unique constraint **is** the "only one venue per device" product rule.
  Declaring is `update_or_create` on `device_id`, so a new declaration overrides
  the old one *by construction*, not by cleanup code that could be skipped or
  race. Keep this property in any rewrite.
- `created_at` must **not** be `auto_now_add`. It only fires on INSERT, so an
  upsert would keep the original timestamp and a freshly re-declared intent
  could be born already past its TTL. Set it explicitly on every write. This was
  caught by a test written specifically to check it.
- `arrived_at` resets on re-declaration, including of the same venue — that's a
  new trip and should re-arm the arrival prompt.
- Arrival is idempotent server-side: `arrived_at` is set once and later claims
  are ignored, so duplicate GPS ticks can't restart the dwell clock.

Bookkeeping models: `OsmSyncTile` (lazy per-tile sync cache, mostly dormant),
`OsmIngestRegion` (52-row ledger for the country ingest), `GeocodeCache`
(required by Nominatim's policy, not merely an optimisation).

---

## 5. API surface

```
GET    /api/venues/in-bounds/?min_lat=&min_lng=&max_lat=&max_lng=
GET    /api/venues/search/?q=&lat=&lng=&geocode=
GET    /api/venues/here/?lat=&lng=
GET    /api/venues/<pk>/
POST   /api/venues/<pk>/reports/
PUT    /api/venues/<pk>/intent/
GET    /api/intent/?device_id=
DELETE /api/intent/?device_id=
POST   /api/intent/arrived/
```

Design rules worth carrying over:

- **`/in-bounds/` has no `zoom` parameter, deliberately.** `max_lat - min_lat`
  already *is* the zoom. A second parameter would be a second source of truth
  that can disagree with the first.
- The server decides whether to return individual venues or aggregated bins and
  **says which** (`mode`), plus a `valid_span_min`/`valid_span_max` envelope
  describing the zoom interval over which that answer stays correct. The client
  refetches when it leaves the interval. **No mode or bin-size threshold is
  duplicated on the client.** This pattern worked extremely well — reuse it.
- `valid_span_max: null` means unbounded (JSON has no infinity).
- The intent payload carries `proximity_threshold_miles`, `dwell_minutes` and
  `nudge_minutes` — the same "server owns the rule and tells the client what it
  is" pattern. This is what let a 30-minute dwell rule be tested in 2 minutes
  with no new build. **Never hardcode these client-side.**
- `/venues/here/` exists so the dwell prompt can name the bar the user is
  *actually* at without reimplementing the per-`osm_type` proximity rule in
  client code.

Two server-side rules on report submission, both in the view rather than the
serializer:

1. **Proximity** — within 0.1 mi of a node venue, 0.15 mi for a way/relation,
   else 403. Ways/relations get a looser bound because OSM's `out center` gives
   a building centroid, which sits farther from the door than a node does.
2. **Rate limit** — one report per device per venue per 15 minutes, else 429.

The threshold selection is factored into `proximity_threshold_for(venue)` and
shared by report submission, arrival verification, and `/venues/here/`, so those
three can never disagree about "close enough". A client told it had arrived that
then got a 403 on submit would be unexplainable from the user's side.

---

## 6. Hard-won knowledge

### 6.1 Data and scale

- **US OSM bars/pubs/nightclubs/biergartens: ~40,600 — not the 100k+ initially
  assumed.** This single number reframed the entire architecture. At ~7 MB the
  whole country fits locally, which removes Overpass from the request path
  completely. Check the real cardinality before designing around an estimate.
- Full ingest run: **40,611 venues in 39m53s, 51/51 regions, 0 duplicates,
  7.1 MB**.
- Country-zoom viewport: 40,261 venues collapsed to 177 bubbles in **165 ms**.
  Downtown viewport: 57 venues in **26 ms**.

### 6.2 Overpass (OSM data source)

- The binding limit is **~2 concurrent slots per IP** — *not* a daily request
  budget. Every outbound call must go through one process-wide lock with a
  minimum gap.
- **Overpass signals an overrun as HTTP 200 with a `remark` key.** An
  under-budgeted query therefore fails as "partial result", not as a timeout or
  an error status. This is very easy to misdiagnose.
- Timing knobs must be per-call parameters: a state-sized bbox is nothing like a
  neighbourhood tile.
- Marking country coverage in the 0.02° tile cache would write roughly **6.15
  million rows** for a 7 MB venue table. A 52-row region ledger records the same
  fact. `completed_at` on that ledger is the resume marker.
- The ingest retries each box, then subdivides into quadrants if it still fails,
  and never lets one state abort the run.
- `--prune` must refuse to run unless every region completed (state boxes
  overlap, so a failed region makes its venues look abandoned) and must never
  delete a venue that has reports — `Report` cascades, so pruning one would
  destroy real user data.
- `VENUE_STALE_AFTER` was 30 days, justified by "any tile someone queries gets
  re-synced before this expires". That stopped being true the moment ingest
  became up-front. **At 30 days the entire map would have silently gone blank a
  month after the first ingest.** It is now 365 days.

### 6.3 Nominatim (geocoding)

- Their usage policy is the binding constraint, not performance. It **forbids
  autocomplete**. Geocoding is therefore wired to *submit only* — a product
  decision forced by policy, not a technical one.
- Also required: 1 req/s, results must be cached, identifying User-Agent.
- **Nominatim's structured `amenity=` parameter is a *name* matcher, not a
  category filter.** Verified returning highways named "Bar-X Drive". Don't use
  it.
- The geocode lock must be **separate** from the Overpass lock — sharing one
  makes a keystroke queue behind a 30-second state-sized query.
- Nominatim returns bounding boxes as `[min_lat, max_lat, min_lng, max_lng]`,
  which is not the order most code expects.

### 6.4 Scoring

- A venue's score is the **plain arithmetic mean of the last 60 minutes**. This
  replaced time-decay weighting, which was more complex and no more useful.
- **Round with `int(avg + 0.5)`, never `round()`.** Python's banker's rounding
  makes `round(2.5) == 2` but `round(3.5) == 4` — an asymmetry that is invisible
  in review and produces inconsistent labels for exactly the half-steps a 1–5
  scale hits constantly.
- Carry `(sum, count)` rather than an average: bins need sum and count anyway (a
  bin's score is the mean over every report in it, which cannot be recovered
  from per-venue averages), and `Avg`/`Count` disagree about emptiness (None vs
  0).
- Annotating scores onto a whole queryset in **one** query replaced a per-venue
  helper costing 3 queries each. At 200 map pins that was 600+ queries — which
  is why scores could not be shown on the map at all before.
- **Django aggregate fan-out**: two aggregates over the *same* relation are
  safe (one join). Adding an aggregate over a *different* multi-valued relation
  to the same queryset silently corrupts both numbers.
- **Binning must be two queries, not one.** Joining reports into the grouped
  venue query duplicates each venue row per report, so `Count` counts reports
  instead of venues *and* `Avg(latitude)` becomes report-weighted, dragging each
  bubble toward whichever venue has the most reports.
- Bin bubbles use the **real centroid** of their venues, not the grid cell's
  centre. Grid centres produce a perfectly regular lattice of bubbles hovering
  over empty desert.
- The score is **fractional** (3.4). What a user *submits* is one of five
  discrete levels; what comes *back* is a mean. Clients must type it as such.

### 6.5 Map rendering (`react-native-maps` / MapKit)

This library produced more real bugs than everything else combined.

- **`Marker` children replace the pin's rendered content — they do not act as a
  tappable overlay.** A nested `<Link>`/`<Pressable>` does not reliably receive
  taps. Navigation must go on `Marker`'s own `onPress`.
- **`tracksViewChanges` must start `true` and be switched off after ~350 ms.**
  True forever re-rasterises every custom marker every frame and makes the map
  unusable; false from the start renders a blank marker, because the first
  snapshot is taken before layout. This is the single biggest perf trap.
- **Never render a multi-view component (e.g. 5 star glyphs) inside a
  `Marker`.** Any marker with children is re-snapshotted into a native image as
  the map moves. Scores belong on the card, not the pin.
- **Overlapping pins are the normal case, not an edge case.** One street-zoom
  viewport over Sacramento holds **28 venue pairs whose pins physically
  overlap** — 69 ft apart, 40 ft apart. Anything touching marker interaction has
  to be correct when two pins sit on top of each other.
- **A single tap can deliver more than one marker press.** Every marker gets its
  own `UITapGestureRecognizer` with `cancelsTouchesInView = NO`, and the tap
  handler fires `onPress` *and* calls `selectAnnotation:` — with overlapping
  views those resolve to different markers. Fixed with a 250 ms press lockout;
  first press wins, because that is the marker that hit-tested topmost.
- **Without an explicit `zIndex`, every marker's `zPriority` is 0 and MapKit has
  no defined stacking order**, so which pin a tap resolves to can change as the
  map moves. Rank markers deterministically (latitude was used).
- `stopPropagation` is required on markers, or `MapView.onPress` also fires and
  instantly dismisses the card the tap just opened.
- **Do not set `title`/`description` on markers** if you're drawing your own
  card. Those render MapKit's *native* callout, which auto-pans the map to fit
  the bubble — firing `onRegionChangeComplete` and causing a spurious refetch on
  every single pin tap.
- **Do not use `mapPadding`.** It decouples the region MapKit reports from the
  visible viewport, breaking the bbox↔screen correspondence a viewport endpoint
  depends on.
- **Fetch results must replace state, never merge.** Merging never evicts, so
  panning LA → Denver → NYC accumulates thousands of markers until MapKit dies.
  Keys stay stable, so replacing doesn't remount what stayed.
- **Claim the viewport before awaiting, not after.** Claiming after the response
  lands means every map settle during a slow request aborts the request that was
  about to answer it — panning somewhere new aborts itself in a loop and never
  renders. Roll the claim back only on a real (non-abort) failure.
- A search fly-to is a short hop that looks exactly like a redundant pan to the
  refetch gate. It needs an explicit force flag or you land over the new city
  still looking at the old one's pins.
- Overlay paint order is tree order — render the attribution pill *before* the
  search bar so the results dropdown expands over it.
- Search results lists need `keyboardShouldPersistTaps="handled"` or the first
  tap only dismisses the keyboard.
- `react-native-maps` does not render on web at all.

### 6.6 React Native runtime

- **RN does not reliably throw a `DOMException` named `AbortError`.** It can
  wrap the abort as a plain `Error` ("fetch failed: Fetch request has been
  canceled") with the real abort on `.cause`. Checking only `error.name` treats
  deliberate aborts as network failures and blanks the map mid-pan. Write a
  proper `isAbortError()` that checks message content and recurses into
  `.cause`.
- With `reactCompiler: true`, values that aren't render inputs must use `useRef`,
  not state.
- Callbacks that fire from **native** (location watchers, notification
  listeners) run outside React's render cycle and close over stale state. Mirror
  the state into a ref and read the ref there.
- Always set explicit `backgroundColor`/`color` in styles. Relying on OS
  dark-mode defaults previously caused invisible black-on-black text on a pushed
  stack screen. This applies doubly to anything drawn over a map, which sits on
  tiles rather than a themed surface.

### 6.7 Expo, notifications, background location

- **SDK 56 is pinned.** SDK 57 had an unresolved Expo Go crash bug
  (`expo/expo#48390`). Check open issues before upgrading; this project was
  already burned once.
- **Expo Go cannot do background location or geofencing.** It *can* do local
  notifications. That split is what shaped all of Chunk 7's sequencing.
- **The notification handler fields are `shouldShowBanner` / `shouldShowList`.**
  `shouldShowAlert` is deprecated in SDK 56 and **silently produces no banner at
  all** while the app is foregrounded — which looks exactly like "notifications
  are broken" when testing with the app open.
- Notification **category identifiers must not contain `:` or `-`**.
- An action with `opensAppToForeground: false` means a killed app never delivers
  that response. Fine when there's nothing to do with it.
- A notification tap can arrive **twice** — once from the cold-launch read
  (`getLastNotificationResponseAsync()`) and once from the live listener.
  Deduplicate by notification id.
- **`UIBackgroundModes` is an Info.plist property, not an entitlement.**
  (Confirmed on Apple's developer forums.) This is the entire reason background
  geofencing is possible on a free Apple ID. Only *push* needs an entitlement a
  free account lacks.
- **`expo-notifications` ships an `app.plugin.js`, so Expo autolinking applies
  its config plugin whether or not it is listed in `app.json`** — and that plugin
  sets `aps-environment`, the remote-push entitlement, which is precisely the one
  a free Apple ID cannot sign. Without stripping it, sideloading fails at install
  with a provisioning-profile error that never mentions notifications. A local
  plugin that `delete`s the key works because **local plugins run after
  autolinked ones**.
- **`TaskManager.defineTask` must be called at module scope**, and the module
  imported for that side effect alone. iOS expects the task to exist by the time
  the JS bundle finishes evaluating; defining it in a component or an effect
  registers it too late and the event is dropped **silently**, in the one
  situation the feature exists for.
- When iOS wakes a terminated app for a geofence crossing it runs a **headless**
  JS context — no component tree, no provider, no state to set. Any logic the
  background task needs must live in a plain function, not a hook.
- **A geofence task must not report the region's own coordinates as the device's
  position.** That's the venue's coordinate, so a server-side proximity re-check
  would be comparing the venue against itself and would rubber-stamp anything.
  Take a real fix.
- **iOS only fires ENTER on *crossing* a boundary.** Declaring while already
  inside the radius may fire nothing at all. Geofencing must therefore
  *supplement* a foreground watcher, not replace it — each covers the other's
  blind spot, and both should funnel into one idempotent arrival function.
- **iOS persists registered regions across app launches.** Without a sync on
  launch, a cancelled intent leaves a live geofence that fires days later for a
  trip nobody is taking.
- Foreground arrival watching needs `Accuracy.High`, not `Balanced`. The
  tightest threshold is 161 m and Balanced is only good to ~100 m — enough error
  to announce an arrival from across the block.
- Geofence radii below ~100 m are unreliable (smaller than GPS error); iOS
  quietly enlarges them.
- `ios/` and `android/` should stay gitignored (Continuous Native Generation).
  `app.json` plus config plugins are the single source of truth and CI runs
  `expo prebuild` fresh. **iOS prebuild cannot run on Windows** — use
  `expo config --type introspect` to check what plugins resolve to without
  generating anything. That command is the only way to verify native config from
  a Windows dev machine, and it is how the `aps-environment` problem was found.

### 6.8 Client/server agreement

The client decides locally whether it has arrived (to avoid round-tripping every
GPS tick) and the server re-checks that same claim. **They must use the same
haversine formula and the same Earth radius.** A different approximation on
either side creates a band of positions where the phone says "you made it" and
the server answers 403 — and the watcher retries that forever, silently. This
was verified with a simulation over 58 positions including a dense sweep through
the threshold boundary: zero disagreements, and zero positions where the client
would POST forever.

---

## 7. Bugs that only showed up on a device

Worth reading as a class: these are the failures that automated tests and
reasoning both missed.

| Symptom | Root cause |
|---|---|
| Tapping a pin did nothing | `Marker` children replace pin content rather than overlaying it; the nested `<Link>` never received the tap |
| App crashed while panning the map | RN wrapped fetch aborts as plain `Error`s, so abort handling treated them as network failures |
| Panning produced no new pins, indefinitely | The fetched centre was only claimed on success, so a slow cold sync aborted itself in a loop |
| Card showed one venue then jumped to its neighbour | One tap delivering two marker presses (`cancelsTouchesInView = NO`), plus no defined MapKit stacking order because every `zPriority` was 0 |
| Would have refetched on every region change when zoomed out | The zoom envelope was derived from the *expanded* served box while the client compares its own viewport span — putting the client permanently below `valid_span_min`. **Caught by a simulation, not on the device** |

---

## 8. The verification approach that worked

The most effective practice in this project was **writing a simulation before
trusting the reasoning**, especially for anything involving feedback loops
between client and server.

- A refetch-gate simulation replayed 23 region settles against the real API: 19
  fetches, zero oscillation, marker count bounded at 127 from street zoom to
  whole-country zoom and back. It caught the envelope bug listed above, which
  would have been a permanent refetch loop in production.
- A marker-interaction simulation replayed the double-press against real
  Sacramento data — 17/17 checks, including every overlapping pair in both tap
  orders.
- A client/server arrival-agreement simulation swept 58 positions through the
  proximity boundary and confirmed no position exists where the client would
  retry forever.

Also: exercise every endpoint with real HTTP against the running server before
touching client code. That caught contract mismatches early in several chunks.

**Tests that assert a settings default are fragile.** One test asserted
`dwell_minutes == 30`, which broke the moment the documented device-test
procedure (set it to 2) was followed. Pin such values with an explicit override
instead.

---

## 9. Deployment economics (researched, still accurate)

|  | iOS | Android |
|---|---|---|
| Your own device | Sideload with a free Apple ID — **$0** | Direct APK — **$0** |
| Other testers | TestFlight — **$99/yr**, no free route | Firebase App Distribution — **$0** |
| Public store | **$99/yr** | **$25 one-time** |

- Free Apple ID sideloading expires every **7 days** (re-signing takes ~30 s and
  needs no rebuild) and is limited to **3 apps**.
- **Standard `macos-latest` GitHub Actions runners are free and unlimited for
  public repositories** — only *larger* runners are billed. Note: a
  documentation fetch during research returned the *opposite* answer and had to
  be re-verified. Confirm this independently rather than trusting one source.
- The unsigned-IPA trick: `xcodebuild archive` with signing disabled, then zip
  the `.app` inside a top-level `Payload/` directory and rename to `.ipa`.
  `xcodebuild -exportArchive` cannot be used — it insists on a signing identity.
- EAS Build free tier: 15 iOS + 15 Android builds/month. `expo prebuild` + EAS is
  the same pipeline for dev and release, so nothing built now is thrown away.
- **Known future decision:** `react-native-maps` on Android is Google Maps and
  needs an API key. The Maps SDK for Android is free with unlimited usage, but a
  production key wants a billing account on file. **MapLibre + OSM tiles is the
  key-free alternative**, at the cost of swapping map libraries — and it would
  also solve web rendering, which `react-native-maps` cannot do.

---

## 10. What is NOT deployment-ready

The current backend is a development server and should not be exposed as-is.
Specifics:

- `DEBUG = True`, and CORS is wide open whenever debug is on.
- `SECRET_KEY` is committed in source.
- `ALLOWED_HOSTS` contains a hardcoded LAN IP that changes with the WiFi network.
- SQLite. Fine for 40k venues and one user; not fine for concurrent writes from
  many devices.
- **`device_id` is client-generated and trivially forgeable.** Rate limiting and
  the one-intent-per-device rule are therefore advisory. For a deployed app this
  is the main abuse vector: a script can mint UUIDs and submit unlimited reports
  from anywhere the proximity check passes (and the proximity check itself
  trusts client-supplied coordinates).
- No HTTPS, no monitoring, no error reporting, no structured logging.
- The proximity check is explicitly "a speed bump, not a security boundary".

Any of these that matter should be decided deliberately in the rewrite rather
than inherited.

---

## 11. Recommendations for the rewrite

### Keep these decisions

They were expensive to arrive at and are stack-independent:

- The **60-minute rolling plain mean**, and `int(avg + 0.5)` rounding.
- **`(sum, count)` rather than average** as the score primitive.
- **Two-query binning** for map clustering.
- The **`valid_span` envelope pattern** — server decides representation and
  tells the client when the answer stops being valid. No thresholds duplicated
  client-side.
- **Server owns timings and thresholds, and ships them in the payload.** This is
  what made a 30-minute rule testable in 2 minutes.
- **Unique constraint as the product rule** for one-intent-per-device.
- A **single shared proximity-threshold function** used by submission, arrival,
  and "what am I near".
- **Idempotent arrival** (`arrived_at` set once).
- **Geofencing supplements rather than replaces** foreground watching.
- The **empty state renders no stars at all** — five empty outlines reads as
  "rated zero", which is a different and much worse claim than "no reports yet".
- The **"· last hour" qualifier is mandatory** on any score display: it is a
  60-minute rolling mean drawn in the visual language of a lifetime Yelp rating,
  and without the qualifier it lies.
- **Pins keep their true coordinates.** Spreading or clustering overlapping pins
  was considered and rejected, since report submission is gated on physically
  standing near the venue.

### Reconsider these

- **SQLite → PostgreSQL + PostGIS.** This is the single biggest available
  upgrade. It replaces the hand-rolled bbox pre-filter + Python haversine loop
  with `ST_DWithin` and a real spatial index, removes the `cos(latitude)`
  longitude correction that currently has to be applied by hand (a degree of
  longitude is 30 mi at 64°N, not 69), and makes the binning query a native
  spatial aggregate. Several existing subtleties simply disappear.
- **Monorepo shape.** The backend is genuinely small (~3,400 lines) and the
  scoring/bounds/ingest logic is almost entirely pure functions — it ports
  easily. If moving to TypeScript end-to-end, the big win is **sharing the types
  and the haversine implementation between client and server**, which would have
  eliminated an entire class of bug documented in §6.8. That alone is a strong
  argument for the monorepo.
- **Map library.** MapLibre + OSM tiles avoids the Google Maps API key problem on
  Android *and* works on web. `react-native-maps` does neither.
- **Abuse resistance**, if this is ever public. At minimum: server-side rate
  limiting by IP as well as device, and an honest acknowledgement that
  client-supplied coordinates cannot be trusted.

### Sequencing advice

The "feature first, then go native" sequencing worked well and is worth
repeating: build and verify everything testable in the fast dev loop, and only
then take on the native-build infrastructure. Steps 1–2 of Chunk 7 were fully
verified before the native build existed, which meant the native build had to
explain only *one* new variable when it went wrong.

The corollary, learned the hard way: **a Debug/dev-client build cannot be used
to test anything that happens while the device is away from the dev network.**
Plan a Release build and a reachable backend for that class of test from the
start.

### Suggested tooling (skills / agents / MCPs)

Grounded in friction that actually recurred in this project:

- **A device-test-plan skill.** Test plans were requested repeatedly and belong
  in chat, not in tracked docs. A skill that emits the current plan for a given
  feature would have saved several round trips.
- **A DB-inspection MCP or skill.** Checking venue/report/intent state required
  hand-written `manage.py shell -c` one-liners many times per session.
- **A contract-check agent.** The client's response types and the server's
  serializers must agree, and nothing enforced that. A monorepo with shared
  types removes the need; without one, an agent that diffs them is worth having.
- **A simulation-writing habit, possibly as a skill.** Given how often
  simulations caught what reasoning missed, making "write the simulation first"
  a repeatable prompt is likely high-value.

---

## 12. Test data and tooling that already exists

Worth porting rather than rewriting:

- **`create_test_venue`** — seeds a venue at your exact coordinates (arrival
  fires within seconds) plus one 0.5 mi away (arrival must *never* fire). **The
  far one is the point**: without it, "arrival fired" proves nothing, because a
  bug that fires arrival unconditionally also passes.
- **`seed_reports`** — with `--spread`, which spaces each venue's *target
  average* across 1.0–5.0 so a batch is guaranteed to exercise 1-star, 5-star and
  the **half-star** glyph (a separate render branch that random chance may never
  hit). And `--expiring-soon`, which rigs venues so half their reports leave the
  60-minute window together, making the roll observable in minutes instead of
  requiring an hour's wait.
  - Note: spread targets must go to non-rigged venues only, or the expiry venues
    consume the extreme targets and the 1-star case never appears.
- **`ingest_us`** — 52 state boxes, ledger-based resume, retry-then-subdivide.

---

## 13. Immediate open items

1. **Background geofence arrival is unverified.** Retry with a Release build and
   a publicly reachable backend.
2. `DWELL_MINUTES` is currently `2` in the backend settings (test value). Product
   value is `30`.
3. Test venues (`VibeCheck Test Bar`, `VibeCheck Far Bar`) are currently seeded
   at `38.581828, -121.467391` and should be cleared with
   `create_test_venue --clear` or reset to the tester's real location.
4. Android has never been run. Needs a Google Maps API key or a map library swap.
