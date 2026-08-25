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
```

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
  "Home" in the default template). Requests location permission, fetches
  `GET /api/venues/nearby/` from the backend, renders venue pins as
  `react-native-maps` `Marker`s. Navigation uses `Marker`'s own `onPress` +
  `useRouter().push(...)` to push `/venue/[id]` — a `<Link>` nested inside
  `Marker`'s children does not reliably receive taps, since `Marker` children
  replace the pin's rendered content rather than acting as a tappable overlay.
- **`src/app/venue/[id].tsx`** — Venue Detail screen, dynamic route capturing
  the venue ID. Fetches `GET /api/venues/<id>/`, shows venue info and
  `current_status`, and lets the user pick a liveliness level (1–5) and
  submit via `POST /api/venues/<id>/reports/`, using `getDeviceId()` and a
  fresh `expo-location` read. Distinguishes 403 (too far)/429 (rate limited)
  and shows the backend's `error` text; refetches status after a successful
  submit.
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

## Known gotchas

- Always set explicit `backgroundColor`/`color` in styles — relying on
  OS/browser dark-mode defaults previously caused a real bug (invisible
  black-on-black text on a pushed stack screen).
- `react-native-maps` requires a physical device or simulator; it does not
  render in `npm run web`.
- Android map rendering needs a Google Maps API key, not yet configured —
  Android is not currently a supported test target.