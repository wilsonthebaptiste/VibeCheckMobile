/**
 * The whole "going to" lifecycle, in one place, mounted once at the app root.
 *
 * It lives at the root rather than on the map screen because the two moments it
 * exists for -- arriving, and having been somewhere 30 minutes -- happen while
 * the user is doing something else entirely. A hook on the map screen would
 * stop watching the instant they opened a venue detail.
 *
 * The state machine is small:
 *
 *   (none) --declare--> en route --arrive--> arrived --dwell timer--> prompted
 *      ^                    |                   |
 *      +------ cancel ------+-------------------+
 *
 * Arrival is detected in the FOREGROUND here (Location.watchPositionAsync).
 * That is the one thing Expo Go cannot do better: background location and
 * geofencing both require a native build. Step 4 of the plan swaps this single
 * effect for `Location.startGeofencingAsync`; nothing else in this file, the
 * notifications, or the API changes when it does.
 */

import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Alert } from 'react-native';

import { completeArrival } from '@/utils/arrival';
import { haversineMiles } from '@/utils/distance';
import { isAbortError } from '@/utils/fetch';
import {
  startArrivalGeofence,
  stopArrivalGeofence,
  syncArrivalGeofence,
} from '@/utils/geofence';
import {
  ACTION_LATER,
  cancelPrompt,
  prepareNotifications,
  schedulePrompt,
  type PromptData,
} from '@/utils/notifications';
import {
  clearIntent,
  declareIntent,
  fetchIntent,
  fetchVenueHere,
  loadStoredIntent,
  saveStoredIntent,
  storedFrom,
  type StoredIntent,
} from '@/utils/visit-intent';

/**
 * High accuracy, not Balanced. The tightest proximity threshold is 0.1 mi
 * (161 m) and Balanced is only accurate to ~100 m -- enough error to announce
 * an arrival from across the block, or miss one from the doorway. This runs
 * only while an intent is declared and not yet arrived, so the battery cost is
 * bounded by one trip rather than being always-on.
 */
const WATCH_OPTIONS: Location.LocationOptions = {
  accuracy: Location.Accuracy.High,
  timeInterval: 15_000,
  distanceInterval: 20,
};

type VisitIntentContextValue = {
  intent: StoredIntent | null;
  /** True while a declare/cancel round trip is in flight. */
  busy: boolean;
  error: string | null;
  declare: (venueId: number) => Promise<void>;
  cancel: () => Promise<void>;
};

const VisitIntentContext = createContext<VisitIntentContextValue | null>(null);

function minutesFrom(iso: string, minutes: number): Date {
  return new Date(Date.parse(iso) + minutes * 60_000);
}

export function VisitIntentProvider({ children }: { children: ReactNode }) {
  const router = useRouter();

  const [intent, setIntent] = useState<StoredIntent | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Mirrors `intent` for code that runs outside React's render cycle -- the
   * location callback and the notification listener both fire from native and
   * would otherwise close over whatever `intent` was when the effect was set
   * up, which is stale by definition.
   */
  const intentRef = useRef<StoredIntent | null>(null);
  /** Guards against a burst of GPS fixes each firing its own arrival POST. */
  const arrivingRef = useRef(false);
  /** Notification responses can arrive twice (cold-start read + live listener). */
  const handledResponsesRef = useRef(new Set<string>());

  const apply = useCallback(async (next: StoredIntent | null) => {
    intentRef.current = next;
    setIntent(next);
    await saveStoredIntent(next);
  }, []);

  const withdrawPrompts = useCallback(async (stored: StoredIntent | null) => {
    if (!stored) {
      return;
    }
    await cancelPrompt(stored.nudgeNotificationId);
    await cancelPrompt(stored.dwellNotificationId);
  }, []);

  // --- launch: cached state first, then the server -------------------------

  useEffect(() => {
    const controller = new AbortController();

    (async () => {
      // Read the cache first so the button renders in the right state
      // immediately; without this it flickers "Are you going?" -> "Going" on
      // every cold launch.
      const cached = await loadStoredIntent();
      if (cached && !controller.signal.aborted) {
        intentRef.current = cached;
        setIntent(cached);
      }

      try {
        const remote = await fetchIntent(controller.signal);
        if (controller.signal.aborted) {
          return;
        }
        if (remote === null) {
          // The server is authoritative: it expired, or another install
          // cleared it. Withdraw the prompts belonging to a trip that is over.
          await withdrawPrompts(cached);
          await apply(null);
          await stopArrivalGeofence();
          return;
        }

        // Notification ids exist ONLY on this device -- the server has never
        // heard of them -- so they have to be carried across a re-hydrate by
        // hand. They belong to the cached venue, though: if the server names a
        // different one, those prompts are for a trip that is over and must be
        // withdrawn rather than re-attached to the new intent.
        const sameVenue = cached?.venueId === remote.venue.id;
        if (cached && !sameVenue) {
          await withdrawPrompts(cached);
        }
        await apply(
          storedFrom(remote, {
            nudge: sameVenue ? cached?.nudgeNotificationId : null,
            dwell: sameVenue ? cached?.dwellNotificationId : null,
          })
        );
        // iOS persists registered regions across launches, so a cancelled
        // intent could otherwise leave a live geofence behind that fires days
        // later for a trip nobody is taking.
        await syncArrivalGeofence();
      } catch (fetchError) {
        if (isAbortError(fetchError)) {
          return;
        }
        // Offline on launch is not a reason to forget where you said you were
        // going. Keep the cache and try again next launch.
        console.warn('Could not re-hydrate intent:', fetchError);
      }
    })();

    return () => controller.abort();
  }, [apply, withdrawPrompts]);

  // --- declaring and cancelling --------------------------------------------

  const declare = useCallback(
    async (venueId: number) => {
      setBusy(true);
      setError(null);
      try {
        const previous = intentRef.current;
        const declared = await declareIntent(venueId);

        // Only after the server has accepted the new intent. Withdrawing first
        // would leave the user with no prompts at all if the request failed.
        await withdrawPrompts(previous);

        const allowed = await prepareNotifications();
        let nudgeId: string | null = null;
        if (allowed) {
          nudgeId = await schedulePrompt({
            title: `Heading to ${declared.venue.name}?`,
            body: 'Open VibeCheck when you get there so we can check you in.',
            data: {
              kind: 'nudge',
              venueId: declared.venue.id,
              venueName: declared.venue.name,
            },
            at: minutesFrom(declared.declared_at, declared.nudge_minutes),
          });
        }

        const stored = storedFrom(declared, { nudge: nudgeId });
        await apply(stored);

        // Hand the venue to iOS to monitor. This is what makes arrival fire
        // with the app closed; the foreground watcher below stays anyway,
        // because iOS only fires ENTER on CROSSING a boundary and declaring
        // while already inside the radius may fire nothing at all.
        await startArrivalGeofence(stored);
      } catch (declareError) {
        setError(
          declareError instanceof Error
            ? declareError.message
            : 'Could not save that. Check that the backend server is running.'
        );
      } finally {
        setBusy(false);
      }
    },
    [apply, withdrawPrompts]
  );

  const cancel = useCallback(async () => {
    setBusy(true);
    setError(null);
    const previous = intentRef.current;
    try {
      await clearIntent();
      await withdrawPrompts(previous);
      await stopArrivalGeofence();
      await apply(null);
    } catch (cancelError) {
      setError(
        cancelError instanceof Error
          ? cancelError.message
          : 'Could not cancel. Check that the backend server is running.'
      );
    } finally {
      setBusy(false);
    }
  }, [apply, withdrawPrompts]);

  /** Local clear, for when the server has already told us the trip is over. */
  const forget = useCallback(async () => {
    const previous = intentRef.current;
    await withdrawPrompts(previous);
    await stopArrivalGeofence();
    await apply(null);
  }, [apply, withdrawPrompts]);

  // --- arrival --------------------------------------------------------------

  /**
   * The foreground path into `completeArrival`.
   *
   * The work itself lives in `src/utils/arrival.ts` because the geofence task
   * has to do exactly the same thing from a headless context with no React.
   * All this adds is the in-flight guard and copying the result into state.
   */
  const recordArrival = useCallback(
    async (latitude: number, longitude: number) => {
      const current = intentRef.current;
      if (!current || current.arrivedAt || arrivingRef.current) {
        return;
      }
      arrivingRef.current = true;
      try {
        const arrived = await completeArrival(latitude, longitude);
        if (arrived) {
          // completeArrival already persisted it; this only syncs React.
          intentRef.current = arrived;
          setIntent(arrived);
          await stopArrivalGeofence();
        }
      } catch (arrivalError) {
        console.warn('Could not record arrival:', arrivalError);
      } finally {
        arrivingRef.current = false;
      }
    },
    []
  );

  const watchedVenueId = intent && !intent.arrivedAt ? intent.venueId : null;

  useEffect(() => {
    if (watchedVenueId === null) {
      return;
    }

    let subscription: Location.LocationSubscription | null = null;
    let cancelled = false;

    (async () => {
      // Only ever CHECK permission here. The map screen owns the request, and
      // asking again from a background-ish hook produces a prompt with no
      // visible context for why it appeared.
      const { status } = await Location.getForegroundPermissionsAsync();
      if (status !== 'granted' || cancelled) {
        return;
      }
      try {
        const next = await Location.watchPositionAsync(WATCH_OPTIONS, (position) => {
          const current = intentRef.current;
          if (!current || current.arrivedAt) {
            return;
          }
          const distance = haversineMiles(
            position.coords.latitude,
            position.coords.longitude,
            current.latitude,
            current.longitude
          );
          if (distance <= current.thresholdMiles) {
            void recordArrival(position.coords.latitude, position.coords.longitude);
          }
        });
        // The effect can be torn down while watchPositionAsync is still
        // resolving; without this the subscription leaks and keeps the GPS on.
        if (cancelled) {
          next.remove();
        } else {
          subscription = next;
        }
      } catch (watchError) {
        console.warn('Could not watch position for arrival:', watchError);
      }
    })();

    return () => {
      cancelled = true;
      subscription?.remove();
    };
  }, [watchedVenueId, recordArrival]);

  // --- notification taps ----------------------------------------------------

  const openReportFor = useCallback(
    async (data: PromptData) => {
      if (data.kind !== 'dwell') {
        router.push(`/venue/${data.venueId}`);
        return;
      }

      // The dwell prompt was scheduled optimistically at arrival + N minutes,
      // so by now the user may well have left. Ask where they actually are
      // rather than opening a form the server would refuse.
      try {
        const { status } = await Location.getForegroundPermissionsAsync();
        if (status !== 'granted') {
          router.push(`/venue/${data.venueId}`);
          return;
        }
        const position = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        const here = await fetchVenueHere(
          position.coords.latitude,
          position.coords.longitude
        );
        if (here) {
          router.push(`/venue/${here.id}`);
          return;
        }
        await forget();
        Alert.alert(
          'Looks like you moved on',
          `You're not at ${data.venueName} any more, so there's nothing to report there. Have a good night.`
        );
      } catch (resolveError) {
        console.warn('Could not resolve the dwell prompt:', resolveError);
        router.push(`/venue/${data.venueId}`);
      }
    },
    [router, forget]
  );

  useEffect(() => {
    const handle = (response: Notifications.NotificationResponse) => {
      const id = response.notification.request.identifier;
      if (handledResponsesRef.current.has(id)) {
        return;
      }
      handledResponsesRef.current.add(id);

      // "Not right now" is a dismissal and nothing more. It deliberately does
      // NOT clear the intent -- the dwell prompt is still worth firing later.
      if (response.actionIdentifier === ACTION_LATER) {
        return;
      }

      const data = response.notification.request.content.data as
        | Partial<PromptData>
        | undefined;
      if (!data?.kind || typeof data.venueId !== 'number') {
        return;
      }
      void openReportFor(data as PromptData);
    };

    const subscription = Notifications.addNotificationResponseReceivedListener(handle);

    // The listener does not replay the tap that LAUNCHED the app from cold,
    // which is the most important case of all -- the whole feature is about
    // notifications arriving while VibeCheck is closed.
    Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        if (response) {
          handle(response);
        }
      })
      .catch((lastError) => {
        console.warn('Could not read the launching notification:', lastError);
      });

    return () => subscription.remove();
  }, [openReportFor]);

  const value = useMemo(
    () => ({ intent, busy, error, declare, cancel }),
    [intent, busy, error, declare, cancel]
  );

  return (
    <VisitIntentContext.Provider value={value}>{children}</VisitIntentContext.Provider>
  );
}

export function useVisitIntent(): VisitIntentContextValue {
  const context = useContext(VisitIntentContext);
  if (!context) {
    throw new Error('useVisitIntent must be used inside <VisitIntentProvider>');
  }
  return context;
}
