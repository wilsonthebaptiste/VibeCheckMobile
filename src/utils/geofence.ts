/**
 * Background arrival detection, via a real iOS geofence.
 *
 * This is what the native build buys and Expo Go cannot do: iOS monitors the
 * region itself, at the OS level, and wakes VibeCheck when the boundary is
 * crossed -- even if the app has been swiped away. Needs `UIBackgroundModes`
 * to contain `location`, which the expo-location config plugin adds (see
 * app.json). That is an Info.plist key, NOT an entitlement, which is why a
 * free Apple ID can sign a build that does this.
 *
 * Geofencing does NOT replace the foreground watcher in
 * `use-visit-intent.tsx`; the two cover each other's blind spots:
 *
 *   - iOS only fires ENTER on *crossing* a boundary. Declaring an intent while
 *     already standing inside the radius may fire nothing at all -- which is
 *     exactly what the device test does, since the test venue sits at your
 *     feet. The foreground watcher catches that case immediately.
 *   - The foreground watcher stops the moment the app is backgrounded. The
 *     geofence covers that.
 *
 * Both funnel into `completeArrival`, which is safe to call twice.
 */

import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';

import { completeArrival } from '@/utils/arrival';
import { loadStoredIntent, type StoredIntent } from '@/utils/visit-intent';

export const ARRIVAL_GEOFENCE_TASK = 'vibecheck-arrival-geofence';

const MILES_TO_METRES = 1609.34;
/**
 * iOS quietly enlarges regions below roughly this size, and a radius smaller
 * than the GPS error produces an event that never comes. The tightest
 * threshold we use (0.1 mi) is 161 m, so this floor normally does nothing --
 * it exists so a future tightening of the server-side threshold degrades into
 * a slightly loose geofence rather than a silently dead one.
 */
const MIN_RADIUS_METRES = 100;

type GeofenceEvent = {
  eventType: Location.GeofencingEventType;
  region: Location.LocationRegion;
};

/**
 * Registered at module scope, on purpose.
 *
 * When iOS relaunches a terminated app for a geofence event it expects the task
 * to already be defined by the time the JS bundle finishes evaluating. Defining
 * it inside a component or an effect would register it too late, and the event
 * would be dropped -- silently, in the one situation the whole feature exists
 * for. `src/app/_layout.tsx` imports this module for that reason.
 */
TaskManager.defineTask<GeofenceEvent>(ARRIVAL_GEOFENCE_TASK, async ({ data, error }) => {
  if (error) {
    console.warn('Geofence task error:', error);
    return;
  }
  if (data?.eventType !== Location.GeofencingEventType.Enter) {
    return;
  }

  // Do NOT report the region's own centre as the device's position. That is
  // the venue's coordinate, so the server's proximity re-check would be
  // comparing the venue against itself and would rubber-stamp anything. Use a
  // real fix; a cached one is fine, since iOS only fired this because the
  // device genuinely crossed the boundary.
  let position = await Location.getLastKnownPositionAsync({ maxAge: 60_000 });
  if (!position) {
    try {
      position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
    } catch (positionError) {
      console.warn('Geofence fired but no position was available:', positionError);
      return;
    }
  }

  await completeArrival(position.coords.latitude, position.coords.longitude);
});

/**
 * Asks for the always-on location permission.
 *
 * Separate from the foreground request the map screen makes, and asked only
 * when the user declares an intent -- iOS shows this as a second, scarier
 * prompt, and it makes sense only right after someone says "I'm going here".
 */
export async function requestBackgroundLocation(): Promise<boolean> {
  try {
    const foreground = await Location.getForegroundPermissionsAsync();
    if (!foreground.granted) {
      // iOS refuses to consider the background prompt until foreground is
      // granted, so asking here would fail without ever showing anything.
      return false;
    }
    const existing = await Location.getBackgroundPermissionsAsync();
    if (existing.granted) {
      return true;
    }
    if (!existing.canAskAgain) {
      return false;
    }
    const requested = await Location.requestBackgroundPermissionsAsync();
    return requested.granted;
  } catch (error) {
    // Expo Go throws here rather than returning denied -- background location
    // is unsupported there. That is a legitimate configuration, not a fault:
    // the foreground watcher still works, so the app degrades to the Expo Go
    // behaviour instead of breaking.
    console.warn('Background location unavailable:', error);
    return false;
  }
}

/** Starts monitoring the intent's venue. Replaces any existing region. */
export async function startArrivalGeofence(intent: StoredIntent): Promise<boolean> {
  if (!(await requestBackgroundLocation())) {
    return false;
  }
  try {
    await Location.startGeofencingAsync(ARRIVAL_GEOFENCE_TASK, [
      {
        identifier: `venue-${intent.venueId}`,
        latitude: intent.latitude,
        longitude: intent.longitude,
        radius: Math.max(intent.thresholdMiles * MILES_TO_METRES, MIN_RADIUS_METRES),
        notifyOnEnter: true,
        // We only care about arriving. Watching exits would double the wakeups
        // for an event nothing acts on.
        notifyOnExit: false,
      },
    ]);
    return true;
  } catch (error) {
    console.warn('Could not start the arrival geofence:', error);
    return false;
  }
}

export async function stopArrivalGeofence(): Promise<void> {
  try {
    if (await Location.hasStartedGeofencingAsync(ARRIVAL_GEOFENCE_TASK)) {
      await Location.stopGeofencingAsync(ARRIVAL_GEOFENCE_TASK);
    }
  } catch (error) {
    console.warn('Could not stop the arrival geofence:', error);
  }
}

/**
 * Re-arms monitoring on launch to match whatever intent is actually stored.
 *
 * iOS persists registered regions across app launches, so without this a
 * cancelled intent could leave a live geofence behind that fires days later
 * for a trip nobody is taking.
 */
export async function syncArrivalGeofence(): Promise<void> {
  const intent = await loadStoredIntent();
  if (!intent || intent.arrivedAt) {
    await stopArrivalGeofence();
    return;
  }
  await startArrivalGeofence(intent);
}
