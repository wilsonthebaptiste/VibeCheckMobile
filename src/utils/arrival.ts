/**
 * Recording an arrival, with no React involved.
 *
 * This is deliberately a plain async function rather than part of
 * `use-visit-intent`. When iOS wakes the app for a geofence crossing it runs a
 * **headless** JavaScript context: there is no component tree, no provider, and
 * no state to set. The background task and the foreground watcher therefore
 * share this, and the hook is a thin wrapper that copies the result into React
 * state afterwards.
 *
 * Everything it touches (AsyncStorage, fetch, expo-notifications) works in that
 * headless context. Anything that needed a hook would not.
 */

import { cancelPrompt, prepareNotifications, schedulePrompt, type PromptData } from '@/utils/notifications';
import {
  loadStoredIntent,
  postArrived,
  saveStoredIntent,
  storedFrom,
  type StoredIntent,
} from '@/utils/visit-intent';

function minutesFrom(iso: string, minutes: number): Date {
  return new Date(Date.parse(iso) + minutes * 60_000);
}

/**
 * Claims arrival at the device's standing intent and fires the prompts.
 *
 * Returns the updated intent, or null when there was nothing to do -- no
 * intent, already arrived, or the server said we are not close enough after
 * all. Callers must treat null as ordinary, not as an error.
 *
 * Safe to call repeatedly: the server sets `arrived_at` once and ignores later
 * claims, so a geofence event and a foreground fix landing together cannot
 * double-schedule the dwell prompt or restart its clock.
 */
export async function completeArrival(
  latitude: number,
  longitude: number
): Promise<StoredIntent | null> {
  const current = await loadStoredIntent();
  if (!current || current.arrivedAt) {
    return null;
  }

  const result = await postArrived(latitude, longitude);
  if (!result.ok) {
    if (!result.stillTravelling) {
      console.warn('Arrival rejected:', result.error);
    }
    return null;
  }

  const arrived = result.intent;

  // You're here, so the "heading out?" reminder has nothing left to say.
  await cancelPrompt(current.nudgeNotificationId);

  let dwellId: string | null = null;
  if (await prepareNotifications()) {
    const data: PromptData = {
      kind: 'arrival',
      venueId: arrived.venue.id,
      venueName: arrived.venue.name,
    };
    // Delivered immediately, so its id is not kept -- there is nothing left to
    // cancel once a notification has already been shown.
    await schedulePrompt({
      title: 'You made it.',
      body: `Would you like to submit a report for ${arrived.venue.name}?`,
      data,
      at: null,
    });
    // SCHEDULED, not setTimeout: a timer dies with the app, and the entire
    // point of this prompt is that it fires while VibeCheck is closed.
    dwellId = await schedulePrompt({
      title: `Still at ${arrived.venue.name}?`,
      body: `I see you're enjoying your time at ${arrived.venue.name} — would you like to leave a review?`,
      data: { ...data, kind: 'dwell' },
      at: minutesFrom(arrived.arrived_at ?? new Date().toISOString(), arrived.dwell_minutes),
    });
  }

  const next = storedFrom(arrived, { nudge: null, dwell: dwellId });
  await saveStoredIntent(next);
  return next;
}
