import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useVisitIntent } from '@/hooks/use-visit-intent';

type Props = {
  venueId: number;
  /** `compact` is the map card; `full` is the detail screen. */
  variant?: 'compact' | 'full';
};

/**
 * The Yes / No prompt that turns "I tapped a pin" into "I'm going there".
 *
 * Three states, and they are the intent's states, not this component's -- the
 * button reads them from the shared provider so the map card and the detail
 * screen can never disagree about whether you said you were going:
 *
 *   asking   -- no intent, or an intent for a DIFFERENT venue
 *   going    -- declared, not yet arrived (tap to cancel)
 *   arrived  -- the server has confirmed you're here
 *
 * Declaring while an intent exists for another venue silently overrides it.
 * That is deliberate and is enforced server-side by a unique constraint, so
 * there is no confirmation step to get out of sync with.
 */
export function GoingButton({ venueId, variant = 'compact' }: Props) {
  const theme = useTheme();
  const { intent, busy, error, declare, cancel } = useVisitIntent();

  const isThisVenue = intent?.venueId === venueId;
  const hasArrived = isThisVenue && intent?.arrivedAt !== null;
  const small = variant === 'compact';

  if (hasArrived) {
    return (
      <View style={[styles.row, small && styles.rowCompact]}>
        <ThemedText type="small" style={{ color: theme.accent }}>
          ✓ You&apos;re here
        </ThemedText>
      </View>
    );
  }

  if (isThisVenue) {
    return (
      <View style={[styles.row, small && styles.rowCompact]}>
        <ThemedText type="small" themeColor="textSecondary">
          On your way
        </ThemedText>
        <Pressable
          onPress={cancel}
          disabled={busy}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Cancel going to this venue"
          style={({ pressed }) => pressed && styles.pressed}>
          <ThemedText type="smallBold" style={{ color: theme.accent }}>
            {busy ? 'Cancelling…' : 'Cancel'}
          </ThemedText>
        </Pressable>
      </View>
    );
  }

  return (
    <View>
      <View style={[styles.row, small && styles.rowCompact]}>
        <ThemedText type="small" themeColor="textSecondary" style={styles.prompt}>
          Going here?
        </ThemedText>
        {busy ? (
          <ActivityIndicator size="small" />
        ) : (
          <>
            <Pressable
              onPress={() => declare(venueId)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Yes, I'm going here"
              style={({ pressed }) => pressed && styles.pressed}>
              <View style={[styles.chip, { backgroundColor: theme.backgroundSelected }]}>
                <ThemedText type="smallBold">Yes</ThemedText>
              </View>
            </Pressable>
            {/* "No" is not the inverse of "Yes" -- with no intent for this
                venue there is nothing to undo, so it only ever clears an
                intent that actually exists. Rendering it regardless keeps the
                pair visually balanced. */}
            <Pressable
              onPress={intent ? cancel : undefined}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="No, I'm not going here"
              style={({ pressed }) => pressed && styles.pressed}>
              <View style={[styles.chip, { backgroundColor: theme.backgroundElement }]}>
                <ThemedText type="smallBold" themeColor="textSecondary">
                  No
                </ThemedText>
              </View>
            </Pressable>
          </>
        )}
      </View>
      {error ? (
        <ThemedText type="small" style={styles.error}>
          {error}
        </ThemedText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    marginTop: Spacing.two,
  },
  rowCompact: {
    marginTop: Spacing.one,
  },
  prompt: {
    marginRight: Spacing.half,
  },
  chip: {
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.three,
  },
  pressed: {
    opacity: 0.7,
  },
  error: {
    marginTop: Spacing.one,
    // Explicit, not inherited: this can render over the map, which is tiles
    // rather than a themed surface.
    color: '#D9534F',
  },
});
