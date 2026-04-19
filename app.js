// Pins — top-level controller. Owns state, routing, rendering, event wiring.
(function () {
  const state = {
    places: [],
    sheetId: null,
    filters: { tags: [], visited: 'all', neighborhoods: [], cities: [], search: '' },
    sort: 'newest',
    view: 'list',
    userLocation: null,
    nearbyMode: 'smart', // 'smart' | '1' | '3' | '10'
    editingId: null,
    pendingFormTags: [],
  };

  // ------------------------------------------------------------------
  // Boot
  // ------------------------------------------------------------------
  document.addEventListener('DOMContentLoaded', boot);

  async function boot() {
    wireStaticEvents();
    U.qs('#admin-contact').textContent = window.CONFIG.ADMIN_CONTACT || '';
    if (Auth.getToken()) {
      await enterApp();
    } else {
      showScreen('signin');
    }
    // Parse shared URL params (Share Target entry).
    const params = new URLSearchParams(location.search);
    if (params.has('url') || params.has('text') || params.has('title')) {
      // Wait until we're in the main view before opening form.
      const pending = {
        title: params.get('title') || '',
        url: params.get('url') || params.get('text') || '',
      };
      sessionStorage.setItem('pins_pending_share', JSON.stringify(pending));
      history.replaceState({}, '', location.pathname);
    }
  }

  function showScreen(name) {
    ['signin', 'no-sheet', 'main'].forEach((s) => {
      const el = document.getElementById(s === 'main' ? 'view-main' : `view-${s}`);
      if (el) el.classList.toggle('hidden', s !== name);
    });
  }

  async function enterApp() {
    try {
      const sheetId = await Auth.resolveSheet();
      if (!sheetId) {
        showScreen('no-sheet');
        return;
      }
      state.sheetId = sheetId;
      showScreen('main');
      const places = await Sheets.listPlaces(sheetId);
      state.places = places;
      tryGetLocation();
      render();
      // If the user entered via a shared URL, open the prefilled form.
      const pending = sessionStorage.getItem('pins_pending_share');
      if (pending) {
        sessionStorage.removeItem('pins_pending_share');
        const { title, url } = JSON.parse(pending);
        openForm(null, { name: title, source_url: url });
      }
    } catch (e) {
      console.error(e);
      U.toast('Could not load your places. Try refreshing.');
    }
  }

  async function tryGetLocation() {
    try {
      const loc = await U.getLocation();
      state.userLocation = loc;
      if (state.view === 'list' || state.view === 'nearby') render();
    } catch (_) { /* no location is fine */ }
  }

  // ------------------------------------------------------------------
  // Event wiring
  // ------------------------------------------------------------------
  function wireStaticEvents() {
    U.qs('#btn-signin').addEventListener('click', async () => {
      try { await Auth.signIn(); await enterApp(); }
      catch (e) { console.error(e); U.toast('Sign-in failed. Try again.'); }
    });
    U.qs('#btn-retry').addEventListener('click', async () => {
      sessionStorage.removeItem('pins_sheet_id');
      await enterApp();
    });
    U.qs('#btn-signout').addEventListener('click', () => { Auth.signOut(); showScreen('signin'); });

    // Tab bar
    U.qsa('#tab-bar .tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.tab;
        if (tab === 'add') { openForm(null); return; }
        setView(tab);
      });
    });

    // Search
    const search = U.qs('#search');
    search.addEventListener('input', U.debounce(() => {
      state.filters.search = search.value.trim().toLowerCase();
      renderList();
    }, 150));

    // Filter drawer
    U.qs('#btn-filter').addEventListener('click', openFilterDrawer);
    U.qs('#btn-filter-apply').addEventListener('click', () => closeSheet('#filter-drawer'));
    U.qs('#btn-filter-clear').addEventListener('click', () => {
      state.filters = { tags: [], visited: 'all', neighborhoods: [], cities: [], search: state.filters.search };
      renderFilterDrawer();
      render();
    });

    // Sort
    U.qsa('#list-sort .sort-btn').forEach((b) => {
      b.addEventListener('click', () => {
        state.sort = b.dataset.sort;
        U.qsa('#list-sort .sort-btn').forEach((x) => x.classList.toggle('active', x === b));
        renderList();
      });
    });
    U.qs('#list-sort .sort-btn[data-sort="newest"]').classList.add('active');

    // Close any sheet via its X button or scrim.
    document.addEventListener('click', (e) => {
      if (e.target.matches('.sheet') || e.target.closest('.sheet-close')) {
        const sheet = e.target.closest('.sheet') || e.target;
        if (sheet && sheet.classList.contains('sheet')) closeSheet(sheet);
      }
    });

    // Form wiring
    wireForm();

    // Nearby settings
    U.qs('#btn-nearby-settings').addEventListener('click', () => openSheet('#nearby-sheet'));
    U.qsa('#nearby-sheet .seg-btn').forEach((b) => {
      b.addEventListener('click', () => {
        state.nearbyMode = b.dataset.mode;
        U.qsa('#nearby-sheet .seg-btn').forEach((x) => x.classList.toggle('active', x === b));
        renderNearby();
      });
    });
    U.qs(`#nearby-sheet .seg-btn[data-mode="${state.nearbyMode}"]`).classList.add('active');
  }

  // ------------------------------------------------------------------
  // Views / routing
  // ------------------------------------------------------------------
  function setView(view) {
    state.view = view;
    U.qsa('#tab-bar .tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === view));
    U.qs('#pane-list').classList.toggle('hidden', view !== 'list');
    U.qs('#pane-map').classList.toggle('hidden', view !== 'map');
    U.qs('#pane-nearby').classList.toggle('hidden', view !== 'nearby');
    history.replaceState({}, '', `#${view}`);
    if (view === 'map') { Maps.invalidateSize(); renderMap(); }
    if (view === 'nearby') { renderNearby(); }
    if (view === 'list') { renderList(); }
  }

  function render() {
    renderActiveFilters();
    if (state.view === 'list') renderList();
    if (state.view === 'map') renderMap();
    if (state.view === 'nearby') renderNearby();
  }

  // ------------------------------------------------------------------
  // Filtering
  // ------------------------------------------------------------------
  function filteredPlaces() {
    const f = state.filters;
    return state.places.filter((p) => {
      if (f.visited === 'yes' && !p.visited) return false;
      if (f.visited === 'no' && p.visited) return false;
      if (f.tags.length && !f.tags.every((t) => p.tags.includes(t))) return false;
      if (f.neighborhoods.length && !f.neighborhoods.includes(p.neighborhood)) return false;
      if (f.cities.length && !f.cities.includes(p.city)) return false;
      if (f.search) {
        const hay = `${p.name} ${p.notes} ${p.tags.join(' ')} ${p.address} ${p.neighborhood} ${p.city}`.toLowerCase();
        if (!hay.includes(f.search)) return false;
      }
      return true;
    });
  }

  function sortedPlaces(list) {
    const byDist = (a, b) => {
      const da = state.userLocation ? U.distanceMeters(state.userLocation, a) : 0;
      const db = state.userLocation ? U.distanceMeters(state.userLocation, b) : 0;
      return da - db;
    };
    const l = list.slice();
    if (state.sort === 'nearest' && state.userLocation) l.sort(byDist);
    else if (state.sort === 'alpha') l.sort((a, b) => a.name.localeCompare(b.name));
    else l.sort((a, b) => (b.added_date || '').localeCompare(a.added_date || ''));
    return l;
  }

  function renderActiveFilters() {
    const wrap = U.qs('#active-filters');
    wrap.innerHTML = '';
    const f = state.filters;
    const add = (label, onRemove, icon = 'x') => {
      const chip = document.createElement('span');
      chip.className = 'chip removable';
      chip.innerHTML = `<span>${U.escapeHtml(label)}</span><i class="ph ph-${icon}"></i>`;
      chip.addEventListener('click', onRemove);
      wrap.appendChild(chip);
    };
    if (f.visited === 'yes') add('Visited', () => { f.visited = 'all'; render(); });
    if (f.visited === 'no') add('Not visited', () => { f.visited = 'all'; render(); });
    f.tags.forEach((t) => add('#' + t, () => { f.tags = f.tags.filter((x) => x !== t); render(); }));
    f.neighborhoods.forEach((n) => add(n, () => { f.neighborhoods = f.neighborhoods.filter((x) => x !== n); render(); }, 'map-pin'));
    f.cities.forEach((c) => add(c, () => { f.cities = f.cities.filter((x) => x !== c); render(); }, 'buildings'));
  }

  // ------------------------------------------------------------------
  // List
  // ------------------------------------------------------------------
  function renderList() {
    const container = U.qs('#list-container');
    const empty = U.qs('#list-empty');
    const list = sortedPlaces(filteredPlaces());
    container.innerHTML = '';
    if (!list.length) {
      empty.classList.remove('hidden');
      return;
    }
    empty.classList.add('hidden');
    list.forEach((p) => container.appendChild(placeCard(p)));
  }

  function placeCard(p) {
    const card = document.createElement('div');
    card.className = 'place-card';
    const dist = state.userLocation ? U.distanceMeters(state.userLocation, p) : null;
    const distLabel = dist != null && isFinite(dist) ? U.formatDistance(dist) : '';
    const visitedBit = p.visited ? '<span class="visited-dot"></span>' : '';
    const metaParts = [p.neighborhood, p.city].filter(Boolean).join(' · ');
    const tagsHtml = (p.tags.slice(0, 3).map((t) => `<span class="tag-pill">${U.escapeHtml(t)}</span>`).join('')) +
      (p.tags.length > 3 ? `<span class="tag-pill">+${p.tags.length - 3}</span>` : '');
    card.innerHTML = `
      <div class="place-card-head">
        <div class="place-card-name">${visitedBit}${U.escapeHtml(p.name)}</div>
        ${distLabel ? `<div class="place-card-dist">${distLabel}</div>` : ''}
      </div>
      ${metaParts ? `<div class="place-card-meta"><i class="ph ph-map-pin"></i>${U.escapeHtml(metaParts)}</div>` : ''}
      ${tagsHtml ? `<div class="place-card-tags">${tagsHtml}</div>` : ''}
    `;
    card.addEventListener('click', () => openDetail(p.id));
    return card;
  }

  // ------------------------------------------------------------------
  // Map
  // ------------------------------------------------------------------
  function renderMap() {
    const list = filteredPlaces();
    Maps.render(list, { onOpen: openDetail, userLocation: state.userLocation });
  }

  // ------------------------------------------------------------------
  // Nearby
  // ------------------------------------------------------------------
  function renderNearby() {
    const container = U.qs('#nearby-container');
    const title = U.qs('#nearby-sub');
    container.innerHTML = '';
    if (!state.userLocation) {
      title.textContent = '';
      container.innerHTML = `
        <div class="empty">
          <i class="ph ph-compass icon-xl"></i>
          <h2 class="display">Turn on location</h2>
          <p class="muted">Nearby needs your location to show what's around.</p>
          <button id="btn-ask-location" class="btn btn-primary">Enable location</button>
        </div>`;
      U.qs('#btn-ask-location').addEventListener('click', tryGetLocation);
      return;
    }
    const candidates = filteredPlaces()
      .filter((p) => p.lat != null && p.lng != null)
      .map((p) => ({ p, d: U.distanceMeters(state.userLocation, p) }))
      .sort((a, b) => a.d - b.d);

    // Smart radius: expand until >= 5 results, else use a fixed radius.
    let radius = null;
    if (state.nearbyMode === 'smart') {
      for (const r of [1000, 3000, 10000]) {
        if (candidates.filter((c) => c.d <= r).length >= 5) { radius = r; break; }
      }
      if (!radius) radius = 10000;
    } else {
      radius = Number(state.nearbyMode) * 1000;
    }

    const picks = candidates.filter((c) => c.d <= radius);
    title.textContent = picks.length
      ? `${picks.length} within ${U.formatDistance(radius)}`
      : `Nothing within ${U.formatDistance(radius)} — try a wider radius.`;
    picks.forEach(({ p, d }) => {
      const card = placeCard(p);
      const dEl = card.querySelector('.place-card-dist');
      if (dEl) dEl.textContent = `${U.formatDistance(d)} · ${U.formatWalk(d)}`;
      container.appendChild(card);
    });
  }

  // ------------------------------------------------------------------
  // Filter drawer
  // ------------------------------------------------------------------
  function openFilterDrawer() {
    renderFilterDrawer();
    openSheet('#filter-drawer');
  }

  function renderFilterDrawer() {
    // Visited
    U.qsa('#filter-drawer .seg-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.visited === state.filters.visited);
      b.onclick = () => { state.filters.visited = b.dataset.visited; renderFilterDrawer(); render(); };
    });
    // Tags
    renderPillSet('#filter-tags', uniqueValues((p) => p.tags, true), state.filters.tags, (v) => {
      const arr = state.filters.tags;
      const i = arr.indexOf(v); if (i >= 0) arr.splice(i, 1); else arr.push(v);
      renderFilterDrawer(); render();
    });
    // Neighborhoods
    renderPillSet('#filter-neighborhoods', uniqueValues((p) => [p.neighborhood].filter(Boolean)), state.filters.neighborhoods, (v) => {
      const arr = state.filters.neighborhoods;
      const i = arr.indexOf(v); if (i >= 0) arr.splice(i, 1); else arr.push(v);
      renderFilterDrawer(); render();
    });
    // Cities
    renderPillSet('#filter-cities', uniqueValues((p) => [p.city].filter(Boolean)), state.filters.cities, (v) => {
      const arr = state.filters.cities;
      const i = arr.indexOf(v); if (i >= 0) arr.splice(i, 1); else arr.push(v);
      renderFilterDrawer(); render();
    });
  }

  function renderPillSet(sel, values, active, onToggle) {
    const wrap = U.qs(sel);
    wrap.innerHTML = '';
    if (!values.length) {
      wrap.innerHTML = '<span class="muted small">Nothing yet.</span>';
      return;
    }
    values.forEach((v) => {
      const chip = document.createElement('span');
      chip.className = 'chip' + (active.includes(v) ? ' active' : '');
      chip.textContent = v;
      chip.addEventListener('click', () => onToggle(v));
      wrap.appendChild(chip);
    });
  }

  function uniqueValues(getArr, countTags = false) {
    const counts = new Map();
    state.places.forEach((p) => {
      const vals = getArr(p) || [];
      vals.forEach((v) => { if (!v) return; counts.set(v, (counts.get(v) || 0) + 1); });
    });
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).map(([v]) => v);
  }

  // ------------------------------------------------------------------
  // Detail sheet
  // ------------------------------------------------------------------
  function openDetail(id) {
    const p = state.places.find((x) => x.id === id);
    if (!p) return;
    const inner = U.qs('#detail-inner');
    const photo = p.photo_reference ? Places.photoUrl(p.photo_reference, 1200) : '';
    const dirs = p.lat != null
      ? `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}${p.place_id ? `&destination_place_id=${encodeURIComponent(p.place_id)}` : ''}`
      : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.name)}`;
    const openMaps = p.lat != null
      ? `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}${p.place_id ? `&query_place_id=${encodeURIComponent(p.place_id)}` : ''}`
      : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.name)}`;
    inner.innerHTML = `
      <div class="sheet-handle"></div>
      ${photo ? `<div class="detail-hero" style="background-image:url('${photo}')"></div>` : ''}
      <div class="detail-body">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px;">
          <h2 class="detail-title">${U.escapeHtml(p.name)}</h2>
          <button class="icon-btn sheet-close" aria-label="Close"><i class="ph ph-x"></i></button>
        </div>
        <div class="detail-meta">
          ${p.neighborhood ? `<span class="chip"><i class="ph ph-map-pin"></i>${U.escapeHtml(p.neighborhood)}</span>` : ''}
          ${p.city ? `<span class="chip"><i class="ph ph-buildings"></i>${U.escapeHtml(p.city)}</span>` : ''}
          ${p.visited ? '<span class="chip" style="background:transparent;color:var(--success);border:1px solid var(--success);"><i class="ph-fill ph-check-circle"></i>Visited</span>' : ''}
        </div>
        ${p.tags.length ? `<div class="place-card-tags">${p.tags.map((t) => `<span class="tag-pill">${U.escapeHtml(t)}</span>`).join('')}</div>` : ''}
        <div class="detail-notes" data-notes contenteditable="true" spellcheck="true">${U.escapeHtml(p.notes) || 'Tap to add a note…'}</div>
        ${p.address ? `<div class="detail-row"><i class="ph ph-map-trifold"></i><span>${U.escapeHtml(p.address)}</span></div>` : ''}
        ${p.source_url ? `<div class="detail-row"><i class="ph ph-link-simple"></i><a href="${encodeURI(p.source_url)}" target="_blank" rel="noopener">${U.escapeHtml(p.source_url)}</a></div>` : ''}
        <div class="detail-actions">
          <a class="btn btn-primary" href="${dirs}" target="_blank" rel="noopener"><i class="ph ph-navigation-arrow"></i>Directions</a>
          <a class="btn btn-secondary" href="${openMaps}" target="_blank" rel="noopener"><i class="ph ph-map-pin"></i>Open in Maps</a>
        </div>
        <div class="detail-admin">
          <button data-edit><i class="ph ph-pencil-simple"></i> Edit</button>
          <button data-toggle-visit>${p.visited ? 'Mark unvisited' : 'Mark visited'}</button>
          <button class="danger" data-delete><i class="ph ph-trash"></i> Delete</button>
        </div>
      </div>
    `;
    const notesEl = inner.querySelector('[data-notes]');
    notesEl.addEventListener('focus', () => { if (notesEl.textContent === 'Tap to add a note…') notesEl.textContent = ''; });
    notesEl.addEventListener('blur', async () => {
      const newNotes = notesEl.textContent.trim();
      if (newNotes === (p.notes || '').trim()) return;
      p.notes = newNotes;
      try { await Sheets.updatePlace(state.sheetId, p); U.toast('Notes saved'); }
      catch (e) { console.error(e); U.toast('Could not save notes'); }
    });
    inner.querySelector('[data-edit]').addEventListener('click', () => { closeSheet('#detail-sheet'); openForm(p.id); });
    inner.querySelector('[data-toggle-visit]').addEventListener('click', async () => {
      p.visited = !p.visited;
      if (p.visited && !p.visited_date) p.visited_date = U.today();
      try { await Sheets.updatePlace(state.sheetId, p); render(); openDetail(p.id); U.toast(p.visited ? 'Marked visited' : 'Marked not visited'); }
      catch (e) { console.error(e); U.toast('Could not update'); }
    });
    inner.querySelector('[data-delete]').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      if (btn.dataset.confirm !== '1') {
        btn.dataset.confirm = '1';
        btn.innerHTML = '<i class="ph ph-warning"></i> Tap again to delete';
        setTimeout(() => { if (btn.dataset.confirm) { delete btn.dataset.confirm; btn.innerHTML = '<i class="ph ph-trash"></i> Delete'; } }, 3000);
        return;
      }
      try {
        await Sheets.deletePlace(state.sheetId, p.id);
        state.places = state.places.filter((x) => x.id !== p.id);
        closeSheet('#detail-sheet');
        render();
        U.toast('Deleted');
      } catch (err) { console.error(err); U.toast('Could not delete'); }
    });
    openSheet('#detail-sheet');
  }

  // ------------------------------------------------------------------
  // Add / edit form
  // ------------------------------------------------------------------
  function wireForm() {
    const searchInput = U.qs('#f-search');
    const acWrap = U.qs('#f-autocomplete');
    const onSearch = U.debounce(async () => {
      const q = searchInput.value.trim();
      if (q.length < 2) { acWrap.classList.add('hidden'); acWrap.innerHTML = ''; return; }
      try {
        const preds = await Places.autocomplete(q, state.userLocation);
        acWrap.innerHTML = '';
        preds.slice(0, 6).forEach((pr) => {
          const item = document.createElement('div');
          item.className = 'autocomplete-item';
          item.innerHTML = `<div class="primary">${U.escapeHtml(pr.primary)}</div><div class="secondary">${U.escapeHtml(pr.secondary)}</div>`;
          item.addEventListener('click', async () => {
            acWrap.classList.add('hidden');
            try {
              const d = await Places.details(pr.place_id);
              fillFormFromDetails(d);
            } catch (e) { U.toast('Could not load place details'); }
          });
          acWrap.appendChild(item);
        });
        acWrap.classList.toggle('hidden', !preds.length);
      } catch (e) { console.error(e); }
    }, 220);
    searchInput.addEventListener('input', onSearch);

    // Visited checkbox toggles date input.
    U.qs('#f-visited').addEventListener('change', (e) => {
      const date = U.qs('#f-visited-date');
      date.classList.toggle('hidden', !e.target.checked);
      if (e.target.checked && !date.value) date.value = U.today();
    });

    // Tag input
    const tagInput = U.qs('#f-tags');
    const tagSug = U.qs('#f-tag-suggestions');
    tagInput.addEventListener('keydown', (e) => {
      if (e.key === ',' || e.key === 'Enter') {
        e.preventDefault();
        const v = tagInput.value.trim();
        if (v) addFormTag(v);
        tagInput.value = '';
        tagSug.classList.add('hidden');
      } else if (e.key === 'Backspace' && !tagInput.value) {
        state.pendingFormTags.pop();
        renderFormTags();
      }
    });
    tagInput.addEventListener('input', U.debounce(() => {
      const q = tagInput.value.trim().toLowerCase();
      tagSug.innerHTML = '';
      if (!q) { tagSug.classList.add('hidden'); return; }
      const tagCounts = new Map();
      state.places.forEach((p) => p.tags.forEach((t) => tagCounts.set(t, (tagCounts.get(t) || 0) + 1)));
      const matches = Array.from(tagCounts.entries())
        .filter(([t]) => t.toLowerCase().includes(q) && !state.pendingFormTags.includes(t))
        .sort((a, b) => b[1] - a[1]).slice(0, 6);
      if (!matches.length) { tagSug.classList.add('hidden'); return; }
      matches.forEach(([t, n]) => {
        const item = document.createElement('div');
        item.className = 'autocomplete-item';
        item.innerHTML = `<div class="primary">#${U.escapeHtml(t)}</div><div class="secondary">${n} place${n === 1 ? '' : 's'}</div>`;
        item.addEventListener('click', () => { addFormTag(t); tagInput.value = ''; tagSug.classList.add('hidden'); });
        tagSug.appendChild(item);
      });
      tagSug.classList.remove('hidden');
    }, 120));

    U.qs('#btn-form-cancel').addEventListener('click', () => closeSheet('#form-sheet'));
    U.qs('#btn-form-save').addEventListener('click', saveForm);
  }

  function addFormTag(t) {
    if (!state.pendingFormTags.includes(t)) state.pendingFormTags.push(t);
    renderFormTags();
  }

  function renderFormTags() {
    const wrap = U.qs('#f-tag-pills');
    wrap.innerHTML = '';
    state.pendingFormTags.forEach((t) => {
      const chip = document.createElement('span');
      chip.className = 'tag-removable';
      chip.innerHTML = `<span>${U.escapeHtml(t)}</span><i class="ph ph-x"></i>`;
      chip.querySelector('i').addEventListener('click', () => {
        state.pendingFormTags = state.pendingFormTags.filter((x) => x !== t);
        renderFormTags();
      });
      wrap.appendChild(chip);
    });
  }

  function fillFormFromDetails(d) {
    if (d.name && !U.qs('#f-name').value) U.qs('#f-name').value = d.name;
    U.qs('#f-address').value = d.address || '';
    U.qs('#f-neighborhood').value = d.neighborhood || '';
    U.qs('#f-lat').value = d.lat ?? '';
    U.qs('#f-lng').value = d.lng ?? '';
    U.qs('#f-city').value = d.city || '';
    U.qs('#f-state').value = d.state || '';
    U.qs('#f-country').value = d.country || '';
    U.qs('#f-place-id').value = d.place_id || '';
    U.qs('#f-photo-ref').value = d.photo_reference || '';
    U.qs('#f-price-tier').value = d.price_tier ?? '';
    U.toast('Place details filled in');
  }

  function openForm(id, prefill = null) {
    state.editingId = id || null;
    state.pendingFormTags = [];
    const form = U.qs('#place-form');
    form.reset();
    U.qs('#f-autocomplete').innerHTML = '';
    U.qs('#f-autocomplete').classList.add('hidden');
    U.qs('#f-tag-suggestions').innerHTML = '';
    U.qs('#f-tag-suggestions').classList.add('hidden');
    U.qs('#f-visited-date').classList.add('hidden');
    Places.newSessionToken();

    if (id) {
      const p = state.places.find((x) => x.id === id);
      if (!p) return;
      U.qs('#form-title').textContent = 'Edit place';
      U.qs('#f-id').value = p.id;
      U.qs('#f-name').value = p.name;
      U.qs('#f-notes').value = p.notes;
      U.qs('#f-neighborhood').value = p.neighborhood || '';
      U.qs('#f-address').value = p.address || '';
      U.qs('#f-source').value = p.source_url || '';
      U.qs('#f-lat').value = p.lat ?? '';
      U.qs('#f-lng').value = p.lng ?? '';
      U.qs('#f-city').value = p.city || '';
      U.qs('#f-state').value = p.state || '';
      U.qs('#f-country').value = p.country || '';
      U.qs('#f-place-id').value = p.place_id || '';
      U.qs('#f-photo-ref').value = p.photo_reference || '';
      U.qs('#f-price-tier').value = p.price_tier ?? '';
      U.qs('#f-visited').checked = !!p.visited;
      if (p.visited) {
        U.qs('#f-visited-date').classList.remove('hidden');
        U.qs('#f-visited-date').value = p.visited_date || U.today();
      }
      state.pendingFormTags = p.tags.slice();
    } else {
      U.qs('#form-title').textContent = 'Add a place';
      U.qs('#f-id').value = '';
      if (prefill) {
        if (prefill.name) U.qs('#f-name').value = prefill.name;
        if (prefill.source_url) U.qs('#f-source').value = prefill.source_url;
      }
    }
    renderFormTags();
    openSheet('#form-sheet');
    setTimeout(() => U.qs('#f-search').focus(), 200);
  }

  async function saveForm() {
    const name = U.qs('#f-name').value.trim();
    if (!name) { U.toast('Give it a name'); return; }
    const existing = state.editingId ? state.places.find((x) => x.id === state.editingId) : null;
    const place = {
      id: existing ? existing.id : U.uuid(),
      name,
      notes: U.qs('#f-notes').value.trim(),
      neighborhood: U.qs('#f-neighborhood').value.trim(),
      address: U.qs('#f-address').value.trim(),
      source_url: U.qs('#f-source').value.trim(),
      lat: numberOrNull(U.qs('#f-lat').value),
      lng: numberOrNull(U.qs('#f-lng').value),
      city: U.qs('#f-city').value.trim(),
      state: U.qs('#f-state').value.trim(),
      country: U.qs('#f-country').value.trim(),
      place_id: U.qs('#f-place-id').value.trim(),
      photo_reference: U.qs('#f-photo-ref').value.trim(),
      price_tier: numberOrNull(U.qs('#f-price-tier').value),
      tags: state.pendingFormTags.slice(),
      visited: U.qs('#f-visited').checked,
      visited_date: U.qs('#f-visited').checked ? (U.qs('#f-visited-date').value || U.today()) : '',
      added_date: existing ? existing.added_date : U.today(),
      custom: existing ? existing.custom : '',
    };
    const btn = U.qs('#btn-form-save');
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      if (existing) {
        await Sheets.updatePlace(state.sheetId, place);
        const i = state.places.findIndex((x) => x.id === place.id);
        if (i >= 0) state.places[i] = place;
        U.toast('Saved');
      } else {
        await Sheets.appendPlace(state.sheetId, place);
        state.places.unshift(place);
        U.toast('Added');
      }
      closeSheet('#form-sheet');
      render();
    } catch (e) {
      console.error(e);
      U.toast('Could not save. Check your connection.');
    } finally {
      btn.disabled = false; btn.textContent = 'Save';
    }
  }

  function numberOrNull(v) {
    if (v === '' || v == null) return null;
    const n = Number(v);
    return isNaN(n) ? null : n;
  }

  // ------------------------------------------------------------------
  // Sheet open/close helpers
  // ------------------------------------------------------------------
  function openSheet(sel) {
    const el = typeof sel === 'string' ? U.qs(sel) : sel;
    if (!el) return;
    el.classList.remove('hidden');
  }
  function closeSheet(sel) {
    const el = typeof sel === 'string' ? U.qs(sel) : sel;
    if (!el) return;
    el.classList.add('hidden');
  }
})();
