// Per-user label styling: tag name -> { icon, color }.
// Stored in localStorage. Seeded with a curated preset set on first load.
(function () {
  const KEY = 'pins_labels_v1';

  // Curated presets that cover the most common place-tag scenarios.
  // Keys are matched case-insensitively against tag strings on a place.
  const PRESETS = {
    coffee:       { icon: 'coffee',        color: '#8B6B47' },
    cafe:         { icon: 'coffee',        color: '#A27A4F' },
    breakfast:    { icon: 'sun-horizon',   color: '#E8A94D' },
    brunch:       { icon: 'egg',           color: '#DDB060' },
    lunch:        { icon: 'hamburger',     color: '#C99A3A' },
    dinner:       { icon: 'fork-knife',    color: '#D97757' },
    'date-night': { icon: 'heart',         color: '#C26B8A' },
    drinks:       { icon: 'martini',       color: '#8A4F7D' },
    cocktails:    { icon: 'martini',       color: '#8A4F7D' },
    bar:          { icon: 'beer-stein',    color: '#A83232' },
    wine:         { icon: 'wine',          color: '#8C2F3A' },
    bakery:       { icon: 'bread',         color: '#C9925E' },
    dessert:      { icon: 'ice-cream',     color: '#D67B9A' },
    pizza:        { icon: 'pizza',         color: '#BC4A4A' },
    ramen:        { icon: 'bowl-food',     color: '#6B4F3A' },
    sushi:        { icon: 'fish',          color: '#5E7A94' },
    shop:         { icon: 'shopping-bag',  color: '#4A8B8B' },
    shopping:     { icon: 'shopping-bag',  color: '#4A8B8B' },
    park:         { icon: 'tree',          color: '#5E8A5E' },
    outdoor:      { icon: 'leaf',          color: '#7A9B76' },
    museum:       { icon: 'paint-brush',   color: '#6B4F8A' },
    art:          { icon: 'palette',       color: '#6B4F8A' },
    music:        { icon: 'music-notes',   color: '#B55585' },
    view:         { icon: 'mountains',     color: '#5E7A94' },
    cozy:         { icon: 'flame',         color: '#C5763D' },
    activity:     { icon: 'star',          color: '#C99A3A' },
    'hidden-gem': { icon: 'diamond',       color: '#4D9B9B' },
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
    'coffee', 'fork-knife', 'hamburger', 'pizza', 'bread', 'ice-cream',
    'bowl-food', 'fish', 'egg', 'sun-horizon',
    'martini', 'beer-stein', 'wine', 'champagne',
    'shopping-bag', 'shopping-cart', 'storefront', 'gift',
    'tree', 'leaf', 'mountains', 'flower', 'sun',
    'star', 'heart', 'diamond', 'flame', 'sparkle',
    'music-notes', 'paint-brush', 'palette', 'book-open', 'film-strip',
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
