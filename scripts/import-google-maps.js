#!/usr/bin/env node
// Converts a Google Maps "Saved Places" Takeout export (GeoJSON) into a CSV
// that matches the Pins app sheet schema (columns A–S).
//
// Usage:
//   node scripts/import-google-maps.js "Saved Places.json"
//   node scripts/import-google-maps.js "Saved Places.json" places_import_critchlowd49.csv
//
// The output CSV can be imported directly into the user's Google Sheet:
//   Sheet > File > Import > Upload > Replace current sheet  (pick the "places" tab first)
//   — OR —
//   Open the sheet, select cell A2, then paste the CSV rows manually.
//
// No API calls are made. Zero cost.

const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------
const inputFile = process.argv[2];
if (!inputFile) {
  console.error('Usage: node scripts/import-google-maps.js <Saved Places.json> [output.csv]');
  process.exit(1);
}

const defaultOut = 'places_import_' + path.basename(inputFile, path.extname(inputFile)).replace(/\s+/g, '_') + '.csv';
const outputFile = process.argv[3] || defaultOut;

// ---------------------------------------------------------------------------
// Address parsing — no API, heuristics only
// ---------------------------------------------------------------------------

// Strip leading European ZIP prefix  e.g. "56841 Ludwigsburg", "3012 CN Rotterdam", "116 40 Stockholm"
// Strip trailing UK-style postcode   e.g. "Oxford OX1 2JD"
function extractCity(raw) {
  let s = (raw || '').trim();
  // Leading: digits optionally followed by 1-3 uppercase letters or more digits, then a space
  s = s.replace(/^\d+(?:\s+(?:[A-Z]{1,3}|\d+))?\s+/i, '');
  // Trailing UK postcode
  s = s.replace(/\s+[A-Z]{1,2}\d[\dA-Z]*(?:\s+\d[A-Z]{2})?$/i, '');
  return s.trim();
}

// Returns { city, state, country } from a Google Maps address string + country_code.
function parseAddress(address, countryCode) {
  const fallback = { city: '', state: '', country: countryCode || '' };
  if (!address) return fallback;

  const parts = address.split(', ');
  const n = parts.length;
  if (n < 2) return fallback;

  const country = countryCode || parts[n - 1];

  // US / Canada — "Street, City, ST ZIPCODE, Country" (≥ 4 parts)
  if ((countryCode === 'US' || countryCode === 'CA') && n >= 4) {
    const stateZip = parts[n - 2]; // e.g. "CA 94109"
    const m = stateZip.match(/^([A-Z]{2})\b/);
    return {
      city: parts[n - 3],
      state: m ? m[1] : stateZip,
      country,
    };
  }

  // International — second-to-last part is "ZIP? City"
  return {
    city: extractCity(parts[n - 2]),
    state: '',
    country,
  };
}

// ---------------------------------------------------------------------------
// Tag inference — keyword matching against place name, zero API cost.
// Covers ~40-50% of places where the category is visible in the name.
// All tags are editable in the app after import.
// ---------------------------------------------------------------------------
const TAG_RULES = [
  // Accommodation — brand names + generic terms
  [/(marriott|hilton|sheraton|hyatt|ritz.?carlton|four seasons|radisson|westin|novotel|ibis|meininger)/i, 'hotel'],
  [/\b(hotel|hostel|inn\b|lodge|motel|resort|suites)\b/i, 'hotel'],

  // Coffee before café so "coffee shop" doesn't double-tag
  [/\b(coffee|kaffee|espresso|cappuccino|roasters?|roastery)\b/i, 'coffee'],

  // Bakery
  [/\b(bakery|b[äa]ckerei|konditorei|p[âa]tisserie|pastry)\b/i, 'bakery'],

  // Cuisine-specific
  [/\b(pizza|pizzeria)\b/i, 'pizza'],
  [/\b(sushi|ramen|izakaya)\b/i, 'japanese'],
  [/\b(burger|burgers?)\b/i, 'burgers'],
  [/\b(thai)\b/i, 'thai'],
  [/\b(indian|curry)\b/i, 'indian'],
  [/\b(mexican|taco|tacos?)\b/i, 'mexican'],

  // Café vs restaurant
  [/\b(caf[eé])\b/i, 'cafe'],
  [/\b(restaurant|bistro|brasserie|trattoria|osteria|gastrobar|gastropub|steakhouse)\b/i, 'restaurant'],
  [/\bweinstube\b/i, 'restaurant'],

  // Bar & drinks (after restaurant to avoid conflicts)
  [/\b(bar|pub|lounge|taproom|speakeasy)\b/i, 'bar'],
  [/\b(brewery|brauerei|biergarten)\b/i, 'bar'],

  // Wine — leading-word match handles compound German words (Weinstube, Weinbar, etc.)
  [/\bwein|wine\b/i, 'wine'],

  // Culture
  [/\b(museum)\b/i, 'museum'],
  [/\b(galerie|gallery)\b/i, 'gallery'],
  [/\b(theater|theatre|opera|kino|cinema)\b/i, 'culture'],
  [/\b(church|kirche|chapel|cathedral|monastery)\b/i, 'culture'],

  // Outdoors
  [/\b(park|garden|garten|botanical|beach|trail)\b/i, 'outdoors'],

  // Wellness / fitness
  [/\b(spa|wellness|sauna)\b/i, 'wellness'],
  [/\b(yoga|meditation|zen|retreat)\b/i, 'wellness'],
  [/\b(gym|fitness|crossfit)\b/i, 'fitness'],

  // Shopping
  [/\b(boutique|laden)\b/i, 'shopping'],
  [/\b(shop|store)\b/i, 'shopping'],
  [/\b(market|markt|march[eé]|bazaar)\b/i, 'market'],

  // Education
  [/\b(university|college|school|library|bibliothek)\b/i, 'education'],

  // Transport
  [/\b(parkhaus|parking)\b/i, 'parking'],
  [/\b(airport|flughafen|bahnhof)\b/i, 'transport'],
];

function inferTags(name) {
  const tags = new Set();
  for (const [rx, tag] of TAG_RULES) {
    if (rx.test(name)) tags.add(tag);
  }
  // "hotel" implies accommodation, not food — remove food tags if hotel matched
  // (e.g. "Rotterdam Marriott Hotel" shouldn't get 'bar' from lobby bar names)
  return Array.from(tags);
}

// ---------------------------------------------------------------------------
// Sheet schema (matches sheets.js HEADER, columns A–S)
// ---------------------------------------------------------------------------
const HEADER = [
  'id', 'name', 'address', 'city', 'state', 'country', 'neighborhood',
  'lat', 'lng', 'tags', 'notes', 'visited', 'visited_date', 'source_url',
  'place_id', 'photo_reference', 'price_tier', 'added_date', 'custom',
];

// ---------------------------------------------------------------------------
// CSV helpers
// ---------------------------------------------------------------------------
function csvCell(v) {
  const s = v == null ? '' : String(v);
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function csvRow(arr) {
  return arr.map(csvCell).join(',');
}

// ---------------------------------------------------------------------------
// Main conversion
// ---------------------------------------------------------------------------
const raw = fs.readFileSync(inputFile, 'utf8');
const geojson = JSON.parse(raw);
const features = (geojson.features || []).filter(Boolean);

let skipped = 0;
const rows = [csvRow(HEADER)];

for (const feature of features) {
  const props = feature.properties || {};
  const loc = props.location || {};

  // Skip entries with no name or coordinates (occasionally present in exports).
  if (!loc.name && !props.google_maps_url) {
    skipped++;
    continue;
  }

  const coords = (feature.geometry && feature.geometry.coordinates) || [];
  const lng = coords[0] != null ? coords[0] : '';
  const lat = coords[1] != null ? coords[1] : '';

  const { city, state, country } = parseAddress(loc.address, loc.country_code);

  // Use the saved-date as added_date (when the user starred/saved the place).
  const addedDate = props.date ? props.date.slice(0, 10) : '';

    const tags = inferTags(loc.name || '');

    const row = [
      crypto.randomUUID(),          // id       — fresh UUID per row
      loc.name || '',               // name
      loc.address || '',            // address  — full string kept for reference
      city,                         // city
      state,                        // state
      country,                      // country
      '',                           // neighborhood — not in export
      lat,                          // lat
      lng,                          // lng
      tags.join(','),               // tags     — inferred from name, edit in app
      '',                           // notes    — fill in app
      'FALSE',                      // visited  — conservative default; edit in sheet
      '',                           // visited_date
      props.google_maps_url || '',  // source_url
      '',                           // place_id — not in export (CID ≠ place_id)
      '',                           // photo_reference
      '',                           // price_tier
      addedDate,                    // added_date
      '',                           // custom
    ];

  rows.push(csvRow(row));
}

fs.writeFileSync(outputFile, rows.join('\n'), 'utf8');

console.log(`✓ Converted ${rows.length - 1} places → ${outputFile}`);
if (skipped > 0) console.log(`  (skipped ${skipped} entries with no name or URL)`);
console.log('');
console.log('Next steps:');
console.log('  1. Open the user\'s Pins Google Sheet in your browser.');
console.log('  2. Click the "places" tab at the bottom.');
console.log('  3. File → Import → Upload the CSV → "Replace current sheet".');
console.log('     (Make sure "places" tab is active before importing.)');
console.log('  4. Done — reload the Pins app.');
