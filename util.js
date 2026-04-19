// Small helpers used across modules.
(function () {
  const U = {};

  U.uuid = () => {
    if (crypto && crypto.randomUUID) return crypto.randomUUID().split('-')[0];
    return Math.random().toString(36).slice(2, 10);
  };

  U.today = () => new Date().toISOString().slice(0, 10);

  // Haversine in meters.
  U.distanceMeters = (a, b) => {
    if (!a || !b || a.lat == null || b.lat == null) return Infinity;
    const R = 6371e3;
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const la1 = toRad(a.lat);
    const la2 = toRad(b.lat);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  };

  U.formatDistance = (m) => {
    if (!isFinite(m)) return '';
    if (m < 950) return `${Math.round(m / 10) * 10} m`;
    return `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`;
  };

  U.formatWalk = (m) => {
    // 5 km/h → 1 km = 12 min.
    const mins = Math.round((m / 1000) * 12);
    if (mins < 1) return '<1 min walk';
    if (mins < 60) return `${mins} min walk`;
    return `${(mins / 60).toFixed(1)} hr walk`;
  };

  U.escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));

  U.debounce = (fn, ms) => {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  };

  U.getLocation = (options = {}) =>
    new Promise((resolve, reject) => {
      if (!navigator.geolocation) return reject(new Error('no-geo'));
      navigator.geolocation.getCurrentPosition(
        (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
        (err) => reject(err),
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 60_000, ...options }
      );
    });

  let toastTimer = null;
  U.toast = (msg, ms = 2200) => {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add('hidden'), ms);
  };

  U.parseTags = (s) => String(s || '').split(',').map((t) => t.trim()).filter(Boolean);
  U.joinTags = (arr) => (arr || []).map((t) => t.trim()).filter(Boolean).join(',');

  U.parseBool = (s) => String(s || '').toUpperCase() === 'TRUE';
  U.boolOut = (b) => (b ? 'TRUE' : 'FALSE');

  U.qs = (sel, root = document) => root.querySelector(sel);
  U.qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  window.U = U;
})();
