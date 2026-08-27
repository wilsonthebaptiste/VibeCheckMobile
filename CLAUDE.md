@AGENTS.md
@PROGRESS.md

# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project overview

VibeCheckMobile is the Expo/React Native client for VibeCheck, a crowdsourced
venue "liveliness" app. It's a sibling repo to the Django backend at
`C:\Users\wilso\django\VibeCheck` (own `CLAUDE.md` there), consumed entirely
over REST/LAN — no shared code between the two repos.

See PROGRESS.md (imported above) for current build status and the next
concrete task — always check it before starting work.

## Commands

```bash
npm install                    # install deps
npx expo install <package>     # ALWAYS use this, not npm install, for any
                                # Expo-managed package — it picks the version
                                # compatible with this project's SDK (56)

npm run start                  # start Metro dev server
npm run web                    # run in browser (NOTE: react-native-maps does
                                # NOT render on web — use only for non-map UI work)

./node_modules/.bin/tsc --noEmit   # typecheck. Use the LOCAL binary, not
                                    # `npx tsc`: npx has resolved to a
                                    # different TypeScript here before and
                                    # reported a wall of bogus errors inside
                                    # node_modules.

npx expo config --type introspect  # what the config plugins actually resolve
                                    # to (Info.plist, entitlements). The only
                                    # way to check native config from Windows,
                                    # since iOS prebuild needs macOS/Linux.

npx expo start --dev-client        # serve JS to a sideloaded native build
                                    # (replaces `npm run start` once you are
                                    # off Expo Go)
```

Native builds run in CI — `.github/workflows/ios-build.yml`, triggered manually
from the Actions tab. Debug (the default) produces a development build that
loads JS from Metro, so JS changes need no rebuild. Output is an **unsigned**
`.ipa`; Sideloadly signs it on your machine with a free Apple ID, over USB.
Re-sign every 7 days (~30s, no rebuild). See the workflow header for details.

Physical device testing (primary dev target — no Android device/emulator set
up yet, iPhone via Expo Go is the main loop):

- The App Store version of Expo Go does NOT support this project's SDK — install
  the matching build via sign.expo.dev instead (select SDK 56).
- A free Apple ID can't install that build over-the-air — it requires
  Expo Orbit (Windows build available on GitHub) with the iPhone connected via
  USB, using Chrome on the desktop.
- First launch requires manually trusting the developer profile
  (Settings → General → VPN & Device Management) and enabling Developer Mode
  (Settings → Privacy & Security) — one-time per install.

Backend must be running with `python manage.py runserver 0.0.0.0:8000` (not
plain `runserver`) for a physical phone to reach it over LAN.

## Architecture

File-based routing via Expo Router (`src/app/`).

- **`src/app/_layout.tsx`** — root layout. Renders a `Stack` with two screens:
  the `(tabs)` group and `venue/[id]` (pushed on top, not a tab — see below).
- **`src/app/(tabs)/_layout.tsx`** — renders `<AppTabs />`
  (`components/app-tabs.tsx`, native `NativeTabs` API; a separate
  `components/app-tabs.web.tsx` exists because `NativeTabs` is native-only).
- **`src/app/(tabs)/index.tsx`** — the Map screen (tab labeled "Map", was
  "Home" in the default template). Requests location permission, then fetches
  `GET /api/venues/in-bounds/` for the current viewport. The server decides
  whether to return individual venues or aggregated cluster bubbles and says
  which; this screen just renders what it gets. Tapping a pin opens a
  `<VenueCard>` overlay; tapping the card pushes `/venue/[id]`.
  Non-obvious things that are load-bearing here:
  - Navigation uses `Marker`'s own `onPress` + `useRouter().push(...)`. A
    `<Link>` nested inside `Marker`'s children does not reliably receive taps
    — `Marker` children replace the pin's rendered content rather than acting
    as a tappable overlay.
  - `<Marker>` sets **`stopPropagation`** and deliberately has **no
    `title`/`description`**. Those props render MapKit's *native* callout,
    which competes with the card and makes the map auto-pan to fit the bubble
    — firing `onRegionChangeComplete` and causing a spurious refetch on every
    pin tap. Without `stopPropagation`, `MapView.onPress` also fires and
    instantly dismisses the card you just opened.
  - Fetch results **replace** state, they never merge. Merging never evicts,
    so panning LA → Denver → NYC accumulates thousands of markers until
    MapKit dies. Keys are stable, so replacing doesn't remount what stayed.
  - `fetchInBounds` claims the viewport in `servedBoundsRef` **before**
    awaiting, and rolls back only on a real (non-abort) failure. Claiming
    after the response lands means every map settle during a slow request
    aborts the request that was about to answer it — panning somewhere new
    aborts itself in a loop and never renders.
  - The refetch gate uses the server's `served_bounds` and `valid_span_*`
    rather than any local zoom heuristic, so thresholds exist in one place.
  - `forceNextFetchRef` exists because a search fly-to is a short hop that
    looks exactly like a redundant pan to the gate — without it you land over
    Davis still looking at Sacramento's pins.
- **`src/app/venue/[id].tsx`** — Venue Detail screen, dynamic route capturing
  the venue ID. Fetches `GET /api/venues/<id>/`, shows venue info and
  `current_status` as stars + a score, and lets the user pick a liveliness
  level (1–5) and submit via `POST /api/venues/<id>/reports/`, using
  `getDeviceId()` and a fresh `expo-location` read. Distinguishes 403 (too
  far)/429 (rate limited) and shows the backend's `error` text; refetches
  status after a successful submit. Note the asymmetry in the types: what a
  user *submits* is one of five discrete levels, but what comes *back* is a
  plain mean and therefore fractional (3.4).
- **`src/types/venue.ts`** — the API response types. `current_status` has the
  same shape on every endpoint that reports a score, which is what lets one
  `<StarRating>` serve the map card, the search rows and the detail screen.
  `liveliness: null` is the **common** case, not an error — there are ~40,600
  venues and far fewer reports.
- **`src/components/star-rating.tsx`** — 5 SF Symbols, gold accent.
  **Never render this inside a `Marker`**: any Marker with children is
  re-snapshotted into a native image as the map moves, and 5 symbol views ×
  hundreds of markers guarantees stutter. Scores live on the card, not the pin.
- **`src/components/bin-marker.tsx`** — one cluster bubble, sized by
  `log10(venue_count)`. **`tracksViewChanges` must start true and be switched
  off after ~350ms.** True forever re-rasterises every bubble per frame and
  makes the map unusable; false from the start renders a blank bubble, because
  the first snapshot is taken before layout. This is the single biggest perf
  trap in the map code.
- **`src/components/venue-card.tsx`** — the bottom overlay. Takes the whole
  venue object rather than an id, so a background refetch can't blank an open
  card. The empty state ("No reports yet · Tap to be the first") is the
  *designed* state, not a fallback, and renders **no stars at all** — five
  empty outlines reads as "rated zero", which is a different and much worse
  claim. The "· last hour" qualifier is required: this is a 60-minute rolling
  mean drawn in the visual language of a Yelp lifetime rating.
- **`src/components/search-bar.tsx`** — top overlay. Typeahead hits our own
  DB (250ms debounce) and holds every US venue, so it needs no network
  geocoder. Pressing Enter — and *only* pressing Enter — adds `geocode=true`,
  because Nominatim's usage policy explicitly forbids autocomplete. The
  results list needs `keyboardShouldPersistTaps="handled"` or the first tap
  only dismisses the keyboard.
- **`src/utils/fetch.ts`** — `isAbortError()`. React Native does not reliably
  throw a DOMException named `AbortError`; it can wrap the abort as a plain
  `Error` ("fetch failed: Fetch request has been canceled") with the real
  abort on `.cause`. Checking only `error.name` treated deliberate aborts as
  network failures and blanked the map mid-pan.
- **`src/constants/api.ts`** — exports `API_BASE_URL`, read from
  `process.env.EXPO_PUBLIC_API_URL`. Set in a gitignored `.env` (see
  `.env.example` for the template) — must be the dev machine's actual LAN IP,
  never `localhost`, since a physical phone can't resolve the PC's localhost.
- **`src/utils/device.ts`** — `getDeviceId()`. Generates a UUID via
  `expo-crypto` on first call, persists it via AsyncStorage, and returns the
  same ID on every subsequent call. This is the anonymous identifier the
  backend uses for rate-limiting (see backend CLAUDE.md) — every report
  submission must include it. There is no user auth in this app; this UUID is
  the entire identity model, and it must never be surfaced to other users
  (matches backend's `device_id` being `write_only` in its serializer).

### "Going to" intent and notifications (Chunk 7)

- **`src/hooks/use-visit-intent.tsx`** — the whole lifecycle, mounted **once**
  in `src/app/_layout.tsx` as `<VisitIntentProvider>`. Root, not the map screen:
  the two moments this exists for (arriving, and having been somewhere 30
  minutes) happen while the user is doing something else, and a provider on one
  screen would stop watching the instant they navigated away.
  - `intentRef` mirrors the `intent` state because the location callback and the
    notification listener both fire from **native**, outside React's render
    cycle — reading `intent` there closes over whatever it was when the effect
    was set up, which is stale by definition.
  - `arrivingRef` exists because a burst of GPS fixes would otherwise each fire
    their own arrival POST.
  - `handledResponsesRef` dedupes by notification id: a tap can arrive **twice**
    — once from `getLastNotificationResponseAsync()` (the cold-launch read) and
    once from the live listener.
  - Arrival is detected with foreground `watchPositionAsync` at
    **`Accuracy.High`, not `Balanced`**. The tightest threshold is 0.1 mi
    (161 m) and Balanced is only good to ~100 m — enough error to announce an
    arrival from across the block. It runs only while an intent is unarrived, so
    the cost is bounded by one trip.
  - **This single effect is the only thing that differs between the Expo Go and
    native builds.** Step 4 of the plan swaps it for
    `Location.startGeofencingAsync`; the model, endpoints, notifications and UI
    are all unchanged.
- **`src/utils/notifications.ts`** — the handler fields are
  **`shouldShowBanner`/`shouldShowList`**. `shouldShowAlert` is deprecated in
  SDK 56 and silently produces **no banner at all** while the app is
  foregrounded, which looks exactly like "notifications are broken" when you are
  testing with the app open. Category identifiers must not contain `:` or `-`.
  "Not right now" sets `opensAppToForeground: false`, which means a killed app
  never delivers that response — fine, because there is nothing to do with it.
  Everything here is a **local** notification: that is the one notification
  feature Expo Go still supports, and it needs no `aps-environment` entitlement,
  which is the one a free Apple ID cannot sign.
- **`src/utils/visit-intent.ts`** — API calls plus the AsyncStorage mirror. The
  cache exists so a cold launch renders the button in the right state before the
  network answers; without it the chip flickers "Are you going?" → "Going" on
  every open. It also holds the two scheduled notification ids, which exist
  **only on this device** and cannot be recovered from the server — so a
  re-hydrate carries them by hand, and withdraws them if the server names a
  different venue than the cache did.
- **`src/utils/arrival.ts`** — `completeArrival()`. Plain async function, **no
  React on purpose**: when iOS wakes the app for a geofence crossing it runs a
  **headless** JS context with no component tree, no provider and no state to
  set. The background task and the foreground watcher both call this; the hook
  only adds an in-flight guard and copies the result into state. Safe to call
  twice — the server sets `arrived_at` once.
- **`src/utils/geofence.ts`** — the real background arrival trigger.
  `TaskManager.defineTask` is called at **module scope**, and
  `src/app/_layout.tsx` imports the module for that side effect alone: iOS
  expects the task to exist by the time the bundle finishes evaluating, so
  defining it in a component or an effect registers it too late and the event
  is dropped *silently*, in the one situation the feature exists for.
  - Geofencing does **not** replace the foreground watcher; they cover each
    other. iOS only fires ENTER on *crossing* a boundary, so declaring while
    already inside the radius may fire nothing — which is exactly what the
    device test does, since the test venue sits at your feet. Conversely the
    foreground watcher stops when the app is backgrounded.
  - The task must **not** report `region.latitude/longitude` as the device's
    position — that is the venue's own coordinate, so the server's proximity
    re-check would compare the venue against itself and rubber-stamp anything.
    It takes a real fix (last-known, then current).
  - `syncArrivalGeofence()` runs on launch because iOS **persists registered
    regions across app launches** — without it a cancelled intent leaves a live
    geofence that fires days later for a trip nobody is taking.
- **`src/utils/distance.ts`** — `haversineMiles()`, deliberately the same
  formula *and radius* as the backend's `haversine_distance`. The client decides
  locally whether it has arrived and the server re-checks that same claim
  against the same threshold; a different approximation here would create a band
  of positions where the phone says "you made it" and the server answers 403 —
  and the watcher would retry that forever, silently.
- **`src/components/going-button.tsx`** — rendered in `venue-card.tsx`
  **outside** the body `Pressable`. Nested inside it, a tap on "Yes" also counts
  as a tap on the card and pushes the detail screen out from under the answer
  the user just gave. Its three states come from the provider, so the map card
  and the detail screen can never disagree.
- The server owns **`proximity_threshold_miles`**, **`dwell_minutes`** and
  **`nudge_minutes`**, and hands them over in the intent payload — the same
  pattern `/in-bounds/` uses for `valid_span`. Never hardcode them. This is what
  lets `DWELL_MINUTES` drop from 30 to 2 for a device test with no new build.

## Known gotchas

- Always set explicit `backgroundColor`/`color` in styles — relying on
  OS/browser dark-mode defaults previously caused a real bug (invisible
  black-on-black text on a pushed stack screen). This applies doubly to
  anything drawn over the map, which sits on tiles rather than on a themed
  surface.
- Do **not** use `mapPadding`. It decouples the region MapKit reports from
  the visible viewport, which breaks the bbox↔screen correspondence that
  `/in-bounds/` depends on.
- Overlay paint order is tree order: the OSM attribution pill is rendered
  *before* the search bar so the search results dropdown expands over it.
- **Overlapping pins are the normal case, not an edge case.** One street-zoom
  viewport over Sacramento holds ~28 venue pairs whose pins physically overlap
  (Blue Cue ↔ Barwest Midtown are 69 ft apart; The Golden Bear ↔ Der Biergarten
  40 ft). Anything touching marker interaction has to be correct when two pins
  sit on top of each other. Two consequences already handled in
  [index.tsx](src/app/(tabs)/index.tsx), both of which caused real bugs:
  - A single tap can deliver **more than one** marker press. Every marker gets
    its own `UITapGestureRecognizer` with `cancelsTouchesInView = NO`
    (`AIRMapMarker.m`), and `_handleTap:` fires `onPress` *and* calls
    `selectAnnotation:` — with overlapping views those resolve to different
    markers, so the card lands on one venue then jumps to its neighbour.
    `MARKER_PRESS_LOCKOUT_MS` suppresses the duplicate; first press wins,
    because that is the marker that hit-tested topmost.
  - Without an explicit `zIndex`, every marker's `zPriority` is 0 and MapKit
    has **no defined stacking order**, so which pin a tap resolves to can
    change as the map moves. Markers are ranked by latitude for a stable
    order, and the selected pin is lifted above the rest and recoloured so it
    is visually identifiable underneath the card.
- **`plugins/with-no-push-entitlement.js` is load-bearing for free signing.**
  `expo-notifications` ships an `app.plugin.js`, so Expo autolinking applies its
  config plugin **whether or not it is listed in `app.json`**, and that plugin
  sets `aps-environment` — the *remote push* entitlement, and the one entitlement
  a free Apple ID cannot sign. VibeCheck only ever sends **local** notifications,
  so the entitlement buys nothing and costs the entire free sideloading path.
  Without the strip, Sideloadly fails at install with a provisioning-profile
  error that never mentions notifications. The CI workflow fails the build if it
  ever comes back. Local plugins run *after* autolinked ones, which is why a
  `delete` works. Remove this only if real push is added — which requires the
  $99/yr program anyway, at which point the entitlement becomes signable.
- `UIBackgroundModes` (`location` from expo-location, `fetch` from
  expo-task-manager) is an **Info.plist property, not an entitlement** — per
  Apple's developer forums. That distinction is the whole reason background
  geofencing is possible on a free account.
- `ios/` and `android/` are **gitignored** — this project uses Continuous
  Native Generation. `app.json` plus the config plugins are the single source of
  truth, and CI runs `expo prebuild` fresh. Never commit a generated native
  project. iOS prebuild **cannot run on Windows** (it errors out); use
  `npx expo config --type introspect` to check what the plugins resolve to
  without generating anything.
- `react-native-maps` requires a physical device or simulator; it does not
  render in `npm run web`.
- Android map rendering needs a Google Maps API key, not yet configured —
  Android is not currently a supported test target.