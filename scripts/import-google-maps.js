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
// Tag inference — keyword rules + known-name lookup, zero API cost.
// All tags are editable in the app after import.
// ---------------------------------------------------------------------------

// Regex rules — fire on any place whose name contains the pattern.
const TAG_RULES = [
  // Accommodation — brand names + generic terms
  [/(marriott|hilton|sheraton|hyatt|ritz.?carlton|four seasons|radisson|westin|novotel|ibis|meininger|wyndham|doubletree|hampton inn|holiday inn|best western|locke\b)/i, 'hotel'],
  [/\b(hotel|hostel|inn\b|lodge|motel|resort|suites)\b/i, 'hotel'],

  // Coffee — no trailing \b so "coffeehouse" still matches
  [/coffee|kaffee|espresso|cappuccino|roasters?|roastery/i, 'coffee'],

  // Bakery
  [/\b(bakery|b[äa]ckerei|konditorei|p[âa]tisserie|pastry|boulangerie|croissant)\b/i, 'bakery'],

  // Cuisine-specific
  [/\b(pizza|pizzeria|pinsa)\b/i, 'pizza'],
  [/\b(sushi|ramen|izakaya)\b/i, 'japanese'],
  [/burger/i, 'burgers'],
  [/\b(thai)\b/i, 'thai'],
  [/\b(indian|curry)\b/i, 'indian'],
  [/\b(mexican|taco|tacos?)\b/i, 'mexican'],
  [/\b(korean)\b/i, 'korean'],
  [/\b(vietnamese|viet\b)\b/i, 'vietnamese'],
  [/\b(dumpling|dim.?sum)\b/i, 'restaurant'],

  // Café vs restaurant
  [/\b(caf[eé])\b/i, 'cafe'],
  [/creamery|gelato/i, 'cafe'],
  [/\bbagel\b/i, 'cafe'],
  [/\b(restaurant|bistro|brasserie|trattoria|osteria|gastrobar|gastropub|steakhouse)\b/i, 'restaurant'],
  [/\b(wirtshaus|weinstube|speisekammer)\b/i, 'restaurant'],
  [/veg[ai]n\b/i, 'restaurant'],

  // Bar & drinks
  [/\b(bar|pub|lounge|taproom|speakeasy|schankstelle)\b/i, 'bar'],
  [/\b(brewery|brauerei|biergarten)\b/i, 'bar'],
  [/beer.?garden/i, 'bar'],
  [/craft.?beer/i, 'bar'],

  // Wine — leading-word match handles German compounds (Weinstube, Weinbar, etc.)
  [/\bwein|wine|winecellar|vineyard|winery|weingut/i, 'wine'],

  // Culture & entertainment
  [/\b(museum)\b/i, 'museum'],
  [/\b(galerie|gallery)\b/i, 'gallery'],
  [/\b(theater|theatre|opera|kino|cinema)\b/i, 'culture'],
  [/\b(church|kirche|chapel|cathedral|dom\b|monastery)\b/i, 'culture'],
  [/\b(castle|burg\b|palace|schloss)\b/i, 'culture'],
  [/football.?club|soccer.?club/i, 'culture'],
  [/comedy.?(club|cellar)/i, 'culture'],
  [/convention.?center|messe\b/i, 'culture'],

  // Outdoors
  [/\b(park|garden|garten|botanical|beach|trail|dunes?|preserve|lake|see\b)\b/i, 'outdoors'],

  // Wellness / fitness
  [/\b(spa|wellness|sauna)\b/i, 'wellness'],
  [/\b(yoga|meditation|zen|retreat)\b/i, 'wellness'],
  [/wohlfühlbad|solebad|thermalbad|freibad/i, 'wellness'],
  [/\b(gym|fitness|crossfit|turnhalle)\b/i, 'fitness'],

  // Shopping
  [/\b(boutique|laden|orthopadie|orthop[äa]die)\b/i, 'shopping'],
  [/\b(shop|store)\b/i, 'shopping'],
  [/\b(markthalle)\b/i, 'market'],
  [/\b(market|markt|march[eé]|bazaar|halles?)\b/i, 'market'],

  // Medical
  [/klinikum|krankenhaus|notaufnahme|urgent.?care/i, 'medical'],

  // Education
  [/\b(university|college|school|library|bibliothek|laboratory|campus)\b/i, 'education'],

  // Transport
  [/\b(parkhaus|parking)\b/i, 'parking'],
  [/\b(airport|flughafen|bahnhof)\b/i, 'transport'],
];

// Known-name lookup — for well-known places where the category isn't in the name.
// Keys are lowercased exact place names. Tags here take precedence and also
// merge with any TAG_RULES matches.
const KNOWN_NAMES = {
  // ── Food & restaurants ─────────────────────────────────────────────────────
  'blue barn polk':                          ['restaurant'],
  'meatballs for the people':                ['restaurant'],
  'aifur':                                   ['restaurant', 'bar'],
  'thang long':                              ['restaurant', 'vietnamese'],
  'vietal kitchen stuttgart':                ['restaurant', 'vietnamese'],
  'zama':                                    ['restaurant'],
  'gans woanders':                           ['restaurant', 'bar'],
  'das winkelwerk':                          ['cafe', 'restaurant'],
  'panino mondiale - specialità lampredotto':['restaurant'],
  'chez paul':                               ['restaurant'],
  'quai ouest':                              ['restaurant'],
  'cavallino spaghettaro':                   ['restaurant'],
  '60 seconds to napoli | hamburg':          ['restaurant'],
  'the coach house kitchen':                 ['restaurant'],
  'pinsa manufaktur stuttgart':              ['restaurant'],
  'loy vegan':                               ['restaurant'],
  'season marais':                           ['restaurant'],
  'désolée papa':                            ['restaurant'],
  'au petit gourmet':                        ['restaurant'],
  'falscher hase':                           ['restaurant'],
  'speisekammer west':                       ['restaurant'],
  'wirtshaus waldquelle':                    ['restaurant'],
  "s'wirtshaus am see friedrichshafen":      ['restaurant'],
  'seegut zeppelin':                         ['restaurant'],
  'soban - korean dining':                   ['restaurant', 'korean'],
  'frankfurter wirtshaus':                   ['restaurant'],
  'your dumplings 豆浆和生煎':               ['restaurant', 'chinese'],
  'vegi stuttgart':                          ['restaurant'],
  'bond 45 ny':                              ['restaurant'],
  "ellen's stardust diner":                  ['restaurant'],
  'charlie bird':                            ['restaurant'],
  'the barn at 678':                         ['restaurant'],
  'bungalow 7':                              ['restaurant', 'bar'],
  'while we were young kitchen & cocktails': ['restaurant', 'bar'],
  'der daddy - always a pleasure':           ['restaurant', 'bar'],
  'alte wache':                              ['bar', 'restaurant'],
  'sportcafé carambolage in stuttgart am feuersee - stuttgart': ['bar', 'cafe'],
  'l\'estancobychez georges.':              ['bar', 'wine'],
  'gangundgäbe':                             ['restaurant'],
  'se vende':                                ['restaurant'],
  'passage des croisettes':                  ['shopping'],

  // ── Bars ───────────────────────────────────────────────────────────────────
  'hofbräuhaus münchen':                     ['bar'],
  'hofbräukeller':                           ['bar'],
  'bahnwärter thiel':                        ['bar', 'culture'],
  'alte utting':                             ['bar'],
  'szimpla kert':                            ['bar'],
  'dante nyc':                               ['bar', 'restaurant'],
  'jigger & spoon':                          ['bar'],
  'schankstelle':                            ['bar'],
  'vicky barcelona':                         ['bar'],
  'horse & hyde':                            ['bar'],
  'kafka':                                   ['bar', 'cafe'],
  'kraftpaule - craft beer in stuttgart':    ['bar'],
  '8th street winecellar':                   ['wine', 'bar'],
  'astarix trier':                           ['bar'],
  'eagle':                                   ['bar'],

  // ── Coffee & cafes ─────────────────────────────────────────────────────────
  'cartel roasting co':                      ['coffee'],
  'my little cup':                           ['coffee'],
  'good earth coffeehouse - banff':          ['coffee'],
  'eisbrunnen - plant-based creamery':       ['cafe'],
  'parfait paris':                           ['cafe'],
  'au croissant doré':                       ['cafe', 'bakery'],
  'spoon & spindle':                         ['cafe'],
  'hey i like it here':                      ['cafe'],

  // ── Shopping ───────────────────────────────────────────────────────────────
  "trader joe's":                            ['shopping'],
  'lidl':                                    ['shopping'],
  'the clothes rack':                        ['shopping'],
  'tracksmith':                              ['shopping'],
  'pudel orthopädie-schuhtechnik gmbh':      ['shopping'],
  'blumenhaus heidebrecht':                  ['shopping'],
  'officine universelle buly 1803':          ['shopping'],
  'merci':                                   ['shopping'],
  'globetrotter stuttgart':                  ['shopping'],

  // ── Hotels ─────────────────────────────────────────────────────────────────
  'turing locke, cambridge':                 ['hotel'],
  'club wyndham midtown 45':                 ['hotel'],

  // ── Fitness / wellness ─────────────────────────────────────────────────────
  'david lloyd frankfurt skyline plaza':     ['fitness'],
  'f3 das wohlfühlbad':                      ['wellness'],
  'solebad cannstatt':                       ['wellness'],

  // ── Museums / culture ──────────────────────────────────────────────────────
  'tate modern':                             ['museum'],
  'comedy cellar':                           ['culture'],
  "fisherman's bastion":                     ['culture'],
  'buda castle':                             ['culture'],
  'fulham football club':                    ['culture'],
  'messe düsseldorf':                        ['culture'],
  'kap europa, convention center messe frankfurt': ['culture'],
  'phantom of broadway':                     ['culture'],
  'hahnen gate':                             ['culture'],
  'wilhelm marx building':                   ['culture'],
  'friedhof st. matthias':                   ['culture'],
  'planet marfa':                            ['culture'],
  'bowling center bitburg flugplatz':        ['culture'],
  'glänta kyoto sanjo kawaramachi':          ['restaurant'],

  // ── Outdoors ───────────────────────────────────────────────────────────────
  'eisbachwelle':                            ['outdoors'],
  'breitenauer see':                         ['outdoors'],
  'blue hole dive site':                     ['outdoors'],
  'moselrundfahrten':                        ['outdoors'],
  'savage neck dunes natural area preserve': ['outdoors'],
  'forstbw - house of the forest':           ['outdoors', 'education'],
  'chisholm vineyards at adventure farm':    ['wine', 'outdoors'],
  'keswick vineyards':                       ['wine'],

  // ── Markets ────────────────────────────────────────────────────────────────
  'les grandes halles du vieux-port':        ['market'],
  'markthalle stuttgart':                    ['market'],
  'marktplatz':                              ['market'],
  'viktualienmarkt beergarden':              ['market', 'bar', 'outdoors'],

  // ── Medical ────────────────────────────────────────────────────────────────
  'diakonie-klinikum stuttgart - zentrale notaufnahme': ['medical'],
  'tru primary & urgent care (truhealthnow) - germantown': ['medical'],

  // ── Education ──────────────────────────────────────────────────────────────
  'mit lincoln laboratory':                  ['education'],
  'cybercampus sverige | sweden':            ['education'],

  // ── Transport ──────────────────────────────────────────────────────────────
  'brussel-noord':                           ['transport'],

  // ── Remaining specific places ───────────────────────────────────────────────
  "l'estancobychezgeorges.":                 ['bar', 'wine'],
  'aafes shopette':                          ['shopping'],
  'nike house of innovation nyc':            ['shopping'],
  'the old bridge':                          ['bar'],
  'sutsche':                                 ['restaurant'],
  'thunderbird dfac':                        ['restaurant'],
  'black potion sedona':                     ['wellness'],
  'black rose tattooers':                    ['shopping'],
};

function inferTags(name) {
  const tags = new Set();

  // Exact known-name lookup (case-insensitive).
  const known = KNOWN_NAMES[name.toLowerCase()];
  if (known) known.forEach((t) => tags.add(t));

  // Regex rules always run — may add extra tags on top of known-name results.
  for (const [rx, tag] of TAG_RULES) {
    if (rx.test(name)) tags.add(tag);
  }

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
