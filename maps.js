// Leaflet map — init lazily, markers update when places/filters change.
(function () {
  let map = null;
  let markerLayer = null;
  let userLayer = null;

  function svgPin(color, visited) {
    const check = visited
      ? '<circle cx="24" cy="8" r="6" fill="#FFFFFF"/><path d="M20.5 8l2.5 2.5 4.5-5" fill="none" stroke="#3B7A34" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>'
      : '';
    const s = encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 44" width="32" height="44">
        <path d="M16 0C7.2 0 0 7.1 0 16c0 11.6 16 28 16 28s16-16.4 16-28C32 7.1 24.8 0 16 0z" fill="${color}"/>
        <circle cx="16" cy="16" r="6" fill="#FFFFFF"/>
        ${check}
      </svg>`
    );
    return `data:image/svg+xml;charset=UTF-8,${s}`;
  }

  function iconFor(place) {
    // Color derives from the place's first styled label (per-user config).
    // Falls back to the app's terracotta accent when no labels match.
    const style = window.Labels ? Labels.styleFor(place) : null;
    const color = style ? style.color : '#D97757';
    return L.icon({
      iconUrl: svgPin(color, !!place.visited),
      iconSize: [28, 38],
      iconAnchor: [14, 38],
      popupAnchor: [0, -34],
    });
  }

  function init() {
    if (map) return map;
    map = L.map('map', { zoomControl: true, attributionControl: true }).setView([40.7128, -74.006], 12);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap',
    }).addTo(map);
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
        if (link) link.addEventListener('click', (ev) => { ev.preventDefault(); onOpen && onOpen(p.id); m.closePopup(); });
      });
      m.addTo(markerLayer);
      bounds.push([p.lat, p.lng]);
    });

    if (userLocation) {
      if (userLayer) userLayer.remove();
      const icon = L.divIcon({ className: '', html: '<div class="user-dot"></div>', iconSize: [16, 16], iconAnchor: [8, 8] });
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
