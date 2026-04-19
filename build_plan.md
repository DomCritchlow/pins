# Pins — Build Spec (v1)

## What you are building

A Progressive Web App that lets a small group of users (5 max) organize their saved places (restaurants, cafes, bars, things to do) with multi-tag filtering, a map view, and a nearby-now feature. Google Sheets is the database. The app is hosted on GitHub Pages. Google Maps is used only for navigation handoff — it is never the source of truth.

The core problem this solves: Google Maps saved lists are one-dimensional (one filter = one list). Pins gives the user tags, visited tracking, notes, geography metadata, and multi-filter queries across all their places.

---

## Audience

- Built first for Dominic's partner (non-technical).
- iPhone Safari PWA installed to home screen is the only target. No Android testing.
- Scales to ~5 close friends. Admin (Dominic) hosts everything.

---

## Architecture in one paragraph

Admin owns a single Google Cloud project (one OAuth Client ID, one API key). Admin owns every user's Google Sheet in their own Drive, one sheet per user, each shared with the user's Google email (editor access). Users sign in with their own Google account — the app uses the Drive API to find the sheet shared with them by name pattern (`PlaceTracker - *`) and treats it as their database. No backend. No per-user GCP setup.

---

## Tech stack

| Layer | Choice | Reason |
|---|---|---|
| Frontend | Vanilla JS + HTML + CSS (no framework, no build step) | Tiny bundle, any dev can read it, trivial to host statically |
| Map | Leaflet.js + OpenStreetMap tiles | Free, no API key |
| Database | Google Sheets (Sheets API v4) | Free, user-readable, no server |
| Sheet discovery | Google Drive API v3 | Lets the app auto-resolve which sheet belongs to the signed-in user |
| Place enrichment | Google Places API (New) | Auto-fills address, lat/lng, address_components (city/state/country/neighborhood), photo name. New (not legacy) because it supports browser CORS and is the only path open to new GCP projects. |
| Auth | Google Identity Services (GIS) — OAuth 2.0 token client | Current replacement for `gapi.auth2`, no backend needed |
| Hosting | GitHub Pages | Free, HTTPS, auto-deploy on push |
| Icons | Phosphor Icons (CDN) | Trendy, iOS-feeling, free |
| Fonts | Inter (UI) + Instrument Serif (display) via Google Fonts | Modern + a hint of classy |

---

## Sheet schema

One sheet named `places`. Row 1 is the header, data starts at row 2. Columns in order:

| Col | Header | Type | Notes |
|---|---|---|---|
| A | id | string | UUID, e.g. `a3f8c1d2` |
| B | name | string | Display name |
| C | address | string | Full address |
| D | city | string | Auto-filled from Places `address_components` |
| E | state | string | State / region |
| F | country | string | Country |
| G | neighborhood | string | From Places when available, user-overridable |
| H | lat | number | |
| I | lng | number | |
| J | tags | string | Comma-separated |
| K | notes | string | Free text |
| L | visited | boolean | `TRUE` / `FALSE` |
| M | visited_date | string | ISO date, blank if unvisited |
| N | source_url | string | Where it was discovered (Instagram, blog, etc.) |
| O | place_id | string | Google Maps Place ID |
| P | photo_reference | string | Places API (New) photo resource name, e.g. `places/XXX/photos/YYY`. App builds URL on demand, never caches the image file. |
| Q | price_tier | number | 1–4 from Places, blank if unknown |
| R | added_date | string | ISO date |
| S | custom | string | JSON blob for future fields — no more schema migrations |

---

## App structure

```
/
├── index.html          # shell
├── manifest.json       # PWA manifest incl. share_target
├── sw.js               # service worker (caches app shell, version-bumps on deploy)
├── style.css
├── config.js           # CLIENT_ID + API_KEY (placeholders, admin fills in)
├── util.js             # uuid, distance, geolocation, toast, formatters
├── auth.js             # GIS token flow + Drive sheet resolution
├── sheets.js           # CRUD against the resolved sheet
├── places.js           # Places Autocomplete + Details + photo URL builder
├── maps.js             # Leaflet init + marker rendering
├── app.js              # top-level controller, views, filter state, render
├── .nojekyll
├── icons/
│   ├── icon-192.png    # admin adds
│   └── icon-512.png    # admin adds
├── README.md           # setup + deploy checklist
└── build_plan.md
```

---

## Auth & sheet resolution

**User-facing flow**:
1. App loads → immediately shows "Sign in with Google" (no intro screen).
2. GIS token client requests scopes:
   - `https://www.googleapis.com/auth/spreadsheets`
   - `https://www.googleapis.com/auth/drive.metadata.readonly`
3. Token stored in `sessionStorage`.
4. App calls Drive API `files.list` with:
   ```
   q=name contains 'PlaceTracker' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false
   ```
   (This returns sheets the user owns OR that are shared with them — admin-owned + shared-with-user satisfies this.)
5. If exactly 1 match → cache sheet ID in `sessionStorage`, load data.
6. If 0 → show "Your sheet isn't set up yet — ask Dominic" screen with a refresh button.
7. If >1 → pick most recently modified.

Token expires after 1 hour. On expiry, GIS re-requests silently (no popup unless consent has been revoked).

---

## Data flow

### On app load
1. Restore token from `sessionStorage` if present, else run sign-in.
2. Resolve sheet ID.
3. Fetch all rows via `values.get` on `places!A2:S`.
4. Parse into `window.places` array of typed objects.
5. Render list view.

### Add / edit / delete
- **Add**: `values.append` → push to `window.places` → re-render.
- **Edit**: find row number by matching `id` in column A → `values.update` that row → update in-memory → re-render.
- **Delete**: find row → `batchUpdate` with `deleteDimension` → splice from memory → re-render.

Never re-fetch the whole sheet after a write. Re-fetch only on full reload.

**Offline behavior**: no add queue in v1. If the network is down, the write fails and the user sees a toast ("Couldn't save — try again when you're online"). Can add a queue later if it turns out to be annoying.

---

## Views

### 1. List (default)
Cards sorted newest first. Each card: name, neighborhood chip, tag pills (max 3 visible + "+N"), visited badge, distance if geolocation granted. Tap → detail sheet.

Sort options in a small dropdown: Newest, Nearest, A–Z.

### 2. Filter bar (persistent above list)
- **Search** — plain text against name + notes + tags.
- **Active filter chips** — tapping an active chip removes it.
- **Funnel icon** → filter drawer: multi-select tags (AND logic), visited tri-state, neighborhood, city.

Tag & neighborhood lists are derived dynamically from `window.places`. Filter state persists in `location.hash` so views are bookmarkable.

### 3. Map
Full-screen Leaflet + OSM. Custom SVG markers colored by visited state (coral = not visited, sage = visited). User location as a pulsing blue dot if permitted. Filters apply to markers — filtered-out places don't render. Tapping a marker opens a compact popup → tap popup → full detail sheet.

### 4. Nearby
Smart auto-expanding radius: start at 1km, expand to 3km then 10km if <5 results. Settings sheet lets the user override with a fixed radius. Sorted by distance ascending. Shows distance + estimated walk time (5 km/h). Respects active filters. If geolocation denied: "Allow location to use Nearby" with a button.

### 5. Detail sheet (slides up from bottom)
Hero image if `photo_reference` present (built on demand via Places photo URL, never cached by the app). Name in Instrument Serif. Neighborhood + city chips. Tag pills. Notes (tap to edit inline). Visited checkbox + date. Source URL as tappable link. Added date (muted).

Actions:
- **Directions** — primary button. `https://maps.google.com/dir/?api=1&destination=LAT,LNG&destination_place_id=PLACE_ID`
- **Open in Maps** — secondary. `https://www.google.com/maps/search/?api=1&query=LAT,LNG&query_place_id=PLACE_ID`
- **Edit** — opens form sheet.
- **Delete** — with an inline two-tap confirm.

### 6. Add / edit form sheet
- **Name** (text, required)
- **Search Places** — calls Places Autocomplete. Selecting a result auto-fills address, lat/lng, city/state/country/neighborhood (from `address_components`), place_id, photo_reference, price_tier.
- **Tags** — tag input with existing-tag autocomplete (suggestions ranked by frequency).
- **Neighborhood** — populated from Places, but editable.
- **Notes** (textarea)
- **Source URL** — pre-filled if arriving via Share Target.
- **Visited** checkbox → reveals date picker.

Save → `values.append` (new) or `values.update` (edit).

---

## Add flows

### Flow 1: Manual add (tap +)
### Flow 2: Share Target (primary mobile flow, PWA-only)

`manifest.json`:
```json
"share_target": {
  "action": "/",
  "method": "GET",
  "params": { "title": "title", "text": "text", "url": "url" }
}
```

On load, parse `?title=...&url=...` — if present, open the add form pre-filled. User only needs to add tags and save.

Share Target only works when the PWA is installed to the iOS home screen. Browser-open won't show up in the Share Sheet. First-run includes an "Add to Home Screen" tip with visual instructions.

### Google Takeout import — out of scope for v1

---

## Navigation

Bottom tab bar: `List · Map · Nearby · +`. No routing library — a single `showView(name)` that toggles `.hidden` on panes and writes to `location.hash` so back button works.

---

## UI direction

### Palette (light mode)
| Role | Value |
|---|---|
| Background | `#F5F1EC` (warm cream) |
| Surface | `#FFFFFF` |
| Text primary | `#1F1E1D` |
| Text muted | `#6B655C` |
| Accent | `#D97757` (terracotta) |
| Accent soft | `#EDCFBE` |
| Success (visited) | `#7A9B76` (sage) |
| Border | `#E6E0D7` |

### Palette (dark mode) — via `prefers-color-scheme`
| Role | Value |
|---|---|
| Background | `#1A1917` |
| Surface | `#262420` |
| Text primary | `#F5F1EC` |
| Text muted | `#A8A199` |
| Accent | `#E89B7F` |
| Success | `#92B28B` |
| Border | `#3A3732` |

### Type
- UI: Inter 400/500/600
- Display (detail-sheet heading, sign-in title, empty states): Instrument Serif

### Motion
- Detail sheet enter: 280ms `cubic-bezier(0.34, 1.56, 0.64, 1)` (gentle overshoot)
- Tab switch: cross-fade, 160ms
- Tap feedback: `:active { transform: scale(0.97) }` on all buttons

### Icons
Phosphor via CDN. Use `ph` (regular) and `ph-fill` (filled) on `<span>` tags.

---

## PWA

`manifest.json`: name, short_name, start_url, display standalone, theme_color, icons (192 + 512), share_target.

`sw.js`: caches the app shell (HTML, CSS, JS, Leaflet CSS/JS from CDN) on install. `fetch` handler is cache-first for shell, network-only for Sheets/Drive/Places API calls (never cache API responses). Bumps `CACHE_NAME` on every deploy — old caches purged on activate.

---

## Setup checklist (admin, one-time)

See [README.md](README.md). Short version:

1. Create GCP project.
2. Enable: Sheets API, Drive API, **Places API (New)** (not the legacy "Places API" — the New one supports browser CORS and is what new GCP projects can enable).
3. Create OAuth 2.0 Client ID (Web App) — add GitHub Pages URL as authorized JS origin.
4. Create an API Key — restrict to HTTP referrer of the GitHub Pages URL + to Places API only.
5. Drop both into [config.js](config.js).
6. Push to a GitHub repo named `pins`. Enable Pages serving from `main` root.
7. Create a template sheet with the header row. Save as "PlaceTracker - Template".

---

## Onboarding a new user (admin action, per user)

1. Duplicate the template sheet in your Drive.
2. Rename to `PlaceTracker - <user first name>`.
3. Share with the user's Google email (editor).
4. Send them the app URL.

That's it. They sign in, the Drive lookup finds their sheet, data loads.

---

## What PWA updates look like

When you push to `main`, GitHub Pages redeploys in ~1min. The service worker version string bumps on each build, so the next time the PWA is opened it fetches the new shell and swaps it in. A small "Updated ✓" toast appears on the next launch after a version change. No user action required.

## Chrome on desktop / other devices

The app is just a URL — any logged-in browser works. Data syncs because it lives in the Sheet, not locally. The iOS PWA and Chrome desktop are separate *installs* (own localStorage, own service worker), but since they both read the same sheet, they see the same data. Only the iOS home-screen install gets the Share Target integration.

---

## Out of scope for v1

- Google Takeout import (post-v1 migration helper).
- Offline add queue.
- User-uploaded photos (Places photos only).
- Cross-user sharing of lists.
- In-app admin view / user switcher.
- Android-specific polish.

## Constraints

- No npm, no bundler, no build step.
- No backend.
- No framework (vanilla JS only).
- OAuth token in `sessionStorage` only (never localStorage).
- All filtering is in-memory against `window.places` — API calls only on load, add, edit, delete.
- Never store Places photos on disk — always fetched fresh via URL (browser cache handles re-use).
- Keep app JS under 50kb uncompressed, excluding Leaflet.

---

## Success looks like

Partner opens Pins on her iPhone home screen. Sign-in is one tap (cached session). Her places appear. She taps "Nearby" — 4 places within 1km, sorted by distance, tags visible. She taps one, reads her notes, taps "Directions" → Google Maps navigation. Later, scrolling Instagram, she sees a restaurant → Share → Pins → tags `dinner, date-night` → Save. It appears in her list immediately.
