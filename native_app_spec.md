# Pins — Native iPhone App Spec

A forward-looking spec for what a native SwiftUI version of Pins would look like, and an honest accounting of the trade-offs vs. the current PWA.

---

## Why consider going native

The PWA works, but three things would meaningfully improve with a native app:

1. **Real share sheet integration** — the current iOS Shortcut workaround works but requires one-time setup per device; native apps appear in the share sheet automatically.
2. **Push notifications** — a friend adds a place, you see it immediately.
3. **Richer iOS integrations** — Widgets, Lock Screen widgets, Siri Shortcuts, App Clips for onboarding.

Everything else (map, filtering, nearby, add/edit) works fine in the PWA today.

---

## Architecture

| Layer | Choice | Notes |
|---|---|---|
| UI | SwiftUI | Matches the current app's card/sheet/tab structure cleanly |
| Database | CloudKit (CKRecord + shared zones) | Free, Apple-managed, no GCP setup |
| Auth | None / Sign in with Apple | iCloud identity is implicit; no OAuth flow |
| Maps | MapKit | No API key, native clustering, satellite free |
| Places search | MKLocalSearch + MapKit geocoding | Slightly thinner than Google Places (see cons) |
| Optional enrichment | Google Places API (New) | Keep GCP only for metadata richness if needed |
| Hosting | App Store | $99/year Apple Developer account |

---

## Data model (CloudKit)

CloudKit replaces Google Sheets. Each record type maps to the current sheet schema.

**`Place` record type**

| Field | Type | Notes |
|---|---|---|
| `id` | String | UUID, same as current |
| `name` | String | |
| `address` | String | |
| `city` | String | |
| `state` | String | |
| `country` | String | |
| `neighborhood` | String | User-overridable |
| `location` | CLLocation | Native lat/lng |
| `tags` | [String] | Array, not comma-separated |
| `notes` | String | |
| `visited` | Bool | |
| `visitedDate` | Date? | |
| `sourceURL` | URL? | |
| `placeID` | String? | Google or Apple place identifier |
| `photoReference` | String? | For Places API photo lookup |
| `priceTier` | Int? | 1–4 |
| `addedDate` | Date | |

**Multi-user model**

The current app gives each user their own Google Sheet; admin owns all of them. With CloudKit, each user owns their own private CloudKit database. The admin creates a shared `CKRecordZone` and invites friends by Apple ID — same conceptual model, half the moving parts. Apple handles the sharing UI natively (same flow as shared Notes/Reminders).

---

## Views

All current views carry over 1:1. SwiftUI equivalents are straightforward.

### List
`LazyVStack` of place cards. Sort picker (Newest / Nearest / A–Z). Pull-to-refresh syncs CloudKit. Same card design: name, neighborhood chip, tag pills (max 3 + overflow), visited badge, distance.

### Filter bar + drawer
Persistent above list. Multi-select tags (AND logic), visited tri-state, neighborhood, city. State persists in `@AppStorage`. Shareable deep links via Universal Links.

### Map
`Map` (MapKit SwiftUI). Custom `Annotation` views matching current coral/sage color scheme. Clustering via `MapCluster`. User location dot built in. Filters apply to visible annotations.

### Nearby
Same auto-expanding radius logic (1km → 3km → 10km). `CLLocationManager` for live location. Distance + walk-time estimate. Respects active filters.

### Detail sheet
`.sheet` or `.navigationDestination`. Hero photo if available (`AsyncImage`). Name in Instrument Serif (custom font). Neighborhood + city chips. Tag pills. Inline notes edit. Visited toggle + date picker. Source URL as `Link`.

Actions:
- **Directions** → `MKMapItem.openMaps(launchOptions:)` (Apple Maps) or deep link to Google Maps
- **Edit** → form sheet
- **Delete** → two-tap confirm (`.confirmationDialog`)

### Add / edit form
`NavigationStack` form. Name field, place search (`MKLocalSearchCompleter` for autocomplete → auto-fills location/address/city). Tags field with existing-tag suggestions. Notes, source URL, visited toggle. Save writes a `CKRecord` and pushes to CloudKit.

### Share extension
Replaces the PWA share target. A native Share Extension appears in the iOS share sheet for any app. Receives URL → opens the add form pre-filled. No shortcut setup required for any user.

---

## Auth and sharing

**Single-user (simplest path):** No auth UI at all. App reads/writes the current iCloud account's private CloudKit database. Works out of the box for personal use.

**Multi-user (current invite model):** Admin creates a shared `CKRecordZone` in their CloudKit container. Invites friends by Apple ID via `UICloudSharingController` — Apple's native sharing sheet handles the whole flow. Friends accept via a link (same as accepting a shared Note). Once accepted, their app sees the shared zone alongside their own. Admin can revoke access the same way.

No GCP project. No OAuth scopes. No Picker. No `localStorage` sheet-id cache.

---

## Places search options

Two paths, pick one or combine:

**Option A — MKLocalSearch only (zero external dependencies)**
- `MKLocalSearchCompleter` for autocomplete while typing
- `MKLocalSearch` for place details (address, coordinates)
- Loses: rich photos, price_tier, neighborhood granularity, global coverage depth
- Gains: no API key, no billing, no quota

**Option B — Keep Google Places API for enrichment**
- Use MKLocalSearch for the map; call Google Places API (New) on place selection to backfill photo reference, price_tier, neighborhood
- One GCP project, one API key, restrict to Places API (New) only
- Same quota/billing setup as current app, but scoped to one purpose

Option B is the right call if metadata richness matters. The Places API cost is negligible at this scale (effectively $0 for <5 users).

---

## What gets better vs. the PWA

| Thing | PWA today | Native |
|---|---|---|
| Share sheet | Custom Shortcut (one-time setup) | Appears automatically in every app |
| Push notifications | None | Full APNs — friend adds a place, you're notified |
| Widgets | None | Home Screen + Lock Screen widgets (e.g. nearest unvisited place) |
| Auth/onboarding | GCP + OAuth + Drive + Picker flow | CloudKit zone share via Apple ID — same as shared Notes |
| Offline writes | Fails with a toast | CloudKit queues writes and syncs when online |
| App icon badge | No | Can badge with unread count |
| Iteration speed | Push to main → live in 60s | TestFlight → App Store review (days for first release, hours for updates) |

---

## What gets worse or disappears

| Thing | PWA today | Native |
|---|---|---|
| Desktop / web access | Works in any browser | iOS only (unless a web companion is built separately) |
| Iteration speed | Push → live in 60 seconds | App Store review pipeline |
| Deploy cost | Free (GitHub Pages) | $99/year Apple Developer account |
| Places metadata richness | Google Places API (New) — very rich | MKLocalSearch — decent but thinner (unless Option B above) |
| Google Maps friends | Only need a Google account | Need an Apple ID and iCloud |

---

## Lift estimate

| Phase | Work | Estimate |
|---|---|---|
| Project setup + CloudKit schema | Xcode project, entitlements, CKRecord types | 1–2 days |
| Data layer | CloudKit CRUD, sync, offline queue | 3–5 days |
| List + filter views | SwiftUI cards, filter drawer, sort | 3–4 days |
| Map view | MapKit, annotations, clustering | 2–3 days |
| Nearby view | CLLocationManager, radius logic | 1–2 days |
| Detail + add/edit sheets | Forms, photo loading, directions | 3–4 days |
| Places search | MKLocalSearch completer + optional Places enrichment | 2–3 days |
| Share extension | Native share sheet target | 1–2 days |
| Multi-user / CloudKit sharing | CKRecordZone + UICloudSharingController | 2–3 days |
| App Store submission | Screenshots, metadata, review | 3–5 days (first time) |
| **Total** | | **~3–5 weeks** |

Assumes comfortable with Swift/SwiftUI. Add 2–3 weeks if learning from scratch.

---

## Recommendation

The PWA is punching above its weight for a 5-person tool. The Shortcut workaround is annoying once but then invisible. Nothing about the current experience is broken.

Go native if:
- You want to give this to more people and the onboarding friction matters
- You want the share sheet to just work, no shortcut setup
- You want push notifications or widgets
- You want this to feel first-class on iPhone, not "a website with a good icon"

Stay PWA if:
- It's staying at ≤5 close friends who will tolerate the shortcut setup
- You want to keep iterating quickly without an App Store pipeline
- You want web access from desktop to remain

A middle path worth considering: keep the PWA as-is for now, and revisit native when/if you want to open it to more people.
