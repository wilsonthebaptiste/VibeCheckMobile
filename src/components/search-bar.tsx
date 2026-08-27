import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import { StarRating } from '@/components/star-rating';
import { ThemedText } from '@/components/themed-text';
import { API_BASE_URL } from '@/constants/api';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { isAbortError } from '@/utils/fetch';
import type { SearchResponse, SearchResult } from '@/types/venue';

type Props = {
  /** Used to rank nearby venues above distant ones with the same name. */
  origin: { latitude: number; longitude: number } | null;
  onSelect: (result: SearchResult) => void;
};

// Typeahead hits our own DB, which holds every US venue, so this can be short.
const DEBOUNCE_MS = 250;
const MIN_QUERY_LENGTH = 2;

export function SearchBar({ origin, onSelect }: Props) {
  const theme = useTheme();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [searchedPlaces, setSearchedPlaces] = useState(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  async function runSearch(text: string, includePlaces: boolean) {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const params = new URLSearchParams({ q: text });
    if (origin) {
      params.set('lat', String(origin.latitude));
      params.set('lng', String(origin.longitude));
    }
    // Only ever set on submit. Nominatim's usage policy explicitly forbids
    // firing a geocoder per keystroke, so the typeahead path must not set it.
    if (includePlaces) {
      params.set('geocode', 'true');
    }

    setLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/venues/search/?${params}`, {
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`API returned status ${response.status}`);
      }
      const data: SearchResponse = await response.json();
      setResults(data.results);
      setSearchedPlaces(includePlaces);
      setOpen(true);
    } catch (error) {
      if (isAbortError(error)) {
        return;
      }
      console.error('Search failed:', error);
      setResults([]);
    } finally {
      if (abortRef.current === controller) {
        setLoading(false);
      }
    }
  }

  function handleChange(text: string) {
    setQuery(text);
    setSearchedPlaces(false);

    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    if (text.trim().length < MIN_QUERY_LENGTH) {
      abortRef.current?.abort();
      setResults([]);
      setOpen(false);
      setLoading(false);
      return;
    }
    debounceRef.current = setTimeout(() => runSearch(text.trim(), false), DEBOUNCE_MS);
  }

  function handleSubmit() {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    const text = query.trim();
    if (text.length >= MIN_QUERY_LENGTH) {
      runSearch(text, true);
    }
  }

  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
      abortRef.current?.abort();
    };
  }, []);

  function handleSelect(result: SearchResult) {
    setOpen(false);
    setQuery(result.name);
    onSelect(result);
  }

  return (
    <View style={styles.wrapper}>
      <View style={[styles.field, { backgroundColor: theme.background }]}>
        <ThemedText themeColor="textSecondary" style={styles.icon}>
          ⌕
        </ThemedText>
        <TextInput
          value={query}
          onChangeText={handleChange}
          onSubmitEditing={handleSubmit}
          onFocus={() => results.length > 0 && setOpen(true)}
          placeholder="Search bars, clubs, or a city"
          placeholderTextColor={theme.textSecondary}
          returnKeyType="search"
          autoCorrect={false}
          // Explicit colour: an unstyled TextInput inherits an OS default that
          // is black on a black surface in dark mode.
          style={[styles.input, { color: theme.text }]}
        />
        {loading ? <ActivityIndicator size="small" /> : null}
        {query.length > 0 && !loading ? (
          <Pressable
            onPress={() => {
              setQuery('');
              setResults([]);
              setOpen(false);
            }}
            hitSlop={12}
            accessibilityLabel="Clear search">
            <ThemedText themeColor="textSecondary">✕</ThemedText>
          </Pressable>
        ) : null}
      </View>

      {open && (results.length > 0 || !loading) ? (
        <View style={[styles.results, { backgroundColor: theme.background }]}>
          <FlatList
            data={results}
            // Without this the first tap on a row only dismisses the keyboard
            // and the row's own onPress never fires.
            keyboardShouldPersistTaps="handled"
            keyExtractor={(item) =>
              item.type === 'venue' ? `v${item.id}` : `p${item.name}${item.latitude}`
            }
            ListEmptyComponent={
              <View style={styles.row}>
                <ThemedText type="small" themeColor="textSecondary">
                  {searchedPlaces
                    ? 'Nothing found.'
                    : 'No venues by that name. Press search to look for a place.'}
                </ThemedText>
              </View>
            }
            renderItem={({ item }) => (
              <Pressable
                onPress={() => handleSelect(item)}
                style={({ pressed }) => [
                  styles.row,
                  pressed && { backgroundColor: theme.backgroundSelected },
                ]}>
                <View style={styles.rowBody}>
                  <ThemedText type="small" numberOfLines={1} style={styles.rowTitle}>
                    {item.type === 'venue' ? item.name : item.name.split(',')[0]}
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                    {item.type === 'venue'
                      ? item.address || item.category
                      : item.name.split(',').slice(1).join(',').trim()}
                  </ThemedText>
                </View>
                {item.type === 'venue' && item.current_status.liveliness !== null ? (
                  <StarRating score={item.current_status.liveliness} size={13} />
                ) : null}
              </Pressable>
            )}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    // Positioning is the map screen's job -- it owns the safe-area insets and
    // the stacking order against the card. This only owns its own margins.
    marginHorizontal: Spacing.three,
  },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: 12,
    paddingHorizontal: Spacing.three,
    height: 46,
    shadowColor: '#000000',
    shadowOpacity: 0.15,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  icon: {
    fontSize: 20,
  },
  input: {
    flex: 1,
    fontSize: 16,
    // Height rather than padding: on Android a bare TextInput reserves extra
    // vertical space for its underline and ends up taller than the row.
    height: '100%',
  },
  results: {
    marginTop: Spacing.two,
    borderRadius: 12,
    maxHeight: 280,
    overflow: 'hidden',
    shadowColor: '#000000',
    shadowOpacity: 0.15,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.two + 2,
    paddingHorizontal: Spacing.three,
  },
  rowBody: {
    flex: 1,
  },
  rowTitle: {
    fontWeight: '600',
  },
});
