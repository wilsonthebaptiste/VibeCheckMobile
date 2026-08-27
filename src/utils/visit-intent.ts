/**
 * The "going to" intent: API calls, plus the local mirror of what was declared.
 *
 * The device UUID from `getDeviceId()` is the whole identity model here, same
 * as for report submission -- there is no auth, so "this device's intent" is
 * the only scope that exists.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import { API_BASE_URL } from '@/constants/api';
import type { VenueHereResponse, VisitIntent, VisitIntentResponse } from '@/types/venue';
import { getDeviceId } from '@/utils/device';

const STORAGE_KEY = 'vibecheck_visit_intent';

/**
 * What we keep on the device.
 *
 * Cached rather than re-fetched on every launch so a cold start can render the
 * button in the right state before the network answers -- otherwise the "Going"
 * chip flickers back to "Are you going?" on every open. It also holds the two
 * scheduled notification ids, which exist ONLY on this device and could not be
 * recovered from the server at all.
 */
export type StoredIntent = {
  venueId: number;
  venueName: string;
  latitude: number;
  longitude: number;
  /** Server-owned; see the VisitIntent type. Mirrored, never invented here. */
  thresholdMiles: number;
  dwellMinutes: number;
  nudgeMinutes: number;
  declaredAt: string;
  arrivedAt: string | null;
  expiresAt: string;
  nudgeNotificationId: string | null;
  dwellNotificationId: string | null;
};

export function storedFrom(
  intent: VisitIntent,
  notificationIds?: { nudge?: string | null; dwell?: string | null }
): StoredIntent {
  return {
    venueId: intent.venue.id,
    venueName: intent.venue.name,
    latitude: intent.venue.latitude,
    longitude: intent.venue.longitude,
    thresholdMiles: intent.proximity_threshold_miles,
    dwellMinutes: intent.dwell_minutes,
    nudgeMinutes: intent.nudge_minutes,
    declaredAt: intent.declared_at,
    arrivedAt: intent.arrived_at,
    expiresAt: intent.expires_at,
    nudgeNotificationId: notificationIds?.nudge ?? null,
    dwellNotificationId: notificationIds?.dwell ?? null,
  };
}

export async function loadStoredIntent(): Promise<StoredIntent | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const stored = JSON.parse(raw) as StoredIntent;
    // The server enforces the same TTL, but the cache is read BEFORE the
    // network answers -- without this check a cold launch would briefly show
    // "Going" for an intent that expired overnight.
    if (Date.parse(stored.expiresAt) <= Date.now()) {
      await AsyncStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return stored;
  } catch (error) {
    // Corrupt or schema-drifted JSON must not brick app launch. Losing the
    // cache costs one flicker; throwing here costs the whole app.
    console.warn('Could not read stored intent:', error);
    return null;
  }
}

export async function saveStoredIntent(intent: StoredIntent | null): Promise<void> {
  try {
    if (intent === null) {
      await AsyncStorage.removeItem(STORAGE_KEY);
    } else {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(intent));
    }
  } catch (error) {
    console.warn('Could not persist intent:', error);
  }
}

async function readError(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  return body?.error ?? `Request failed (status ${response.status})`;
}

/**
 * PUT /api/venues/<id>/intent/ -- declare.
 *
 * Overriding a previous declaration is the SERVER's job (device_id is unique,
 * so this upserts). There is deliberately no "clear the old one first" call
 * here: a two-step override could half-fail and leave the device en route to
 * nowhere.
 */
export async function declareIntent(venueId: number): Promise<VisitIntent> {
  const deviceId = await getDeviceId();
  const response = await fetch(`${API_BASE_URL}/venues/${venueId}/intent/`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ device_id: deviceId }),
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return (await response.json()) as VisitIntent;
}

export async function fetchIntent(signal?: AbortSignal): Promise<VisitIntent | null> {
  const deviceId = await getDeviceId();
  const response = await fetch(
    `${API_BASE_URL}/intent/?device_id=${encodeURIComponent(deviceId)}`,
    { signal }
  );
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  const data = (await response.json()) as VisitIntentResponse;
  return data.intent;
}

export async function clearIntent(): Promise<void> {
  const deviceId = await getDeviceId();
  const response = await fetch(
    `${API_BASE_URL}/intent/?device_id=${encodeURIComponent(deviceId)}`,
    { method: 'DELETE' }
  );
  if (!response.ok) {
    throw new Error(await readError(response));
  }
}

export type ArrivalResult =
  | { ok: true; intent: VisitIntent }
  /**
   * `stillTravelling` is the ordinary case, not a failure: the server disagreed
   * that we are close enough, so the watcher keeps going. Distinguished from a
   * real error so a 403 doesn't surface as "something went wrong".
   */
  | { ok: false; stillTravelling: true }
  | { ok: false; stillTravelling: false; error: string };

/**
 * POST /api/intent/arrived/ -- claim arrival, which the server re-verifies.
 *
 * The client already checked the distance locally before calling this. The
 * server checks again against the same threshold submit_report will use, so a
 * device can never be told "you made it" only to be refused at the report.
 */
export async function postArrived(
  latitude: number,
  longitude: number
): Promise<ArrivalResult> {
  const deviceId = await getDeviceId();
  const response = await fetch(`${API_BASE_URL}/intent/arrived/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ device_id: deviceId, latitude, longitude }),
  });

  if (response.ok) {
    return { ok: true, intent: (await response.json()) as VisitIntent };
  }
  if (response.status === 403) {
    return { ok: false, stillTravelling: true };
  }
  return { ok: false, stillTravelling: false, error: await readError(response) };
}

/**
 * GET /api/venues/here/ -- the venue the device is actually standing in.
 *
 * The dwell prompt is scheduled optimistically at arrival + N minutes, so by
 * the time it fires the user may well have left. This is what lets the tap
 * handler open the bar they are in now, or say they have moved on, instead of
 * opening a report form the server would reject.
 */
export async function fetchVenueHere(
  latitude: number,
  longitude: number
): Promise<VenueHereResponse['venue']> {
  const response = await fetch(
    `${API_BASE_URL}/venues/here/?lat=${latitude}&lng=${longitude}`
  );
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  const data = (await response.json()) as VenueHereResponse;
  return data.venue;
}
