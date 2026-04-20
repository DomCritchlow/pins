// Leaflet map — init lazily, markers update when places/filters change.
(function () {
  let map = null;
  let tileLayer = null;
  let markerLayer = null;
  let userLayer = null;

  const ATTR =
    '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors ' +
    '© <a href="https://carto.com/attributions">CARTO</a>';

  // CartoDB Positron (light) / Dark Matter (dark) — no API key required,
  // clean minimal aesthetic that lets the coloured pins stand out.
  function tileUrl() {
    return window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
      : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
  }

  // Build the HTML for a div-based pin so Phosphor icons render via the
  // already-loaded font rather than being baked into an SVG data URL.
  // Design decision: one icon per pin (first styled tag), consistent with
  // how the pin colour is already determined. The detail card shows all tags.
  function pinHtml(color, iconName, visited) {
    const icon = iconName ? `<i class="ph-fill ph-${iconName}"></i>` : '';
    const check = visited
      ? `<span class="map-pin-visited"><i class="ph-fill ph-check"></i></span>`
      : '';
    return (
      `<div class="map-pin" style="--pin-color:${color}">` +
        `<div class="map-pin-head">${icon}${check}</div>` +
      `</div>`
    );
  }

  function iconFor(place) {
    const style = window.Labels ? Labels.styleFor(place) : null;
    const color = style ? style.color : '#D97757';
    const iconName = style ? style.icon : null;
    return L.divIcon({
      html: pinHtml(color, iconName, !!place.visited),
      className: 'map-pin-wrap',
      iconSize: [30, 38],
      iconAnchor: [15, 38],
      popupAnchor: [0, -40],
    });
  }

  function init() {
    if (map) return map;
    map = L.map('map', { zoomControl: true, attributionControl: true }).setView([40.7128, -74.006], 12);
    tileLayer = L.tileLayer(tileUrl(), { maxZoom: 19, attribution: ATTR }).addTo(map);

    // Swap to the matching tile set when the OS switches dark/light mode.
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      tileLayer.setUrl(tileUrl());
    });

    markerLayer = L.layerGroup().addTo(map);
    return map;
  }

  function render(places, { onOpen, userLocation } = {}) {
    init();
    markerLayer.clearLayers();
    const bounds = [];
    places.forEach((p) => {
      if (p.lat == null || p.lng == null) return;
      const m = L.marker([p.lat, p.lng], { icon: iconFor(p) });
      const name = U.escapeHtml(p.name);
      const meta = [p.neighborhood, p.city].filter(Boolean).join(' · ');
      m.bindPopup(
        `<span class="popup-name">${name}</span>` +
          (meta ? `<span class="muted small">${U.escapeHtml(meta)}</span><br>` : '') +
          `<a href="#" class="popup-link" data-pin-open="${U.escapeHtml(p.id)}">Open details →</a>`
      );
      m.on('popupopen', (e) => {
        const link = e.popup.getElement().querySelector('[data-pin-open]');
        if (link) link.addEventListener('click', (ev) => {
          ev.preventDefault();
          onOpen && onOpen(p.id);
          m.closePopup();
        });
      });
      m.addTo(markerLayer);
      bounds.push([p.lat, p.lng]);
    });

    if (userLocation) {
      if (userLayer) userLayer.remove();
      const icon = L.divIcon({
        className: '',
        html: '<div class="user-dot"></div>',
        iconSize: [16, 16],
        iconAnchor: [8, 8],
      });
      userLayer = L.marker([userLocation.lat, userLocation.lng], { icon }).addTo(map);
      bounds.push([userLocation.lat, userLocation.lng]);
    }

    if (bounds.length) {
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
    }
  }

  function invalidateSize() {
    if (map) setTimeout(() => map.invalidateSize(), 80);
  }

  window.Maps = { init, render, invalidateSize };
})();
