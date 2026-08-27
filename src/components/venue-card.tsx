import { Pressable, StyleSheet, View } from 'react-native';

import { StarRating } from '@/components/star-rating';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { Venue } from '@/types/venue';

type Props = {
  venue: Venue;
  onPress: () => void;
  onDismiss: () => void;
};

/**
 * The overlay shown when a pin is tapped: name, score, and a way into the
 * detail screen.
 *
 * Takes the whole venue object rather than an id. A background refetch can
 * replace the venue list at any time, and looking the card up by id would make
 * it blank or vanish mid-read when that happens.
 */
export function VenueCard({ venue, onPress, onDismiss }: Props) {
  const theme = useTheme();
  const { liveliness, liveliness_label, report_count } = venue.current_status;

  return (
    <View style={[styles.card, { backgroundColor: theme.background }]}>
      <Pressable onPress={onPress} style={styles.body} accessibilityRole="button">
        <ThemedText numberOfLines={1} style={styles.name}>
          {venue.name}
        </ThemedText>

        {/* ~32% of OSM venues carry no address tags at all, so this must be
            conditional rather than showing an "Address unknown" placeholder. */}
        {venue.address ? (
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
            {venue.address}
          </ThemedText>
        ) : null}

        {liveliness === null ? (
          // The designed state, not a fallback: with ~40,000 venues and far
          // fewer reports, most pins land here. Five empty outlines would read
          // as "rated zero stars", which is worse than no stars at all -- so
          // this branch renders none, and asks for the first report instead.
          <ThemedText type="small" themeColor="textSecondary" style={styles.status}>
            No reports yet · Tap to be the first →
          </ThemedText>
        ) : (
          <View style={styles.status}>
            <View style={styles.scoreRow}>
              <StarRating score={liveliness} />
              <ThemedText type="smallBold" style={{ color: theme.accent }}>
                {liveliness.toFixed(1)}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {liveliness_label}
              </ThemedText>
            </View>
            {/* "last hour" is not optional. This is a 60-minute rolling mean
                presented in the visual language of a Yelp star rating, and
                without the qualifier it reads as a lifetime score. */}
            <ThemedText type="small" themeColor="textSecondary">
              {report_count} {report_count === 1 ? 'report' : 'reports'} · last hour
            </ThemedText>
          </View>
        )}
      </Pressable>

      <Pressable
        onPress={onDismiss}
        style={styles.dismiss}
        hitSlop={12}
        accessibilityLabel="Dismiss"
        accessibilityRole="button">
        <ThemedText type="small" themeColor="textSecondary">
          ✕
        </ThemedText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 14,
    paddingVertical: Spacing.three,
    paddingLeft: Spacing.three,
    paddingRight: Spacing.two,
    flexDirection: 'row',
    alignItems: 'flex-start',
    // Explicit shadow on both platforms -- the card floats over the map, and
    // without separation it reads as part of the map tiles.
    shadowColor: '#000000',
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  body: {
    flex: 1,
  },
  name: {
    marginBottom: 2,
    fontWeight: '700',
  },
  status: {
    marginTop: Spacing.two,
    gap: 2,
  },
  scoreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  dismiss: {
    padding: Spacing.one,
  },
});
