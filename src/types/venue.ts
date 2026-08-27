/**
 * The shapes the venues API returns.
 *
 * `LivelinessStatus` is deliberately identical across every endpoint that
 * reports a score -- `/in-bounds/`, `/search/` and `/venues/<id>/` all embed
 * the same `current_status` object, produced by one helper on the backend
 * (venues/scoring.py). That is what lets the same `<StarRating>` render a map
 * card, a search row and the detail screen without per-screen conversion.
 */

export type LivelinessStatus = {
  /**
   * Mean of every report in the last hour, to one decimal, or null when there
   * are none. Null is the COMMON case, not an error: there are ~40,000 venues
   * and far fewer reports, so most pins have no score. Callers must render an
   * explicit empty state rather than treating null as zero.
   */
  liveliness: number | null;
  liveliness_label: string;
  report_count: number;
};

export type Venue = {
  id: number;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  category: string;
  osm_type: string | null;
  osm_id: number | null;
  current_status: LivelinessStatus;
};

/** One aggregated cluster returned when the map is zoomed out. */
export type VenueBin = {
  /** The centroid of the venues in the cell -- not the grid cell's centre. */
  latitude: number;
  longitude: number;
  venue_count: number;
  current_status: LivelinessStatus;
};

export type Bounds = {
  min_lat: number;
  min_lng: number;
  max_lat: number;
  max_lng: number;
};

export type InBoundsResponse = {
  /** Which representation the SERVER chose. The client never decides this. */
  mode: 'venues' | 'bins';
  bin_deg: number | null;
  /**
   * The zoom interval over which this answer stays correct. The client
   * refetches when the viewport's latitude span leaves it, so the mode and
   * bin-size thresholds live only on the server. `valid_span_max` is null at
   * the coarsest bin size, meaning "no upper bound".
   */
  valid_span_min: number;
  valid_span_max: number | null;
  /** Slightly larger than what was requested, so small pans need no refetch. */
  served_bounds: Bounds;
  count: number;
  venues: Venue[];
  bins: VenueBin[];
};

/**
 * The device's standing "I'm going here" declaration.
 *
 * The last three fields are RULES the server owns and hands over, exactly like
 * `valid_span_*` on `InBoundsResponse`. The client evaluates arrival against
 * `proximity_threshold_miles` on each GPS tick rather than round-tripping, and
 * schedules the dwell prompt `dwell_minutes` after arriving -- so retuning
 * either (or dropping dwell to 2 minutes for a device test) needs no new build.
 * Never hardcode them here.
 */
export type VisitIntent = {
  venue: Venue;
  declared_at: string;
  /** Null until the server has confirmed the device is within range. */
  arrived_at: string | null;
  expires_at: string;
  proximity_threshold_miles: number;
  dwell_minutes: number;
  nudge_minutes: number;
};

export type VisitIntentResponse = {
  /** Null is the normal resting state: most of the time nobody is going out. */
  intent: VisitIntent | null;
};

/** `GET /api/venues/here/` -- the venue you are standing in, or none. */
export type VenueHereResponse = {
  venue: (Venue & { distance_miles: number }) | null;
};

export type VenueSearchResult = Venue & { type: 'venue' };

export type PlaceSearchResult = Bounds & {
  type: 'place';
  name: string;
  latitude: number;
  longitude: number;
};

export type SearchResult = VenueSearchResult | PlaceSearchResult;

export type SearchResponse = {
  query: string;
  results: SearchResult[];
};
