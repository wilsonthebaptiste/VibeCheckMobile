import * as Location from 'expo-location';
import { Stack, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { GoingButton } from '@/components/going-button';
import { StarRating } from '@/components/star-rating';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { API_BASE_URL } from '@/constants/api';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { getDeviceId } from '@/utils/device';
import type { LivelinessStatus } from '@/types/venue';

/** What a user can SUBMIT is still one of five discrete levels. */
type LivelinessValue = 1 | 2 | 3 | 4 | 5;

type VenueDetail = {
  id: number;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  category: string;
  created_at: string;
  // Null for hand-added venues (e.g. seeded for device testing); present
  // for venues sourced from OpenStreetMap.
  osm_type: 'node' | 'way' | 'relation' | null;
  osm_id: number | null;
  // Note the asymmetry with LivelinessValue above: what comes BACK is the
  // plain mean of the last hour's reports, so it is fractional (3.4). Typing
  // this as 1|2|3|4|5 was correct only while the backend rounded before
  // serialising, and would now silently mistype most real responses.
  current_status: LivelinessStatus;
};

const LIVELINESS_LEVELS: { value: LivelinessValue; label: string }[] = [
  { value: 1, label: 'Dead' },
  { value: 2, label: 'Quiet' },
  { value: 3, label: 'Moderate' },
  { value: 4, label: 'Busy' },
  { value: 5, label: 'Packed' },
];

function formatValidationErrors(body: Record<string, string[]> | null): string {
  if (!body) {
    return 'Please check your submission and try again.';
  }
  return Object.entries(body)
    .map(([field, messages]) => `${field}: ${messages.join(' ')}`)
    .join('\n');
}

export default function VenueDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const venueId = Number(id);
  const theme = useTheme();

  const [venue, setVenue] = useState<VenueDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadErrorMsg, setLoadErrorMsg] = useState<string | null>(null);

  const [selectedLiveliness, setSelectedLiveliness] = useState<LivelinessValue | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState(false);

  async function fetchVenue(options?: { silent?: boolean }) {
    if (!options?.silent) {
      setLoading(true);
    }
    try {
      const response = await fetch(`${API_BASE_URL}/venues/${venueId}/`);
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error ?? `API returned status ${response.status}`);
      }
      const data: VenueDetail = await response.json();
      setVenue(data);
      setLoadErrorMsg(null);
    } catch (error) {
      console.error('Failed to fetch venue:', error);
      if (!options?.silent) {
        setLoadErrorMsg(
          error instanceof Error
            ? error.message
            : 'Could not load this venue. Check that the backend server is running.'
        );
      }
    } finally {
      if (!options?.silent) {
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    fetchVenue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [venueId]);

  async function handleSubmit() {
    if (selectedLiveliness === null) {
      setSubmitError('Please select a liveliness level.');
      return;
    }

    setSubmitting(true);
    setSubmitError(null);
    setSubmitSuccess(false);

    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setSubmitError('Location permission denied. VibeCheck needs this to submit a report.');
        return;
      }

      const currentLocation = await Location.getCurrentPositionAsync({});
      const deviceId = await getDeviceId();

      const response = await fetch(`${API_BASE_URL}/venues/${venueId}/reports/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          liveliness: selectedLiveliness,
          device_id: deviceId,
          latitude: currentLocation.coords.latitude,
          longitude: currentLocation.coords.longitude,
        }),
      });

      if (response.status === 201) {
        setSubmitSuccess(true);
        setSelectedLiveliness(null);
        await fetchVenue({ silent: true });
        return;
      }

      if (response.status === 403 || response.status === 429) {
        const body = await response.json().catch(() => null);
        setSubmitError(body?.error ?? 'Could not submit report.');
        return;
      }

      if (response.status === 400) {
        const body = await response.json().catch(() => null);
        setSubmitError(formatValidationErrors(body));
        return;
      }

      setSubmitError(`Something went wrong (status ${response.status}). Please try again.`);
    } catch (error) {
      console.error('Failed to submit report:', error);
      setSubmitError('Could not submit report. Check that the backend server is running.');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <ThemedView style={styles.centered}>
        <ActivityIndicator size="large" />
        <ThemedText style={styles.centeredText}>Loading venue...</ThemedText>
      </ThemedView>
    );
  }

  if (loadErrorMsg || !venue) {
    return (
      <ThemedView style={styles.centered}>
        <ThemedText style={styles.centeredText}>{loadErrorMsg ?? 'Venue not found.'}</ThemedText>
      </ThemedView>
    );
  }

  const submitDisabled = submitting || selectedLiveliness === null;

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ title: venue.name }} />
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <ThemedText type="subtitle">{venue.name}</ThemedText>
        {/* ~32% of OSM venues (including the real Blue Cue) have no address
            tags at all -- an empty <Text> collapses but scrollContent's gap
            still applies, so this must render conditionally, not just as "". */}
        {venue.address ? (
          <ThemedText themeColor="textSecondary">{venue.address}</ThemedText>
        ) : null}
        <ThemedText themeColor="textSecondary" style={styles.category}>
          {venue.category}
        </ThemedText>
        {venue.osm_type && venue.osm_id !== null && (
          <Pressable
            onPress={() =>
              WebBrowser.openBrowserAsync(
                `https://www.openstreetmap.org/${venue.osm_type}/${venue.osm_id}`
              )
            }
            style={({ pressed }) => pressed && styles.pressed}>
            <ThemedText type="link">View on OpenStreetMap</ThemedText>
          </Pressable>
        )}

        {/* Same provider-backed state as the map card, so the two screens can
            never disagree about whether you said you were going. */}
        <GoingButton venueId={venueId} variant="full" />

        <View style={styles.section}>
          <ThemedText type="smallBold">Right now</ThemedText>
          {venue.current_status.liveliness === null ? (
            // The common case across ~40,000 venues. Deliberately renders no
            // stars: five empty outlines reads as "rated zero", which is a
            // different and much worse claim than "nobody has said yet".
            <ThemedText themeColor="textSecondary" style={styles.statusText}>
              No reports yet — be the first
            </ThemedText>
          ) : (
            <>
              <View style={styles.scoreRow}>
                <StarRating score={venue.current_status.liveliness} size={20} />
                <ThemedText style={[styles.statusText, { color: theme.accent }]}>
                  {venue.current_status.liveliness.toFixed(1)}
                </ThemedText>
              </View>
              <ThemedText style={styles.statusLabel}>
                {venue.current_status.liveliness_label}
              </ThemedText>
              {/* The window qualifier is required, not decorative: this is a
                  60-minute rolling mean shown as a star rating, and without it
                  it reads as a lifetime score like Yelp's. */}
              <ThemedText themeColor="textSecondary">
                {venue.current_status.report_count} report
                {venue.current_status.report_count === 1 ? '' : 's'} in the last hour
              </ThemedText>
            </>
          )}
        </View>

        <View style={styles.section}>
          <ThemedText type="smallBold">How busy is it?</ThemedText>
          <View style={styles.chipsRow}>
            {LIVELINESS_LEVELS.map((level) => {
              const isSelected = selectedLiveliness === level.value;
              return (
                <Pressable
                  key={level.value}
                  onPress={() => setSelectedLiveliness(level.value)}
                  style={({ pressed }) => pressed && styles.pressed}>
                  <ThemedView
                    type={isSelected ? 'backgroundSelected' : 'backgroundElement'}
                    style={styles.chip}>
                    <ThemedText type="smallBold" themeColor={isSelected ? 'text' : 'textSecondary'}>
                      {level.label}
                    </ThemedText>
                  </ThemedView>
                </Pressable>
              );
            })}
          </View>
        </View>

        <Pressable
          onPress={handleSubmit}
          disabled={submitDisabled}
          style={({ pressed }) => [pressed && styles.pressed, submitDisabled && styles.disabled]}>
          <ThemedView type="backgroundSelected" style={styles.submitButton}>
            <ThemedText type="smallBold">{submitting ? 'Submitting...' : 'Submit Report'}</ThemedText>
          </ThemedView>
        </Pressable>

        {submitSuccess && (
          <ThemedText style={styles.successText}>Report submitted — thanks!</ThemedText>
        )}
        {submitError && <ThemedText style={styles.errorText}>{submitError}</ThemedText>}
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.three,
  },
  centeredText: {
    marginTop: Spacing.two,
    textAlign: 'center',
  },
  scrollContent: {
    padding: Spacing.three,
    gap: Spacing.two,
  },
  category: {
    textTransform: 'capitalize',
  },
  section: {
    marginTop: Spacing.four,
    gap: Spacing.one,
  },
  statusText: {
    fontSize: 20,
  },
  statusLabel: {
    fontSize: 18,
  },
  scoreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
    marginTop: Spacing.one,
  },
  chip: {
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.three,
  },
  pressed: {
    opacity: 0.7,
  },
  disabled: {
    opacity: 0.5,
  },
  submitButton: {
    marginTop: Spacing.four,
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three,
    alignItems: 'center',
  },
  successText: {
    marginTop: Spacing.three,
    textAlign: 'center',
  },
  errorText: {
    marginTop: Spacing.three,
    textAlign: 'center',
    color: '#D9534F',
  },
});
