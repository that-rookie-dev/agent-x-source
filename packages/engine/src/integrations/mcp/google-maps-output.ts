function placeIdMapUrl(placeId: string): string {
  return `https://www.google.com/maps/search/?api=1&query_place_id=${encodeURIComponent(placeId)}`;
}

function coordMapUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}

function addressMapUrl(address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

function directionsMapUrl(origin: string, destination: string, mode?: string): string {
  const params = new URLSearchParams({ api: '1', origin, destination });
  if (mode) params.set('travelmode', mode);
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

type LatLng = { lat?: number; lng?: number; latitude?: number; longitude?: number };

function readCoords(location: LatLng | undefined): { lat: number; lng: number } | null {
  if (!location) return null;
  const lat = location.lat ?? location.latitude;
  const lng = location.lng ?? location.longitude;
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;
  return { lat, lng };
}

function mapLinkForPlace(place: {
  place_id?: string;
  formatted_address?: string;
  location?: LatLng;
}): string {
  if (place.place_id) return placeIdMapUrl(place.place_id);
  const coords = readCoords(place.location);
  if (coords) return coordMapUrl(coords.lat, coords.lng);
  if (place.formatted_address) return addressMapUrl(place.formatted_address);
  return '';
}

function formatPlaceSearch(data: { places?: Array<Record<string, unknown>> }): string {
  const places = data.places ?? [];
  if (places.length === 0) return 'No places found.';

  const blocks = places.map((raw, index) => {
    const place = raw as {
      name?: string;
      formatted_address?: string;
      location?: LatLng;
      place_id?: string;
      rating?: number;
      types?: string[];
    };
    const link = mapLinkForPlace(place);
    const lines = [
      `### ${index + 1}. ${place.name ?? 'Unknown place'}`,
      place.rating != null ? `- **Rating:** ${place.rating}` : null,
      place.formatted_address ? `- **Address:** ${place.formatted_address}` : null,
      link ? `- **Google Maps:** [Open in Google Maps](${link})` : null,
      place.place_id ? `- **Place ID:** ${place.place_id}` : null,
    ].filter(Boolean);
    return lines.join('\n');
  });

  return [
    `Found ${places.length} place(s):`,
    '',
    blocks.join('\n\n'),
    '',
    'Present these results to the user using the Google Maps links above. Do not show raw latitude/longitude coordinates.',
  ].join('\n');
}

function formatPlaceDetails(data: Record<string, unknown>): string {
  const name = typeof data.name === 'string' ? data.name : 'Place details';
  const link = mapLinkForPlace({
    place_id: typeof data.place_id === 'string' ? data.place_id : undefined,
    formatted_address: typeof data.formatted_address === 'string' ? data.formatted_address : undefined,
    location: data.location as LatLng | undefined,
  });
  const lines = [
    `## ${name}`,
    data.rating != null ? `- **Rating:** ${data.rating}` : null,
    data.formatted_address ? `- **Address:** ${data.formatted_address}` : null,
    data.formatted_phone_number ? `- **Phone:** ${data.formatted_phone_number}` : null,
    data.website ? `- **Website:** ${data.website}` : null,
    link ? `- **Google Maps:** [Open in Google Maps](${link})` : null,
  ].filter(Boolean);
  return [...lines, '', 'Use the Google Maps link in your reply; do not show raw coordinates.'].join('\n');
}

function formatGeocode(data: Record<string, unknown>): string {
  const address = typeof data.formatted_address === 'string' ? data.formatted_address : '';
  const placeId = typeof data.place_id === 'string' ? data.place_id : undefined;
  const link = placeId
    ? placeIdMapUrl(placeId)
    : address
      ? addressMapUrl(address)
      : (() => {
          const coords = readCoords(data.location as LatLng | undefined);
          return coords ? coordMapUrl(coords.lat, coords.lng) : '';
        })();
  const lines = [
    address ? `- **Address:** ${address}` : null,
    link ? `- **Google Maps:** [Open in Google Maps](${link})` : null,
    placeId ? `- **Place ID:** ${placeId}` : null,
  ].filter(Boolean);
  return [...lines, '', 'Use the Google Maps link in your reply; do not show raw coordinates.'].join('\n');
}

function formatDirections(data: { routes?: Array<{ summary?: string; distance?: { text?: string }; duration?: { text?: string } }> }): string {
  const route = data.routes?.[0];
  if (!route) return 'No routes found.';
  const lines = [
    route.summary ? `- **Route:** ${route.summary}` : null,
    route.distance?.text ? `- **Distance:** ${route.distance.text}` : null,
    route.duration?.text ? `- **Duration:** ${route.duration.text}` : null,
  ].filter(Boolean);
  return lines.join('\n');
}

/** Rewrite raw Google Maps MCP JSON into user-friendly markdown with map links. */
export function enhanceGoogleMapsToolOutput(toolName: string, output: string): string {
  let data: unknown;
  try {
    data = JSON.parse(output);
  } catch {
    return output;
  }
  if (!data || typeof data !== 'object') return output;

  const record = data as Record<string, unknown>;
  switch (toolName) {
    case 'maps_search_places':
      return formatPlaceSearch(record as { places?: Array<Record<string, unknown>> });
    case 'maps_place_details':
      return formatPlaceDetails(record);
    case 'maps_geocode':
    case 'maps_reverse_geocode':
      return formatGeocode(record);
    case 'maps_directions':
      return formatDirections(record as { routes?: Array<{ summary?: string; distance?: { text?: string }; duration?: { text?: string } }> });
    default:
      return output;
  }
}

export { placeIdMapUrl, coordMapUrl, addressMapUrl, directionsMapUrl };
