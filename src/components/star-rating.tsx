import { SymbolView } from 'expo-symbols';
import { StyleSheet, View } from 'react-native';

import { useTheme } from '@/hooks/use-theme';

type Props = {
  /** 0-5. Values are rendered to the nearest half star. */
  score: number;
  size?: number;
};

/**
 * The liveliness score as five stars, Yelp-style.
 *
 * NEVER render this inside a `<Marker>`. Any Marker with children is
 * re-snapshotted into a native image as the map moves, and five SF Symbol
 * views x a few hundred markers doing that per frame makes the map unusable.
 * Scores belong on the card, which is a normal view outside the map's
 * rendering path.
 */
export function StarRating({ score, size = 16 }: Props) {
  const theme = useTheme();
  // Round to the nearest half so 3.4 and 3.6 don't both read as "3.5-ish"
  // while 3.5 renders differently from either.
  const halves = Math.round(Math.max(0, Math.min(5, score)) * 2);

  return (
    <View style={styles.row}>
      {[0, 1, 2, 3, 4].map((index) => {
        const filled = halves - index * 2;
        const name = filled >= 2 ? 'star.fill' : filled === 1 ? 'star.leadinghalf.filled' : 'star';
        return (
          <SymbolView
            key={index}
            name={name}
            size={size}
            // A half star is one glyph drawn in a single colour, so an unfilled
            // star must be visibly different from a filled one by colour alone.
            tintColor={filled >= 1 ? theme.accent : theme.accentMuted}
            style={{ width: size, height: size }}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
});
