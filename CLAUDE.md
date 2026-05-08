# Copyright Lookup Tool — Project Briefing

## What this is
A fully static single-page application that accepts a list of image filenames, looks up their copyright information from online archives, and generates a CSV ready to import into Monday.com.

Built for the Dean's office for Teaching and Learning Innovation at Tel Aviv University, for use by learning developers who produce academic online courses.

**No server required.** The app runs entirely in the browser and can be hosted on GitHub Pages, Netlify, or opened as a local file.

---

## How to run
Open `index.html` directly in a browser, or serve the folder with any static file server:
```
npx serve .
# or
python -m http.server 8000
```
(A local server is only needed if you hit CORS issues opening `file://` directly.)

---

## Architecture

| File | Role |
|---|---|
| `lookup.js` | All lookup logic — ES module. Filename analysis, archive API calls, license normalization, item name generation, duplicate detection, batch processor |
| `index.html` | Full UI — 4 screens: הכנה → חיפוש → עריכה → סיכום (queue-based review) |

### Removed Python files
The following files were deleted when the app was converted to a static SPA:
- `app.py` — Flask server
- `lookup.py` — Python lookup engine (fully replaced by `lookup.js`)
- `run.bat`, `run.sh` — launcher scripts
- `install.bat` — pip installer
- `templates/index.html` — Jinja template (replaced by static `index.html`)

### Flow
1. User selects a folder via `<input type="file" webkitdirectory>` and/or types filenames manually — both feed into the **file entries list**
2. Non-image files are automatically marked as invalid (strikethrough, red border, error message) and excluded from processing — they do not block the search button
3. A summary bar above the list shows total count + skipped count; a "הסר ידולגו" button removes all invalid entries at once
4. User clicks Search → only valid entries are passed to `processFilenames()` in `lookup.js`
5. UI updates live via `onProgress` callback
6. On completion → state saved to localStorage, then **queue screen** (screen 3) shown
7. User reviews items card by card in the queue; sidebar lets user reload any past run directly into the queue
8. User clicks "דלג לסיכום ←" or resolves all items → navigates to summary screen
9. User downloads CSV from queue header or summary screen

---

## Archive sources

| Source | Method | Status |
|---|---|---|
| Wikimedia Commons | API (exact title match → full-text search fallback) | ✅ Working |
| Library of Congress | API (full-text search) | ✅ Working |
| Pexels | Photo ID extracted from filename | ✅ Working |
| Shutterstock | Photo ID extracted from filename, link auto-generated | ✅ Stub — no full API |
| Artvee | No public API | ❌ Not implemented |
| NPS (National Park Service) | UUID-based filenames, no API | ❌ Not implemented |

Both Wikimedia and LOC APIs support CORS. Wikimedia requires `&origin=*` on all requests.

---

## lookup.js module

ES module (`<script type="module">`). No external dependencies.

### Public exports
```js
import {
  processFilenames,       // main batch entry point
  analyzeFilename,        // single filename analysis
  findDuplicates,         // group by canonical stem
  findPotentialDuplicates,// confirmed + potential dupe groups
  normalizeLicense,       // raw license string → label + flags
  lookupImage,            // single image lookup (async)
  IMAGE_EXTENSIONS,       // array of supported extensions
  stripHtml,              // HTML tag/entity stripper
  formatAttribution,      // build attribution string
  makeItemName,           // choose display name for an item
} from './lookup.js';
```

### Key function signatures
```js
// Analyze a filename, return stem/sourceHint/notes/isDerivative/canonical
analyzeFilename(filename) → { stem, sourceHint, notes, isDerivative, canonical }

// Normalize a raw license string
normalizeLicense(raw) → { label, requiresCredit, commercialOk, externalOk, isUnknown }

// Look up a single image (async)
await lookupImage(filename, enabledSources)
  → { 'שם פריט', 'שם קובץ', ..., _notes, _found, _source, _unknownLicense, _isRawFilename }

// Batch process all filenames (async)
await processFilenames(filenames, enabledSources, onProgress)
  → { results: [...], summary: { total, found, notFound, bySource, flagged,
                                  unknownLicenses, potentialDuplicates, needsItemName } }
```

---

## Filename intelligence (lookup.js)

The tool pre-processes filenames before searching:

- **Known source prefixes stripped:** `loc_`, `artvee_`, `wellcome_`, `shutterstock_`, `pexels-`
  - The prefix is used as a source hint, then removed from the search query
- **Resolution prefixes stripped:** e.g. `1920px-`
- **Derivative detection:** files ending in `_cropped`, `_crop`, `(cropped)`, `_edited`, `_resized`, `_(2)`, etc. are identified as derivatives of their canonical original
  - Only the canonical is looked up; derivatives are merged into the canonical row via the `קבצים נוספים` column
- All of the above are reported in notes

### Item name generation — `makeItemName(title, stem, maxLen=60)`

Returns `{ itemName, isRawStem }`:
- If `title` is non-empty and meaningfully different from the stem (not just underscores-replaced-with-spaces), returns the title truncated at last word boundary before 60 chars.
- Otherwise returns the cleaned stem (underscores → spaces, stripped), also truncated.
- `isRawStem` is `true` when no real title was found — used to flag items needing manual name entry.

---

## Duplicate handling

### Confirmed derivatives
Files that match `DERIVATIVE_PATTERNS` (e.g. `_cropped`, `_edited`) are merged into their canonical row:
- Canonical file's data is used for the row
- `קבצים נוספים` column lists the derivative filenames

### Potential duplicates — `findPotentialDuplicates(filenames)`
Files NOT confirmed as derivatives but sharing a common prefix of ≥ 8 characters (after stripping source/resolution prefixes, lowercasing, normalizing punctuation) are flagged as potential duplicates.
- Groups are computed transitively (if A~B and B~C, all three are in one group)
- Returned in `summary.potentialDuplicates` as arrays of filenames
- Surfaced in the review screen's "כפילויות אפשריות" issues panel
- User can **merge** (combine rows) or **dismiss** (keep separate)

---

## License normalization

All license strings are normalized to exactly these 6 canonical labels:
- `Public Domain` — CC0, "public domain", "no copyright"
- `No known copyright restrictions` — "no known copyright restrictions", "no restrictions"
- `CC BY` — all CC BY versions (2.0, 3.0, 4.0, or unversioned) collapse to this single label
- `CC BY SA` — all CC BY-SA versions (2.0, 3.0, 4.0, or unversioned) collapse to this single label
- `Royalty free` — Shutterstock, Pexels, "royalty free"
- `C` — all rights reserved, "©", "copyright"

If a license string can't be mapped → kept as-is, flagged in summary as "unknown license".

The **normalized label** is used for `'סוג זכויות היוצרים'` (review table + CSV).
The **raw API license string** (e.g. `CC BY-SA 2.0`, `CC BY 4.0`) is used for `'איך לרשום את הקרדיט?'` — so the credit attribution preserves the exact version from the source.

---

## CSV output columns

| CSV header | Internal key | Notes |
|---|---|---|
| `item` | `שם פריט` | Item name — Monday.com auto-detects this as the item name column (FIRST column) |
| `מקור` | `מקור` | Archive name |
| `קישור למדיה במקור` | `קישור למדיה במקור` | URL to source page |
| `סוג זכויות היוצרים` | `סוג זכויות היוצרים` | Normalized license label |
| `יש צורך במתן קרדיט?` | `יש צורך במתן קרדיט?` | כן / לא |
| `איך לרשום את הקרדיט?` | `איך לרשום את הקרדיט?` | `[title], by [author], under [raw license], via [source]` |
| `מותר לשימוש מסחרי?` | `מותר לשימוש מסחרי?` | מותר / אסור |
| `מותר לשימוש חיצוני?` | `מותר לשימוש חיצוני?` | מותר / אסור |

Note: `שם קובץ` and `קבצים נוספים` remain in `reviewState.rows` and visible in the queue cards — they are excluded from the CSV export only.
All JS references use `שם פריט`; only the CSV output header is `item`.

CSV is generated client-side with UTF-8 BOM so Hebrew displays correctly in Excel and Monday.com.

---

## UI design

- Language: Hebrew, RTL
- Font: Heebo (sans) + DM Mono (filenames/paths)
- Style: clean, minimal — white cards on `#f5f5f3` background; **black/white with single green accent** (no blue)
  - `--ink: #111111` — primary interactive/active color
  - `--ink-light: #f0f0f0` — tinted backgrounds (replaces old accent-light)
  - `--success: #1a9e6e` — positive actions (search/download buttons, active step, found items, progress bar)
  - `--danger: #dc2626` — errors, not-found items
  - Blue (`--accent`) has been removed entirely
- 4 screens managed by JS show/hide, no routing library
- Layout: always-visible 200px sidebar on the CSS-right; hidden below 900px (`@media (max-width: 900px)`)
  - No burger button; no collapsible behavior
  - Logo (©) + tool name live in the **steps-bar** (far right in RTL), always visible
  - Body structure: `<steps-bar>` → `<app-body>` (flex row) → `<sidebar>` + `<main-area>`
  - `.app-body { display: flex; height: calc(100vh - var(--steps-h)); overflow: hidden; }`
  - `.main-area { flex: 1; overflow-y: auto; }` — content scrolls inside main-area
- Steps bar: `position: sticky; top: 0; height: var(--steps-h)` — direct child of `<body>`, above `.app-body` — **4 steps**: הכנה → חיפוש → עריכה → סיכום
  - Future step: hollow circle, `#ccc` border, white fill
  - Active step: green filled circle (`--success`)
  - Done step: solid black filled circle (`--ink`)
- Sidebar top section:
  - "חיפוש חדש" button: ghost style (no fill, muted color, font-weight 400, 1px border, full width minus 16px margin)
  - Save indicator strip (`#save-indicator`, min-height 22px): shows "שומר..." → green dot + "נשמר" → fades out; triggered by project name / source / file changes
- `.queue-header { top: 0 }` — was `top: var(--steps-h)`, changed because steps-bar is now outside `.main-area`'s scroll context
- Summary screen: `#screen-summary .shell { padding-top: 20px }` to prevent excess top gap
- All archive calls use fetch() with proper error handling

---

## 4-screen flow

### Screen 1: Setup
User builds a file list and selects archive sources.

**Input model:**
- **Folder picker** (`webkitdirectory`): imports ALL files from the selected folder. Valid image files (matching `IMAGE_EXTENSIONS`) are added normally; non-image files are added as invalid (strikethrough, red border, `entry.invalid = true`). Can be used multiple times.
- **Manual text inputs**: user types filenames one per input. On blur, extension is validated — missing extension or unsupported type marks the entry invalid with an inline error message.
- **Invalid files** are excluded from `getSearchFilenames()` and `processFilenames()` — they never block the search button. A compact summary bar above the list shows `N קבצים • M ידולגו [הסר ידולגו ×]`; the "הסר ידולגו" button calls `removeInvalidEntries()`.
- File objects (for local thumbnails) are tracked in `fileObjectMap` only for valid files from folder picker. Manual entries and invalid entries have `file: null`.

### Screen 2: Progress
Live feed shows results as they arrive via `onProgress` callback from `processFilenames()`. New items animate in with a slide-down fade (`live-item-in` keyframe).

### Screen 3: Carousel review (`#screen-review`)
Single-card carousel — one card at a time, centered, viewport-height constrained. No scrolling.

**Sticky header bar** (below steps bar):
- Counter: `N פריטים  •  M ממתינים לסימון` — updates live as items are stamped
- When all stamped and no unresolved dupes: `הכל תקין ✓` (green)
- Button: "דלג לסיכום ←" only — "הורד CSV" has been removed from this screen (summary screen only)

**Layout:**
- `.queue-stage` — `height: calc(100vh - var(--steps-h) - 52px - 60px)`, max-width 780px, centered
- `.rq-card` — `flex: 1; min-height: 0; flex-direction: column`; two-column body + action bar at bottom
- `.rq-nav` — 60px row below the stage: → arrow | dots | ← arrow (direction: ltr)

**Carousel order:** unresolved dupe cards first → flagged item cards → clean item cards

**Duplicate cards** (appear first in carousel, same `.dupe-card` layout):
- Two-panel side-by-side: thumbnail + filename per file
- "כפילות אפשרית?" title
- "מזג ←" (calls `mergeRows`, marks group resolved, removes from carousel) / "השאר נפרד" (marks resolved, removes card)

**Item cards** (`.rq-card`):
- **Right column** (`.rq-col-source`, 38%, `var(--ink-light)` bg):
  - Label "מקור" (small caps, muted)
  - Source thumbnail box: aspect-ratio 4/3; local blob if available, else "no available image" placeholder
  - Filename: 13px monospace (`var(--mono)`), `direction: ltr`, `word-break: break-all`, centered
  - Google Images link (🔍 חפש ב-Google Images)
- **Left column** (`.rq-col-result`, flex 1, `overflow-y: auto`):
  - Label "תוצאה" (small caps, muted)
  - API thumbnail: aspect-ratio 16/9; image if `_thumbnailUrl`, else "צפה בתמונה במקור ↗" link, else placeholder
  - 8 editable fields (all `background: #fff` — white, not gray): שם פריט, מקור, קישור, סוג זכויות, קרדיט?, נוסח קרדיט, מסחרי?, חיצוני?
  - ⚠ icon next to uncertain fields: שם פריט when `_isRawFilename`, סוג זכויות when `_unknownLicense`
  - Notes in red inline below fields (`.rq-field-note`)
  - "↺ איפוס לנתוני המקור" — text button, restores fields from `row._originalData`
- **Action bar** (`.rq-card-actions`, always visible at bottom of card):
  - "✓ תואם" (green, flex 1) — sets `row._stamp = 'תואם'`, auto-advances after 350ms
  - "✕ לא תואם" (red tint, flex 1) — sets `row._stamp = 'לא תואם'`, auto-advances after 350ms
  - "איפוס" (ghost) — resets stamp to null only (not field values)
- **Stamp corner**: absolute-positioned circle (top-left of card) — green ✓ for תואם, red ✕ for לא תואם; `pointer-events: none`

**Navigation row** (`.rq-nav`):
- → arrow (`#rq-arrow-prev`) — goes to lower index; disabled at start
- Pagination dots (`.rq-dot` per item): hollow = unstamped, filled black = active, green = תואם, red = לא תואם; clicking navigates directly
- ← arrow (`#rq-arrow-next`) — goes to higher index; disabled at end

**`_stamp` field** (replaces old `_reviewed`):
- `null` — not yet stamped
- `'תואם'` — user confirmed this card
- `'לא תואם'` — user flagged this card
- Persisted in localStorage via `saveRun()` (not deleted); backfilled as `null` in `loadRunById()` for old saved runs

**`_originalData` snapshot:**
Set once in `initReview()` as a shallow copy of each row after all fields are populated. Excluded from CSV output and localStorage serialization (deleted in `saveRun()`). Backfilled as `{...row}` in `loadRunById()` for old saved runs.

### Screen 4: Summary
Horizontal segmented bar (found/not-found), source breakdown, flagged item counts. CSV download button is full-width.

**Segmented bar** (replaces old stat boxes):
- Full-width bar, 12px height, rounded ends; left segment = green (found), right segment = red (not found), proportional via `style.flex`
- Labels below: `לא זוהו N` (red, left) and `נמצאו N` (green, right); total count centered above
- Driven by `buildSummary()` which sets `seg-bar-found`, `seg-bar-nf`, `seg-label-found`, `seg-label-nf`, `seg-bar-total`

- **"פריטים הדורשים תיקון" card** — shown only when issues exist; contains the issue count list and the "עריכת פריטים" button (`btn-go-review`) which navigates back to the review screen. Button is disabled (and card hidden) when there are no issues.
- **"קרדיטים להעתקה" card** — always shown. Collects rows where `'יש צורך במתן קרדיט?' === 'כן'` and displays their attribution strings in a `<textarea readonly>` with an "העתק הכל" button (uses `navigator.clipboard.writeText`, changes label to "✓ הועתק" for 2s). If no rows require credit, shows a muted message instead.
- **"הורד CSV"** — full-width green button below the cards; generates CSV from current `reviewState`.

---

## Item status machine

Each row has exactly one active status — the earliest unresolved one in this order:

```
לא זוהה → נדרש שם פריט → כפילויות אפשריות → רישיון לא מזוהה → הערות → תקין
```

Resolution conditions:
- **לא זוהה**: resolved when מקור and סוג זכויות היוצרים are filled
- **נדרש שם פריט**: resolved when שם פריט is edited to differ from raw stem
- **כפילויות אפשריות**: resolved per-group when user clicks מיזוג or השאר נפרד
- **רישיון לא מזוהה**: resolved when סוג זכויות היוצרים is changed to a recognized value
- **הערות**: resolved when user clicks "הבנתי" in the panel

---

## Review screen JS architecture

```javascript
const reviewState = {
  rows: [],          // array of row objects
  dupeGroups: [],    // [{files: [...], resolved: false}]
  notedItems: new Set(),
  rawStems: {},      // filename -> original raw stem for comparison
};
```

**Row object shape** (from `lookupImage` / `processFilenames`):
```javascript
{
  'שם פריט': '',
  'שם קובץ': '',
  'מקור': '',
  'קישור למדיה במקור': '',
  'סוג זכויות היוצרים': '',
  'יש צורך במתן קרדיט?': '',
  'איך לרשום את הקרדיט?': '',
  'מותר לשימוש מסחרי?': '',
  'מותר לשימוש חיצוני?': '',
  'קבצים נוספים': '',
  _isRawFilename: true/false,   // note: was _item_name_is_raw in Python version
  _unknownLicense: true/false,  // note: was _unknown_license in Python version
  _notes: [],
  _found: true/false,
  _status: 'לא זוהה' | 'נדרש שם פריט' | 'כפילויות אפשריות' | 'רישיון לא מזוהה' | 'הערות' | 'תקין',
  _thumbnailUrl: '',            // https URL from API (Wikimedia thumburl, LOC image_url); empty for Pexels/Shutterstock
  _stamp: null,                 // null | 'תואם' | 'לא תואם' — set by carousel action buttons
  _originalData: {...},         // shallow copy set at initReview time; used by reset button; excluded from CSV + localStorage
}
```

Key functions:
- `computeStatus(row, dupeGroups, notedItems)` — pure function, re-derives status from row data
- `renderQueueScreen()` — calls `recomputeAllStatuses()`, resets `currentCardIdx=0`, then `renderCarousel()`
- `buildCarouselItems()` — returns ordered array `{type:'dupe'|'item', data, idx}` (dupes first, flagged items next, clean last)
- `renderCarousel()` — renders current card into `#queue-stage`, calls `renderCarouselNav()` + `attachCarouselListeners()`
- `renderCarouselItemCard(row)` — full HTML for one carousel item card (two-column layout, stamp, action buttons)
- `renderDupeCard(g)` — HTML for a duplicate group card (two panels, merge/keep buttons)
- `renderCarouselNav(items)` — renders dots + enables/disables arrows
- `navigateToCard(idx)` — sets `currentCardIdx`, re-renders carousel
- `advanceToNextUnstamped()` — after stamp click, finds next unstamped card and navigates; wraps around
- `attachCarouselListeners(items)` — wires all field/button/dot/arrow events for the current card
- `buildCSV()` — generates UTF-8 BOM CSV string from `reviewState.rows` (public columns only)
- `downloadBlob(text, filename)` — triggers browser download
- `renderCreditsCard()` — builds the credits copy box on the summary screen

---

## Persistent sidebar (previous runs)

Always-visible 200px sidebar on the CSS-right edge (RTL). Hidden below 900px breakpoint.

**Storage key:** `copyright_tool_runs` — JSON array of run objects:
```json
{
  "id": 1714000000000,
  "label": "12 קבצים — 26/04/2025",
  "state": {
    "rows":       [...],
    "dupeGroups": [{"files": [...], "resolved": false}],
    "notedItems": ["filename.jpg"],
    "rawStems":   {"filename.jpg": "filename"}
  }
}
```

**Draft run lifecycle:**
- Clicking "חיפוש חדש" calls `createDraftRun()` — creates an empty run in localStorage immediately with `label: ""`; sets `activeRunId`
- As user types in `#run-title`, the active run's label updates live in localStorage and re-renders the sidebar; `triggerSaveAnimation()` fires
- When search completes, `saveRun()` updates the existing draft run (matched by `activeRunId`) with results instead of creating a new one

**Run entry display:**
- Name: `.run-name` (font-size 12px, weight 500) — if empty shows "ללא שם" in italic muted style (`.run-name-unnamed`)
- Date: `.run-date` (font-size 10px, muted) — "היום" / "אתמול" / "D בMonth" via `formatRunDate(id)`
- Active badge: `.run-saved-badge` (green pill, font-size 9px) shown only on active run

**Serialization rules:**
- Strip `blob:` URLs from `_thumbnailUrl` (local object URLs are session-only)
- Keep all other `_thumbnailUrl` values (regular https URLs from APIs)
- `notedItems` (Set) serialized as array, restored as `new Set()`
- Wrap every `localStorage.setItem()` in try/catch; on `QuotaExceededError` show inline warning in sidebar

**Sidebar behavior:**
- Clicking a run entry (`.run-info`) loads that run; no separate "טען" button
- "מחק" (×) button per entry: removes that single run, re-renders sidebar
- "מחק היסטוריית חיפושים" button: clears `copyright_tool_runs` from localStorage entirely
- Active/loaded run highlighted with `run-entry.active` class and 1px border (`activeRunId` JS variable)
- `saveRun()` updates existing draft run if `activeRunId` matches an existing run; otherwise creates a new run

---

## Steps bar

A horizontal `<div class="steps-bar">` with `position: sticky; top: 0; height: var(--steps-h)` — direct child of `<body>`, above `.app-body`. Logo (©) + "בודק זכויות יוצרים" on the far right (RTL = `.steps-bar-logo` first in DOM). `.steps-bar-spacer` (180px) balances the layout on the left. Steps display LTR (`direction: ltr`):

`① הכנה → ② חיפוש → ③ עריכה → ④ סיכום`

- **Active step**: green filled circle (`--success`), bold
- **Done steps**: solid black filled circle (`--ink`), bold
- **Future steps**: hollow circle, `#ccc` border — muted
- Not interactive — clicking a step does not navigate
- Updated by `updateStepsBar(screenId)` called from `showScreen()`

Screen-to-step mapping: setup→1, progress→2, review→3, summary→4

---

## Two-source thumbnail strategy

Each row has a `_thumbnailUrl` field populated by `lookup.js` from API responses:
- **Wikimedia**: `info.thumburl` from `iiprop=url|extmetadata` + `iiurlwidth=300`
- **LOC**: `item.image_url` (may be array; take first element)
- **Pexels / Shutterstock**: empty string (no API call made)

In `renderTableRow`, thumbnail priority:
1. `getThumbnailUrl(fname)` — blob URL from `fileObjectMap[fname]` (folder picker files only)
2. `row._thumbnailUrl` — https URL from API
3. Placeholder (`<div class="cell-thumb-placeholder">🖼</div>`)

---

## Known issues / limitations

- Wikimedia full-text search sometimes returns false positives for short or ambiguous filenames
- LOC search can return unrelated items (e.g. `loc_Gypsy children of Macedonia.jpg` matched a book PDF)
- HTML tags sometimes appear in Wikimedia author fields — stripped with regex but edge cases exist
- Shutterstock: only generates a link from the ID, no license verification possible without paid API
- Artvee has no API — images from Artvee are typically Public Domain (sourced from museums) but cannot be auto-verified
- Thumbnails for manually-entered filenames rely on API thumbnail URLs (`_thumbnailUrl`); no thumbnail for Pexels/Shutterstock without a key

---

## Planned next steps

1. **Add Pexels API key support** — currently works without key (ID extraction), key gives richer metadata
2. **Add PPTX input** — extract images from a PowerPoint file using a JS library, feed into same pipeline
3. **Better LOC matching** — add confidence scoring to avoid false positives
4. **Monday.com direct push** — use Monday API to write rows directly instead of CSV import
5. **Artvee scraping** — scrape source page or identify underlying museum source and query their API

---

## Tech stack
- Vanilla JS (ES modules, no framework)
- fetch API for all archive calls
- No build step — edit and refresh
- No database — state held in JS during session
- Deployable as a static site (GitHub Pages, Netlify, etc.)

---

## Deployment

- Hosted on **GitHub Pages**
- Auto-deploys on every push to `main` via `.github/workflows/deploy.yml`
- Live URL: https://guydi.github.io/copyright-tool/
- After deploying, update the `[URL]` placeholder in `README.md` with the actual live URL
