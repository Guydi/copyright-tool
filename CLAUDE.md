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
1. User selects a folder via `<input type="file" webkitdirectory>` and/or types filenames manually — both feed into a **checklist**
2. User unchecks any files to exclude, then clicks Search → `processFilenames()` in `lookup.js` runs asynchronously
3. UI updates live via `onProgress` callback
4. On completion → state saved to localStorage, then **summary screen** shown
5. User can navigate back to review screen to edit; sidebar lets user reload any past run directly into review
6. User downloads CSV from review screen or summary screen

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
- `CC-BY-SA` — all CC BY-SA versions (2.0, 3.0, 4.0, or unversioned) collapse to this single label
- `Royalty free` — Shutterstock, Pexels, "royalty free"
- `C` — all rights reserved, "©", "copyright"

If a license string can't be mapped → kept as-is, flagged in summary as "unknown license".

---

## CSV output columns

| Hebrew column | Notes |
|---|---|
| שם פריט | Item name — from archive title or cleaned filename stem (FIRST column) |
| מקור | Archive name |
| קישור למדיה במקור | URL to source page |
| סוג זכויות היוצרים | Normalized license label |
| יש צורך במתן קרדיט? | כן / לא |
| איך לרשום את הקרדיט? | `[title], by [author], under [license], via [source]` |
| מותר לשימוש מסחרי? | מותר / אסור |
| מותר לשימוש חיצוני? | מותר / אסור |

Note: `שם קובץ` and `קבצים נוספים` remain in `reviewState.rows` and visible in the review table — they are excluded from the CSV export only.

CSV is generated client-side with UTF-8 BOM so Hebrew displays correctly in Excel and Monday.com.

---

## UI design

- Language: Hebrew, RTL
- Font: Heebo (sans) + DM Mono (filenames/paths)
- Style: clean, minimal, bright — white cards on light grey background (#f5f5f3), blue accents (#2d6ef6)
- 4 screens managed by JS show/hide, no routing library
- Layout: fixed 220px sidebar on CSS-left (`--sidebar-w`), `.main-area` has `margin-left: 220px`
- Review screen: when active, `position: fixed; top: var(--steps-h); left: var(--sidebar-w); right: 0; bottom: 0;`
- Steps bar: `position: sticky; top: 0; height: var(--steps-h)` inside `.main-area`, spans only the main content area
- "← חיפוש חדש" buttons (header + review screen) call `location.reload()` for a fully clean reset
- Summary screen uses `compact-header` CSS class on `#main-shell` to reduce the header's bottom margin (40px → 12px)
- All archive calls use fetch() with proper error handling

---

## 4-screen flow

### Screen 1: Setup
User builds a checklist of filenames and selects archive sources.

**Input model:**
- **Folder picker** (`webkitdirectory`): scans selected folder, filters by `IMAGE_EXTENSIONS`, appends to checklist. Can be used multiple times.
- **Manual textarea**: user types/pastes filenames (one per line, with extension), clicks "הוסף" → appended to checklist. Duplicates skipped.
- **Checklist**: each item has a checkbox (default checked) + filename. Two buttons: "הכל" (check all) / "כלום" (uncheck all). "חפש" runs only on checked items; shows validation error if nothing is checked.
- File objects (for local thumbnails) are tracked in `fileObjectMap` only for files added via folder picker. Manual entries have `file: null`.

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
Stat boxes, source breakdown, flagged item counts. CSV download button is full-width (like the primary search button).

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
