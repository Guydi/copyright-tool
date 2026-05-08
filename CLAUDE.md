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
| `index.html` | Full UI — 4 screens: setup → progress → review → summary |

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
6. On completion → state saved to localStorage, then **summary screen** shown
7. User can navigate back to review screen to edit; sidebar lets user reload any past run directly into review
8. User downloads CSV from review screen or summary screen

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

Note: `שם קובץ` and `קבצים נוספים` remain in `reviewState.rows` and visible in the review table — they are excluded from the CSV export only.
The review table column header and all JS references use `שם פריט`; only the CSV output header is `item`.

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
- Layout: collapsible sidebar on CSS-right, default **closed** (36px strip); opens to 220px on click
  - Toggle strip shows "פרויקטים קודמים" label rotated vertically
  - Logo (©) + tool name live in the **steps-bar** (right side), not the sidebar
  - `.main-area` uses `margin-right: var(--sidebar-w-closed)` when closed, `var(--sidebar-w)` when open
  - `body.sidebar-open` class drives `.review-actions-bar` right offset
- Steps bar: `position: sticky; top: 0; height: var(--steps-h)` inside `.main-area`, spans main content area
  - Future step: hollow circle, `#ccc` border, white fill
  - Active step: green filled circle (`--success`)
  - Done step: solid black filled circle (`--ink`)
- "חיפוש חדש" button in sidebar: ghost style (no fill, muted color, font-weight 400)
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

### Screen 3: Review
Full-width layout. Two sections:

**Issues panel (top, scrollable, max 38vh):**
Collapsible cards in fixed order:
1. לא זוהה (danger) — no source found
2. נדרש שם פריט (warn) — item name is raw stem fallback
3. כפילויות אפשריות (warn) — potential duplicate groups with merge/dismiss UI
4. רישיון לא מזוהה (danger) — unrecognized license string
5. הערות (muted) — notes from processing, dismissible with "הבנתי"
6. תקין (success) — all resolved, always shown, starts collapsed

**Editable table (bottom, scrollable):**
Columns: thumbnail | שם פריט | שם קובץ [🔍] | מקור | קישור | סוג זכויות | קרדיט? | איך לרשום | מסחרי? | חיצוני? | קבצים נוספים

- Thumbnails: priority order — (1) local blob URL from `fileObjectMap`, (2) `_thumbnailUrl` from API response, (3) placeholder icon
- שם קובץ has a 🔍 icon linking to Google Image Search
- קישור shown as "פתח ↗" link; double-click to edit raw URL
- Constrained fields use `<select>` dropdowns on click (not free-text input): **סוג זכויות היוצרים** (6 canonical values), **יש צורך במתן קרדיט?** (כן/לא), **מותר לשימוש מסחרי?** (מותר/אסור), **מותר לשימוש חיצוני?** (מותר/אסור)
- Other cells are click-to-edit (input or textarea)
- Rows sorted: unresolved issues first (by status order), then a separator row, then תקין rows
- Row border-right indicates severity: danger color for לא זוהה/רישיון לא מזוהה, warn color for others

**Fixed actions bar (bottom of viewport):**
- הורד CSV — downloads reviewed CSV from JS state
- סיים → — transitions to summary screen
- Monday.com import instructions (collapsible accordion, opens upward)

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
}
```

Key functions:
- `computeStatus(row, dupeGroups, notedItems)` — pure function, re-derives status from row data
- `renderReview()` — calls `recomputeAllStatuses()`, then `renderIssuesPanel()` and `renderTable()`
- `buildCSV()` — generates UTF-8 BOM CSV string from `reviewState.rows` (public columns only)
- `downloadBlob(text, filename)` — triggers browser download
- `renderCreditsCard()` — builds the credits copy box on the summary screen

---

## Persistent sidebar (previous runs)

A fixed 220px sidebar on the CSS-left edge shows all runs saved in localStorage.

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

**Serialization rules:**
- Strip `blob:` URLs from `_thumbnailUrl` (local object URLs are session-only)
- Keep all other `_thumbnailUrl` values (regular https URLs from APIs)
- `notedItems` (Set) serialized as array, restored as `new Set()`
- Wrap every `localStorage.setItem()` in try/catch; on `QuotaExceededError` show inline warning in sidebar

**Sidebar behavior:**
- "טען" button: restores `reviewState`, navigates directly to review screen (`showScreen('screen-review')`)
- "מחק" button: removes that single run, re-renders sidebar
- "מחק הכל" button: clears `copyright_tool_runs` from localStorage entirely
- Active/loaded run highlighted with `run-entry.active` class (`activeRunId` JS variable)
- Runs are saved automatically after each search completes (`saveRun(reviewState)` called right after `initReview`)

---

## Steps bar

A horizontal `<div class="steps-bar">` with `position: sticky; top: 0; height: var(--steps-h)` (44px) inside `.main-area`, visible on all 4 screens. Steps display LTR (`direction: ltr`):

`① בחירת תמונות → ② חיפוש → ③ עריכה → ④ סיכום`

- **Active step**: `.step.active` — blue filled pill, bold
- **Done steps**: `.step.done` — success green, bold  
- **Future steps**: `.step` (unstyled) — muted gray
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
