/**
 * Local notifications for the "going to" flow.
 *
 * Everything here is a LOCAL notification -- nothing is sent from a server.
 * That matters twice over: local notifications are the one notification feature
 * that still works in Expo Go, and they need no `aps-environment` entitlement,
 * which is the entitlement a free Apple ID cannot sign. Remote push would
 * require both a paid account and a push server; this feature needs neither.
 */

import * as Notifications from 'expo-notifications';

/**
 * Identifies the Yes / Not right now button pair. Category identifiers must not
 * contain `:` or `-` (documented in setNotificationCategoryAsync) or the
 * category silently fails to attach and the buttons never appear.
 */
export const REPORT_CATEGORY = 'vibecheck_report_prompt';
export const ACTION_YES = 'vibecheck_report_yes';
export const ACTION_LATER = 'vibecheck_report_later';

/** Which prompt a notification is, carried in its `data` so the tap handler can route it. */
export type PromptKind = 'nudge' | 'arrival' | 'dwell';

export type PromptData = {
  kind: PromptKind;
  venueId: number;
  venueName: string;
};

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    // shouldShowBanner / shouldShowList, NOT shouldShowAlert. The latter is
    // deprecated in this SDK and silently produces no banner at all while the
    // app is foregrounded -- which looks exactly like "notifications are
    // broken" when you are testing with the app open.
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

let categoryRegistered = false;

/**
 * Asks for permission and registers the action buttons.
 *
 * Called when the user declares an intent rather than on app launch: a
 * permission prompt makes sense right after someone says "I'm going here", and
 * is pure friction on first open. iOS only ever shows the system prompt once,
 * so asking at the wrong moment spends the only chance to ask.
 */
export async function prepareNotifications(): Promise<boolean> {
  if (!categoryRegistered) {
    await Notifications.setNotificationCategoryAsync(REPORT_CATEGORY, [
      { identifier: ACTION_YES, buttonTitle: 'Yes' },
      {
        identifier: ACTION_LATER,
        buttonTitle: 'Not right now',
        // Dismissing should not drag the app to the foreground. The tradeoff
        // is documented: with this false, a killed app never delivers the
        // response -- which is fine, because there is nothing to do with it.
        options: { opensAppToForeground: false },
      },
    ]);
    categoryRegistered = true;
  }

  const existing = await Notifications.getPermissionsAsync();
  if (existing.granted) {
    return true;
  }
  // Don't re-ask when the user has explicitly said no: iOS returns denied
  // immediately without showing anything, so this would just be a no-op that
  // looks like a bug in the logs.
  if (!existing.canAskAgain) {
    return false;
  }

  const requested = await Notifications.requestPermissionsAsync();
  return requested.granted;
}

/**
 * Schedules one prompt, or presents it now when `at` is null or already past.
 *
 * Returns the scheduled id so it can be cancelled -- overriding an intent has
 * to withdraw the prompts belonging to the old one, or you get "You made it!"
 * for a bar you changed your mind about.
 */
export async function schedulePrompt(options: {
  title: string;
  body: string;
  data: PromptData;
  at: Date | null;
}): Promise<string | null> {
  const { title, body, data, at } = options;

  try {
    return await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        data,
        sound: true,
        categoryIdentifier: REPORT_CATEGORY,
      },
      trigger:
        at && at.getTime() > Date.now()
          ? { type: Notifications.SchedulableTriggerInputTypes.DATE, date: at }
          : // A null trigger delivers immediately. Reached when a timing has
            // already elapsed -- e.g. the app was closed past the dwell mark --
            // where firing late is far better than not firing at all.
            null,
    });
  } catch (error) {
    // A failed notification must never take the intent down with it. The user
    // still declared they were going somewhere.
    console.warn('Could not schedule notification:', error);
    return null;
  }
}

export async function cancelPrompt(id: string | null | undefined): Promise<void> {
  if (!id) {
    return;
  }
  try {
    await Notifications.cancelScheduledNotificationAsync(id);
  } catch (error) {
    // Already delivered or already cancelled. Not worth surfacing.
    console.warn('Could not cancel notification:', error);
  }
}
