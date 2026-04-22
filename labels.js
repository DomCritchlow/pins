// Per-user label styling: tag name -> { icon, color }.
// Stored in localStorage. Seeded with a curated preset set on first load.
(function () {
  const KEY = 'pins_labels_v1';

  // Curated presets that cover the most common place-tag scenarios.
  // Keys are matched case-insensitively against tag strings on a place.
  const PRESETS = {
    // ── Food & drink ──────────────────────────────────────────────────────────
    coffee:       { icon: 'coffee',         color: '#8B6B47' },
    cafe:         { icon: 'coffee',         color: '#A27A4F' },
    restaurant:   { icon: 'fork-knife',     color: '#C27D5A' },
    breakfast:    { icon: 'sun-horizon',    color: '#E8A94D' },
    brunch:       { icon: 'egg',            color: '#DDB060' },
    lunch:        { icon: 'hamburger',      color: '#C99A3A' },
    dinner:       { icon: 'fork-knife',     color: '#D97757' },
    'date-night': { icon: 'heart',          color: '#C26B8A' },
    bakery:       { icon: 'bread',          color: '#C9925E' },
    dessert:      { icon: 'ice-cream',      color: '#D67B9A' },
    // ── Cuisines ──────────────────────────────────────────────────────────────
    pizza:        { icon: 'pizza',          color: '#BC4A4A' },
    burgers:      { icon: 'hamburger',      color: '#C9723A' },
    ramen:        { icon: 'bowl-food',      color: '#6B4F3A' },
    sushi:        { icon: 'fish',           color: '#5E7A94' },
    japanese:     { icon: 'bowl-food',      color: '#B55A5A' },
    korean:       { icon: 'bowl-food',      color: '#C24A4A' },
    thai:         { icon: 'bowl-food',      color: '#D47A3A' },
    vietnamese:   { icon: 'bowl-food',      color: '#5E9B6B' },
    chinese:      { icon: 'bowl-food',      color: '#C23030' },
    indian:       { icon: 'bowl-food',      color: '#D48838' },
    mexican:      { icon: 'pepper',         color: '#8A3A30' },
    italian:      { icon: 'fork-knife',     color: '#3A6B9B' },
    french:       { icon: 'bread',          color: '#9B6B4A' },
    // ── Drinks ────────────────────────────────────────────────────────────────
    drinks:       { icon: 'martini',        color: '#8A4F7D' },
    cocktails:    { icon: 'martini',        color: '#8A4F7D' },
    bar:          { icon: 'beer-stein',     color: '#A83232' },
    wine:         { icon: 'wine',           color: '#8C2F3A' },
    // ── Stay ──────────────────────────────────────────────────────────────────
    hotel:        { icon: 'bed',            color: '#5E7A9E' },
    // ── Shopping ──────────────────────────────────────────────────────────────
    shop:         { icon: 'shopping-bag',   color: '#4A8B8B' },
    shopping:     { icon: 'shopping-bag',   color: '#4A8B8B' },
    market:       { icon: 'storefront',     color: '#D4A843' },
    // ── Outdoors ──────────────────────────────────────────────────────────────
    park:         { icon: 'tree',           color: '#5E8A5E' },
    outdoors:     { icon: 'tree',           color: '#5E8A5E' },
    outdoor:      { icon: 'leaf',           color: '#7A9B76' },
    view:         { icon: 'mountains',      color: '#5E7A94' },
    // ── Fitness & wellness ────────────────────────────────────────────────────
    fitness:      { icon: 'barbell',        color: '#4A9E6B' },
    wellness:     { icon: 'heartbeat',      color: '#9B7BD4' },
    // ── Culture & arts ────────────────────────────────────────────────────────
    museum:       { icon: 'paint-brush',    color: '#6B4F8A' },
    gallery:      { icon: 'image',          color: '#8A5E9B' },
    art:          { icon: 'palette',        color: '#6B4F8A' },
    culture:      { icon: 'ticket',         color: '#D45F72' },
    music:        { icon: 'music-notes',    color: '#B55585' },
    // ── Practical ─────────────────────────────────────────────────────────────
    medical:      { icon: 'first-aid',      color: '#5E9B8A' },
    education:    { icon: 'graduation-cap', color: '#5E78A0' },
    transport:    { icon: 'train',          color: '#7A7A8A' },
    parking:      { icon: 'car',            color: '#8A8A7A' },
    // ── Vibes ─────────────────────────────────────────────────────────────────
    cozy:         { icon: 'flame',          color: '#C5763D' },
    activity:     { icon: 'star',           color: '#C99A3A' },
    'hidden-gem': { icon: 'diamond',        color: '#4D9B9B' },
  };

  // Curated palette — harmonizes with the app's terracotta+sage theme.
  const PALETTE = [
    '#D97757', '#E8A94D', '#C99A3A', '#DDB060', '#C5763D',
    '#7A9B76', '#5E8A5E', '#4A8B8B', '#4D9B9B', '#5E7A94',
    '#6B4F8A', '#8A4F7D', '#B55585', '#C26B8A', '#D67B9A',
    '#BC4A4A', '#A83232', '#8C2F3A', '#8B6B47', '#6B4F3A',
  ];

  // Curated Phosphor icon names covering food, drink, outdoor, activity, etc.
  const ICONS = [
    // Food & drink
    'coffee', 'fork-knife', 'hamburger', 'pizza', 'bread', 'ice-cream',
    'bowl-food', 'fish', 'egg', 'sun-horizon', 'pepper',
    'martini', 'beer-stein', 'wine', 'champagne',
    // Stay & fitness
    'bed', 'barbell', 'heartbeat',
    // Shopping & places
    'shopping-bag', 'shopping-cart', 'storefront', 'gift',
    'ticket', 'image', 'paint-brush', 'palette',
    // Outdoors & nature
    'tree', 'leaf', 'mountains', 'flower', 'sun',
    // Practical
    'first-aid', 'graduation-cap', 'train', 'car',
    // Vibes
    'star', 'heart', 'diamond', 'flame', 'sparkle',
    'music-notes', 'book-open', 'film-strip',
    'dog', 'cat', 'baby',
    'binoculars', 'bicycle', 'tent', 'campfire',
    'anchor', 'airplane-tilt', 'compass', 'map-pin', 'bookmark',
  ];

  let cache = null;

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return seed();
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return seed();
      // Fill in any new presets that don't exist in the user's stored labels yet,
      // without overriding anything they've already customised or removed.
      const missing = Object.entries(PRESETS).filter(([k]) => !(k in parsed));
      if (missing.length) {
        const updated = { ...parsed };
        missing.forEach(([k, v]) => { updated[k] = v; });
        save(updated);
        return updated;
      }
      return parsed;
    } catch (_) {
      return seed();
    }
  }

  function seed() {
    save({ ...PRESETS });
    return { ...PRESETS };
  }

  function save(labels) {
    cache = labels;
    localStorage.setItem(KEY, JSON.stringify(labels));
  }

  function all() {
    if (!cache) cache = load();
    return cache;
  }

  function get(tag) {
    if (!tag) return null;
    return all()[String(tag).toLowerCase()] || null;
  }

  function set(tag, style) {
    if (!tag) return;
    const labels = { ...all() };
    labels[String(tag).toLowerCase()] = { icon: style.icon, color: style.color };
    save(labels);
  }

  function remove(tag) {
    if (!tag) return;
    const labels = { ...all() };
    delete labels[String(tag).toLowerCase()];
    save(labels);
  }

  function reset() {
    localStorage.removeItem(KEY);
    cache = null;
    return seed();
  }

  // First styled tag on a place becomes its "primary" style (used for map
  // marker color and card accents). Returns null if none of the place's
  // tags have a style yet.
  function styleFor(place) {
    if (!place || !place.tags || !place.tags.length) return null;
    for (const t of place.tags) {
      const s = get(t);
      if (s) return s;
    }
    return null;
  }

  // Convert "#RRGGBB" -> "rgba(r,g,b,a)" — for chip backgrounds that should
  // be tinted with the label color.
  function tint(hex, alpha) {
    const h = hex.replace('#', '');
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  window.Labels = { all, get, set, remove, reset, styleFor, tint, PALETTE, ICONS };
})();
