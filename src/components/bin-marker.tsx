import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Marker } from 'react-native-maps';

import type { VenueBin } from '@/types/venue';

type Props = {
  bin: VenueBin;
  onPress: () => void;
};

// How long the marker keeps re-snapshotting its children before freezing.
// Long enough for fonts and layout to settle, short enough that the user
// never sees a blank bubble.
const TRACK_VIEW_CHANGES_MS = 350;

function bubbleSize(venueCount: number): number {
  // Logarithmic, not linear: bin counts span roughly 1 to 3,000, and a linear
  // scale would make every bubble outside the largest city a dot.
  const scale = Math.log10(Math.max(1, venueCount));
  return Math.round(34 + scale * 13);
}

/**
 * One aggregated cluster bubble, shown when the map is zoomed out past the
 * point where individual pins are readable.
 *
 * `tracksViewChanges` is the load-bearing detail here. On iOS a Marker with
 * children re-rasterises its content on every frame while that prop is true,
 * and with ~80 bubbles on screen that alone makes panning unusable. It has to
 * start true (or the bubble renders blank, because the first snapshot is taken
 * before layout) and be switched off once the content has settled.
 */
export function BinMarker({ bin, onPress }: Props) {
  const [tracksViewChanges, setTracksViewChanges] = useState(true);

  useEffect(() => {
    const handle = setTimeout(() => setTracksViewChanges(false), TRACK_VIEW_CHANGES_MS);
    return () => clearTimeout(handle);
    // Re-arm when the count changes: the bubble's label and size change with
    // it, and a frozen marker would keep drawing the old number.
  }, [bin.venue_count]);

  const size = bubbleSize(bin.venue_count);

  return (
    <Marker
      coordinate={{ latitude: bin.latitude, longitude: bin.longitude }}
      onPress={onPress}
      // Without this, MapView.onPress also fires and would immediately undo
      // whatever tapping the bubble just did.
      stopPropagation
      tracksViewChanges={tracksViewChanges}
      // Centre the bubble on the centroid rather than hanging it below, which
      // is the default anchor for a pin shape.
      anchor={{ x: 0.5, y: 0.5 }}>
      <View
        style={[
          styles.bubble,
          { width: size, height: size, borderRadius: size / 2 },
        ]}>
        <Text style={styles.count} allowFontScaling={false}>
          {bin.venue_count >= 1000
            ? `${Math.round(bin.venue_count / 100) / 10}k`
            : bin.venue_count}
        </Text>
      </View>
    </Marker>
  );
}

const styles = StyleSheet.create({
  bubble: {
    // Explicit colours on both text and background: this sits over map tiles,
    // not over a themed surface, so an OS dark-mode default would be invisible.
    backgroundColor: 'rgba(231, 76, 60, 0.92)',
    borderWidth: 2,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  count: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 13,
  },
});
