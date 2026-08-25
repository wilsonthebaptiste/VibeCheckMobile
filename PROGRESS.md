# VibeCheck Mobile — Build Progress

MVP scope: single feature — anonymous crowdsourced venue liveliness reporting.
No user accounts, no social layer, no venue control, single city launch.

## Current status: Chunk 4 complete — MVP core loop done, verified end-to-end
on a physical iPhone (2026-08-24). No further chunks are defined yet.

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