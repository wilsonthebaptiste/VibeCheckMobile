import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, Region } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BinMarker } from '@/components/bin-marker';
import { SearchBar } from '@/components/search-bar';
import { VenueCard } from '@/components/venue-card';
import { API_BASE_URL } from '@/constants/api';
import { BottomTabInset, Spacing } from '@/constants/theme';
import { isAbortError } from '@/utils/fetch';
import type { Bounds, InBoundsResponse, SearchResult, Venue, VenueBin } from '@/types/venue';

// Mirrors the backend's Venue.CATEGORY_CHOICES (the raw OSM `amenity` tag).
const CATEGORY_COLORS: Record<string, string> = {
  bar: '#E74C3C',
  pub: '#E67E22',
  nightclub: '#8E44AD',
  biergarten: '#27AE60',
};
const DEFAULT_PIN_COLOR = '#E74C3C';
// The currently-selected pin. Deliberately outside CATEGORY_COLORS' red /
// orange / purple / green range: when two pins overlap, this is the only thing
// telling you which one the card actually belongs to.
const SELECTED_PIN_COLOR = '#1E6FEB';

const REFETCH_DEBOUNCE_MS = 400;

// A single physical tap on overlapping pins can deliver more than one marker
// press. react-native-maps gives every marker its own UITapGestureRecognizer
// with `cancelsTouchesInView = NO` (AIRMapMarker.m, commented there as
// "allows the parent MapView to continue receiving marker selection events"),
// and _handleTap: both fires onPress AND calls selectAnnotation: -- so the
// gesture and MapKit's own hit-test can resolve to different overlapping
// markers. Each one calls setSelected, and the card visibly lands on one venue
// and then jumps to its neighbour.
//
// Those duplicates arrive within a frame or two of each other, where a
// deliberate second tap is 400ms+ away, so a short lockout separates them
// cleanly without swallowing real taps.
const MARKER_PRESS_LOCKOUT_MS = 250;

function regionToBounds(region: Region): Bounds {
  return {
    min_lat: region.latitude - region.latitudeDelta / 2,
    min_lng: region.longitude - region.longitudeDelta / 2,
    max_lat: region.latitude + region.latitudeDelta / 2,
    max_lng: region.longitude + region.longitudeDelta / 2,
  };
}

/**
 * Venues ordered back-to-front, with the rank each one should use as `zIndex`.
 *
 * Without an explicit zIndex react-native-maps leaves every marker's
 * `zPriority` at 0 (AIRMapMarker's getAnnotationView assigns it straight from
 * `zIndex`), so MapKit has no defined front-to-back order among overlapping
 * pins -- which pin a tap resolves to can then change as the map moves. This
 * is not a rare case: one street-zoom viewport over Sacramento holds 27 venue
 * pairs whose pins physically overlap.
 *
 * Sorting north-to-south means southern pins end up in front, matching the
 * convention MapKit uses for its own labels. Ranks stay within 0..250, well
 * inside MKAnnotationViewZPriority's 0-1000 range, so nothing is clamped.
 */
function stackedByLatitude(venues: Venue[]): { venue: Venue; zIndex: number }[] {
  return [...venues]
    .sort((a, b) => b.latitude - a.latitude || a.id - b.id)
    .map((venue, index) => ({ venue, zIndex: index }));
}

/** True when `inner` is fully inside `outer` -- i.e. we already hold this data. */
function boundsContain(outer: Bounds, inner: Bounds): boolean {
  return (
    outer.min_lat <= inner.min_lat &&
    outer.min_lng <= inner.min_lng &&
    outer.max_lat >= inner.max_lat &&
    outer.max_lng >= inner.max_lng
  );
}

export default function MapScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [location, setLocation] = useState<Location.LocationObject | null>(null);
  const [venues, setVenues] = useState<Venue[]>([]);
  const [bins, setBins] = useState<VenueBin[]>([]);
  const [selected, setSelected] = useState<Venue | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Plain refs, not state: with experiments.reactCompiler enabled, state
  // writes trigger re-renders, and none of these need to re-render the map.
  const mapRef = useRef<MapView | null>(null);
  const servedBoundsRef = useRef<Bounds | null>(null);
  const validSpanRef = useRef<{ min: number; max: number | null } | null>(null);
  // Set when we move the map ourselves (a search fly-to). The gate below is
  // built to suppress redundant fetches, and a short hop into a new city looks
  // exactly like a redundant pan -- without this you land over Davis still
  // looking at Sacramento's pins.
  const forceNextFetchRef = useRef(false);
  const debounceHandleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  // When the last marker press was accepted. A ref, not state: this must not
  // trigger a render, and with experiments.reactCompiler enabled a state write
  // here would. See MARKER_PRESS_LOCKOUT_MS.
  const lastMarkerPressRef = useRef(0);

  /**
   * Takes the lock for one marker press, or returns false if a press was
   * already accepted moments ago.
   *
   * First press wins on purpose: that is the marker whose view hit-tested
   * topmost, which is the pin actually under the user's finger. The duplicate
   * that follows is MapKit's own selection resolving to a neighbour.
   */
  function claimMarkerPress(): boolean {
    const now = Date.now();
    if (now - lastMarkerPressRef.current < MARKER_PRESS_LOCKOUT_MS) {
      return false;
    }
    lastMarkerPressRef.current = now;
    return true;
  }

  async function fetchInBounds(bounds: Bounds, options?: { isInitialLoad?: boolean }) {
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    // Claim this viewport BEFORE awaiting, not after the response lands.
    // Otherwise, while a slow request is in flight the gate still compares
    // against the last SUCCESSFUL bounds, so every subsequent map settle
    // passes the gate and aborts the request that was about to answer it --
    // panning somewhere new aborts itself in a loop and never renders.
    // Rolled back on real failure so a retry can still happen.
    const previousBounds = servedBoundsRef.current;
    const previousSpan = validSpanRef.current;
    servedBoundsRef.current = bounds;

    const params = new URLSearchParams({
      min_lat: String(bounds.min_lat),
      min_lng: String(bounds.min_lng),
      max_lat: String(bounds.max_lat),
      max_lng: String(bounds.max_lng),
    });

    try {
      const response = await fetch(`${API_BASE_URL}/venues/in-bounds/?${params}`, {
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`API returned status ${response.status}`);
      }

      const data: InBoundsResponse = await response.json();

      // Replace, never merge. Merging never evicts anything, so panning
      // LA -> Denver -> NYC accumulates thousands of markers until MapKit
      // gives up. Keys are stable, so replacing doesn't remount what stayed.
      setVenues(data.venues);
      setBins(data.bins);
      servedBoundsRef.current = data.served_bounds;
      validSpanRef.current = { min: data.valid_span_min, max: data.valid_span_max };
    } catch (error) {
      if (isAbortError(error)) {
        // A newer fetch superseded this one and already claimed the viewport;
        // leave its claim intact rather than reverting to ours.
        return;
      }
      servedBoundsRef.current = previousBounds;
      validSpanRef.current = previousSpan;
      console.error('Failed to fetch venues:', error);
      // Only the initial load can blank the screen -- a pan-triggered refetch
      // failing later must never destroy an already-rendered map full of
      // valid pins. The backend follows the same "stale beats blank" rule.
      if (options?.isInitialLoad) {
        setErrorMsg('Could not load venues. Check that the backend server is running.');
      }
    }
  }

  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();

      if (status !== 'granted') {
        setErrorMsg('Location permission denied. VibeCheck needs this to show nearby venues.');
        setLoading(false);
        return;
      }

      const currentLocation = await Location.getCurrentPositionAsync({});
      setLocation(currentLocation);

      await fetchInBounds(
        regionToBounds({
          latitude: currentLocation.coords.latitude,
          longitude: currentLocation.coords.longitude,
          latitudeDelta: 0.05,
          longitudeDelta: 0.05,
        }),
        { isInitialLoad: true }
      );

      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleRegionChangeComplete(region: Region) {
    const bounds = regionToBounds(region);

    if (!forceNextFetchRef.current) {
      const served = servedBoundsRef.current;
      const span = validSpanRef.current;

      // Two independent reasons to refetch, and both thresholds come from the
      // server rather than being re-derived here:
      //   - the viewport has moved outside the (deliberately over-sized) box
      //     the server actually served, so there is genuinely new area on
      //     screen; or
      //   - the zoom has left the interval over which the server's choice of
      //     mode and bin size stays correct.
      const insideServed = served !== null && boundsContain(served, bounds);
      const insideSpan =
        span !== null &&
        region.latitudeDelta >= span.min &&
        (span.max === null || region.latitudeDelta <= span.max);

      if (insideServed && insideSpan) {
        return;
      }
    }
    forceNextFetchRef.current = false;

    if (debounceHandleRef.current) {
      clearTimeout(debounceHandleRef.current);
    }
    debounceHandleRef.current = setTimeout(() => {
      fetchInBounds(bounds);
    }, REFETCH_DEBOUNCE_MS);
  }

  function handleSearchSelect(result: SearchResult) {
    setSelected(null);
    forceNextFetchRef.current = true;

    if (result.type === 'venue') {
      // Frame the venue tightly enough that the server answers in `venues`
      // mode, so the thing that was searched for is an actual tappable pin
      // rather than being swallowed by a cluster bubble.
      mapRef.current?.animateToRegion(
        {
          latitude: result.latitude,
          longitude: result.longitude,
          latitudeDelta: 0.02,
          longitudeDelta: 0.02,
        },
        600
      );
      setSelected(result);
      return;
    }

    // A place: fly to the bbox Nominatim gave us. Using the box rather than
    // the point plus a guessed zoom is what makes "Texas" show Texas instead
    // of one street in Austin.
    const latitudeDelta = Math.max(0.02, result.max_lat - result.min_lat);
    const longitudeDelta = Math.max(0.02, result.max_lng - result.min_lng);
    mapRef.current?.animateToRegion(
      {
        latitude: (result.min_lat + result.max_lat) / 2,
        longitude: (result.min_lng + result.max_lng) / 2,
        latitudeDelta,
        longitudeDelta,
      },
      600
    );
  }

  function handleVenuePress(venue: Venue) {
    if (!claimMarkerPress()) {
      return;
    }
    setSelected(venue);
  }

  function handleBinPress(bin: VenueBin) {
    // Bubbles need the same guard as pins: a duplicate press here would run
    // animateToRegion twice and zoom two steps instead of one.
    if (!claimMarkerPress()) {
      return;
    }
    forceNextFetchRef.current = true;
    // Zoom in far enough to cross the next threshold rather than nudging --
    // tapping a bubble and getting the same bubble back reads as broken.
    mapRef.current?.animateToRegion(
      {
        latitude: bin.latitude,
        longitude: bin.longitude,
        latitudeDelta: Math.max(0.02, (validSpanRef.current?.min ?? 0.08) / 2.5),
        longitudeDelta: Math.max(0.02, (validSpanRef.current?.min ?? 0.08) / 2.5),
      },
      500
    );
  }

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" />
        <Text style={styles.text}>Getting your location...</Text>
      </View>
    );
  }

  if (errorMsg) {
    return (
      <View style={styles.centered}>
        <Text style={styles.text}>{errorMsg}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={styles.map}
        initialRegion={{
          latitude: location!.coords.latitude,
          longitude: location!.coords.longitude,
          latitudeDelta: 0.05,
          longitudeDelta: 0.05,
        }}
        onRegionChangeComplete={handleRegionChangeComplete}
        // Tapping the map dismisses the card. Markers set `stopPropagation`,
        // so this does not fire for them.
        onPress={() => setSelected(null)}
        // Apple's own bar/restaurant POI labels aren't tappable in this
        // architecture (that's the whole reason we render our own markers),
        // so leaving them on just shows two competing sets of icons.
        showsPointsOfInterests={false}
        showsUserLocation>
        {stackedByLatitude(venues).map(({ venue, zIndex }) => {
          const isSelected = selected?.id === venue.id;
          return (
            <Marker
              key={venue.id}
              coordinate={{ latitude: venue.latitude, longitude: venue.longitude }}
              pinColor={
                isSelected
                  ? SELECTED_PIN_COLOR
                  : CATEGORY_COLORS[venue.category] ?? DEFAULT_PIN_COLOR
              }
              // Gives MapKit a defined stacking order among overlapping pins,
              // and lifts the selected one clear of its neighbours so it is
              // never buried under the pin next to it.
              zIndex={isSelected ? venues.length : zIndex}
              // No `title`/`description`: those render MapKit's own native
              // callout, which competes with our card AND makes the map auto-pan
              // to fit the bubble -- firing onRegionChangeComplete and causing a
              // spurious refetch every time a pin is tapped.
              stopPropagation
              onPress={() => handleVenuePress(venue)}
            />
          );
        })}

        {bins.map((bin) => (
          <BinMarker
            key={`${bin.latitude},${bin.longitude}`}
            bin={bin}
            onPress={() => handleBinPress(bin)}
          />
        ))}
      </MapView>

      {/* Required by OSM's ODbL license. Pushed below the search bar rather
          than removed -- it has to stay visible on the map itself. */}
      <Pressable
        onPress={() => WebBrowser.openBrowserAsync('https://www.openstreetmap.org/copyright')}
        style={[styles.attribution, { top: insets.top + 60 }]}>
        <Text style={styles.attributionText}>© OpenStreetMap contributors</Text>
      </Pressable>

      <View style={[styles.searchLayer, { top: insets.top + Spacing.two }]}>
        <SearchBar
          origin={
            location
              ? { latitude: location.coords.latitude, longitude: location.coords.longitude }
              : null
          }
          onSelect={handleSearchSelect}
        />
      </View>

      {selected ? (
        <View
          style={[
            styles.cardLayer,
            { bottom: insets.bottom + BottomTabInset + Spacing.three },
          ]}>
          <VenueCard
            venue={selected}
            onPress={() => router.push(`/venue/${selected.id}`)}
            onDismiss={() => setSelected(null)}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  map: {
    flex: 1,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    padding: 20,
  },
  text: {
    fontSize: 16,
    color: '#000000',
    marginTop: 12,
    textAlign: 'center',
  },
  searchLayer: {
    position: 'absolute',
    left: 0,
    right: 0,
  },
  cardLayer: {
    position: 'absolute',
    left: Spacing.three,
    right: Spacing.three,
  },
  attribution: {
    position: 'absolute',
    right: Spacing.three,
    backgroundColor: 'rgba(255, 255, 255, 0.85)',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 6,
  },
  attributionText: {
    fontSize: 11,
    color: '#000000',
  },
});
