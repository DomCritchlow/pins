# Pins

A small PWA for organizing saved places (restaurants, cafes, bars, things to do) with tags, filters, a map, and a "nearby now" view. Google Sheets is the database. GitHub Pages is the host. No backend, no build step.

Full spec: [build_plan.md](build_plan.md).

---

## One-time admin setup

Do this once. Users never need to touch any of it.

### 1. Create the Google Cloud project

1. Go to <https://console.cloud.google.com/> and create a new project (any name — e.g. "Pins").
2. In **APIs & Services → Library**, enable all three:
   - Google Sheets API
   - Google Drive API
   - **Places API (New)** — the tile is labeled "Places API (New)". The older "Places API" tile doesn't support browser CORS and can't be enabled on new projects anyway.

### 2. OAuth consent screen

1. **APIs & Services → OAuth consent screen**.
2. User type: **External**. Publishing status can stay "Testing" while your group is small — just add each user's Google email under **Test users**.
3. App name: `Pins`. User support email: yours.
4. Scopes to declare:
   - `.../auth/spreadsheets`
   - `.../auth/drive.metadata.readonly`

### 3. OAuth Client ID

1. **APIs & Services → Credentials → Create credentials → OAuth client ID**.
2. Application type: **Web application**.
3. Authorized JavaScript origins: add your GitHub Pages URL (e.g. `https://<your-username>.github.io`). If you plan to test locally, also add `http://localhost:8000`.
4. Copy the **Client ID** — you'll put it in `.env` (step 6), same as the API key.

### 4. API key (for Places Autocomplete)

1. **Credentials → Create credentials → API key**.
2. Restrict it:
   - **Application restrictions**: HTTP referrers → add `https://<your-username>.github.io/*` (plus `http://localhost:8000/*` for local testing).
   - **API restrictions**: select **Places API (New)** only.
3. Copy the key → you'll put it in `.env` (step 6), not directly in `config.js`. `config.js` is generated from `.env` and is gitignored so the keys never hit the repo.
4. **Cap the quota.** In **APIs & Services → Quotas & System Limits**, filter to Places API (New) and set a low daily cap on request-per-day metrics (500/day is plenty for 5 users). This is the primary guardrail: if the key is ever misused, you hit the cap and the app stops working for a day — you never get surprise-billed.
5. **Set a billing alert.** In **Billing → Budgets & alerts**, create a budget of $5/month with an email alert at 50% and 100%. Belt-and-suspenders alongside the quota cap.

### 5. Template sheet

1. Create a new Google Sheet. Rename the first tab to `places` (exactly that, lowercase).
2. Paste this header row into row 1 (tab-separated):

   ```
   id	name	address	city	state	country	neighborhood	lat	lng	tags	notes	visited	visited_date	source_url	place_id	photo_reference	price_tier	added_date	custom
   ```

3. Save. Name the file **`PlaceTracker - Template`** so you can duplicate it for each user.

### 6. Deploy (keys live in repo Secrets, never in git)

1. Create a repo named `pins` on GitHub and push this folder to `main`.
2. In the repo → **Settings → Pages** → set **Source** to **GitHub Actions**.
3. In the repo → **Settings → Secrets and variables → Actions → New repository secret**, add:
   - `PINS_CLIENT_ID` — the OAuth Client ID from step 3.
   - `PINS_API_KEY` — the API key from step 4.
   - `PINS_SHEET_NAME_PREFIX` — optional, defaults to `PlaceTracker`.
   - `PINS_ADMIN_CONTACT` — optional, shown on the "your sheet isn't set up yet" screen.
4. Push to `main` (or hit **Run workflow** on the Deploy action). The workflow in `.github/workflows/deploy.yml` reads the secrets, generates `config.js` in CI, and deploys the site to Pages.
5. Within ~1 minute the app is live at `https://<your-username>.github.io/pins/`.

The built `config.js` only exists in the Pages deployment artifact, not in the repo. Anyone who clones the repo sees `config.example.js` (placeholders) but not your keys.

---

## Onboarding a user

For each new user (including yourself):

1. In Drive, **Make a copy** of `PlaceTracker - Template`.
2. Rename the copy to `PlaceTracker - <their first name>` (the name just needs to start with `PlaceTracker`).
3. Click **Share** → add their Google email with **Editor** access. Uncheck "Notify people" if you don't want the email.
4. Send them the app URL. They tap "Sign in with Google", grant access, and their places load.

If they sign in and see the "Almost there" screen, you forgot step 3.

---

## Icons

`icons/icon-192.png` and `icons/icon-512.png` are already generated — a cream map-pin mark on terracotta, drawn programmatically to match the app palette. Replace them with your own PNGs at the same paths if you want something different.

---

## Updating the app

Push to `main`. GitHub Pages redeploys in ~1 minute. The service worker bumps its cache version on each deploy, so users see the new version the next time they open the PWA. No reinstall needed.

---

## Running locally

```sh
cp .env.example .env         # then edit .env with your real values
python3 scripts/build-config.py    # writes config.js
python3 -m http.server 8000
```

Open `http://localhost:8000/`. Make sure `http://localhost:8000` is in the OAuth origins list (step 3) and the API key's referrer list (step 4).

Both `.env` and `config.js` are gitignored, so you can't accidentally commit them. If you change `.env`, re-run `build-config.py` to regenerate `config.js`.

---

## What's in this repo

| File | Purpose |
|---|---|
| [index.html](index.html) | App shell |
| [style.css](style.css) | All styles (light + dark via `prefers-color-scheme`) |
| [config.example.js](config.example.js) | Placeholder committed template. Real `config.js` is generated from `.env` (local) or repo Secrets (CI). |
| [.env.example](.env.example) | Template for local `.env`. |
| [scripts/build-config.py](scripts/build-config.py) | Generates `config.js` from `.env` or process env. |
| [.github/workflows/deploy.yml](.github/workflows/deploy.yml) | GitHub Actions workflow — reads repo Secrets, builds `config.js`, deploys to Pages. |
| [util.js](util.js) | Shared helpers |
| [auth.js](auth.js) | Google Identity Services + Drive sheet resolution |
| [sheets.js](sheets.js) | Sheet CRUD |
| [places.js](places.js) | Places Autocomplete + Details + photo URLs |
| [maps.js](maps.js) | Leaflet setup and markers |
| [app.js](app.js) | Controller, state, rendering |
| [manifest.json](manifest.json) | PWA manifest + share_target |
| [sw.js](sw.js) | Service worker (shell caching) |
| [build_plan.md](build_plan.md) | Definitive spec |
