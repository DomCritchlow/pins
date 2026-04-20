// Google Places API (New) — direct browser calls, CORS-enabled, API-key-authed.
// Restrict the API key to your HTTP referrer + "Places API (New)" only.
//
// Photos: we store the photo resource name (e.g. "places/XXX/photos/YYY") in the
// `photo_reference` column. The URL is built on demand so nothing is stored by the app;
// the browser handles HTTP caching.
(function () {
  const KEY = () => window.CONFIG.API_KEY;
  const BASE = 'https://places.googleapis.com/v1';

  let sessionToken = null;
  function newSessionToken() {
    sessionToken =
      (crypto && crypto.randomUUID) ? crypto.randomUUID() : (U.uuid() + U.uuid() + U.uuid());
    return sessionToken;
  }

  async function autocomplete(input, near) {
    if (!input || input.length < 2) return [];
    if (!sessionToken) newSessionToken();
    const body = { input, sessionToken };
    if (near && near.lat != null) {
      body.locationBias = {
        circle: {
          center: { latitude: near.lat, longitude: near.lng },
          radius: 50000,
        },
      };
    }
    const res = await fetch(`${BASE}/places:autocomplete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': KEY(),
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.suggestions || [])
      .filter((s) => s.placePrediction)
      .map((s) => {
        const pp = s.placePrediction;
        return {
          place_id: pp.placeId,
          primary: pp.structuredFormat?.mainText?.text || pp.text?.text || '',
          secondary: pp.structuredFormat?.secondaryText?.text || '',
        };
      });
  }

  function pickComponent(components, type) {
    const c = (components || []).find((c) => c.types && c.types.includes(type));
    return c ? c.longText : '';
  }

  // Places API (New) returns priceLevel as an enum — map back to a 1–4 integer for the sheet.
  const PRICE_ENUM = {
    PRICE_LEVEL_FREE: 0,
    PRICE_LEVEL_INEXPENSIVE: 1,
    PRICE_LEVEL_MODERATE: 2,
    PRICE_LEVEL_EXPENSIVE: 3,
    PRICE_LEVEL_VERY_EXPENSIVE: 4,
  };

  async function details(place_id) {
    const token = sessionToken || newSessionToken();
    const fieldMask = [
      'id',
      'displayName',
      'formattedAddress',
      'location',
      'addressComponents',
      'priceLevel',
      'photos',
    ].join(',');
    const url = `${BASE}/places/${encodeURIComponent(place_id)}?sessionToken=${encodeURIComponent(token)}`;
    sessionToken = null; // close the billing session after details
    const res = await fetch(url, {
      headers: {
        'X-Goog-Api-Key': KEY(),
        'X-Goog-FieldMask': fieldMask,
      },
    });
    if (!res.ok) throw new Error(`places details ${res.status}`);
    const r = await res.json();
    const comps = r.addressComponents || [];
    const neighborhood =
      pickComponent(comps, 'neighborhood') ||
      pickComponent(comps, 'sublocality_level_1') ||
      pickComponent(comps, 'sublocality') || '';
    const city =
      pickComponent(comps, 'locality') ||
      pickComponent(comps, 'postal_town') ||
      pickComponent(comps, 'administrative_area_level_2') || '';
    const state = pickComponent(comps, 'administrative_area_level_1');
    const country = pickComponent(comps, 'country');
    const firstPhoto = r.photos && r.photos[0];
    return {
      name: r.displayName?.text || '',
      address: r.formattedAddress || '',
      lat: r.location?.latitude ?? null,
      lng: r.location?.longitude ?? null,
      city,
      state,
      country,
      neighborhood,
      place_id: r.id || place_id,
      photo_reference: firstPhoto ? firstPhoto.name : '', // e.g. "places/XXX/photos/YYY"
      price_tier: r.priceLevel != null ? (PRICE_ENUM[r.priceLevel] ?? null) : null,
    };
  }

  // Build a fresh photo URL from the stored resource name. Never cached by the app.
  function photoUrl(photo_reference, maxWidth = 800) {
    if (!photo_reference) return '';
    return `${BASE}/${photo_reference}/media?maxWidthPx=${maxWidth}&key=${encodeURIComponent(KEY())}`;
  }

  // ---------------------------------------------------------------------------
  // Nearby search — used by the "I'm Here" FAB on the map.
  //
  // Cost: ~$0.032 per call (Places New API, Basic Data SKU).
  // Triggered only by explicit user action (FAB tap), never passively.
  //
  // The response includes all fields needed to fill the add-form directly,
  // so selecting a result skips the separate details() call (~$0.017 saved).
  //
  // Cache: same spot (< 100 m moved) within 3 minutes → free repeat taps.
  // ---------------------------------------------------------------------------
  let _nearbyCache = null;
  const NEARBY_TTL_MS = 3 * 60 * 1000;
  const NEARBY_CACHE_RADIUS_M = 100;

  async function nearbySearch(location) {
    if (_nearbyCache) {
      const age = Date.now() - _nearbyCache.ts;
      // U.distanceMeters expects objects with .lat/.lng
      const moved = (window.U && U.distanceMeters)
        ? U.distanceMeters(location, _nearbyCache)
        : Infinity;
      if (age < NEARBY_TTL_MS && moved < NEARBY_CACHE_RADIUS_M) {
        return _nearbyCache.results;
      }
    }

    const res = await fetch(`${BASE}/places:searchNearby`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': KEY(),
        // Request only the fields that fill the form — keeps the SKU at Basic Data.
        'X-Goog-FieldMask': [
          'places.id',
          'places.displayName',
          'places.formattedAddress',
          'places.location',
          'places.addressComponents',
          'places.photos',
          'places.priceLevel',
        ].join(','),
      },
      body: JSON.stringify({
        locationRestriction: {
          circle: {
            center: { latitude: location.lat, longitude: location.lng },
            radius: 200, // metres — tight enough to mean "I'm here"
          },
        },
        maxResultCount: 6,
        rankPreference: 'DISTANCE',
      }),
    });

    if (!res.ok) return [];
    const data = await res.json();

    const results = (data.places || []).map((r) => {
      const comps = r.addressComponents || [];
      return {
        name: r.displayName?.text || '',
        address: r.formattedAddress || '',
        lat: r.location?.latitude ?? null,
        lng: r.location?.longitude ?? null,
        city:
          pickComponent(comps, 'locality') ||
          pickComponent(comps, 'postal_town') ||
          pickComponent(comps, 'administrative_area_level_2') || '',
        state: pickComponent(comps, 'administrative_area_level_1') || '',
        country: pickComponent(comps, 'country') || '',
        neighborhood:
          pickComponent(comps, 'neighborhood') ||
          pickComponent(comps, 'sublocality_level_1') ||
          pickComponent(comps, 'sublocality') || '',
        place_id: r.id || '',
        photo_reference: r.photos?.[0]?.name || '',
        price_tier: r.priceLevel != null ? (PRICE_ENUM[r.priceLevel] ?? null) : null,
      };
    });

    _nearbyCache = { lat: location.lat, lng: location.lng, ts: Date.now(), results };
    return results;
  }

  window.Places = { autocomplete, details, photoUrl, newSessionToken, nearbySearch };
})();
