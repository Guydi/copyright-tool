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
1. User selects a folder via `<input type="file" webkitdirectory>` (or enters filenames manually)
2. User clicks Search → `processFilenames()` in `lookup.js` runs asynchronously
3. UI updates live via `onProgress` callback
4. On completion → **review screen** with editable table and issues panel
5. User reviews, edits, resolves issues, then proceeds to summary
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

All license strings are normalized to these labels:
- `Public Domain` (includes CC0, "public domain", "no copyright")
- `No known copyright restrictions`
- `CC BY` / `CC BY 2.0` / `CC BY 3.0` / `CC BY 4.0`
- `CC BY-SA` / `CC BY-SA 2.0` / `CC BY-SA 3.0` / `CC BY-SA 4.0`
- `Royalty free` (Shutterstock, Pexels)
- `C` (all rights reserved)

If a license string can't be mapped → kept as-is, flagged in summary as "unknown license".

---

## CSV output columns

| Hebrew column | Notes |
|---|---|
| שם פריט | Item name — from archive title or cleaned filename stem (FIRST column) |
| שם קובץ | Filename |
| מקור | Archive name |
| קישור למדיה במקור | URL to source page |
| סוג זכויות היוצרים | Normalized license label |
| יש צורך במתן קרדיט? | כן / לא |
| איך לרשום את הקרדיט? | `[title], by [author], under [license], via [source]` |
| מותר לשימוש מסחרי? | מותר / אסור |
| מותר לשימוש חיצוני? | מותר / אסור |
| קבצים נוספים | Derivative/merged filenames (LAST column) |

CSV is generated client-side with UTF-8 BOM so Hebrew displays correctly in Excel and Monday.com.

---

## UI design

- Language: Hebrew, RTL
- Font: Heebo (sans) + DM Mono (filenames/paths)
- Style: clean, minimal, bright — white cards on light grey background (#f5f5f3), blue accents (#2d6ef6)
- 4 screens managed by JS show/hide, no routing library
- Review screen is full-width (the `.shell` wrapper is hidden while review is active)
- All archive calls use fetch() with proper error handling

---

## 4-screen flow

### Screen 1: Setup
User selects a folder (via file input) and selects archive sources.

### Screen 2: Progress
Live feed shows results as they arrive via `onProgress` callback from `processFilenames()`.

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

- Thumbnails shown from the selected local files (via `URL.createObjectURL`)
- שם קובץ has a 🔍 icon linking to Google Image Search
- קישור shown as "פתח ↗" link; double-click to edit raw URL
- All other cells are click-to-edit (input or textarea)
- Rows sorted: unresolved issues first (by status order), then a separator row, then תקין rows
- Row border-right indicates severity: danger color for לא זוהה/רישיון לא מזוהה, warn color for others

**Fixed actions bar (bottom of viewport):**
- הורד CSV — downloads reviewed CSV from JS state
- סיים → — transitions to summary screen
- Monday.com import instructions (collapsible accordion, opens upward)

### Screen 4: Summary
Pie chart, required credits, flagged items, unknown licenses. Download button generates CSV from reviewed JS state.

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
}
```

Key functions:
- `computeStatus(row, dupeGroups, notedItems)` — pure function, re-derives status from row data
- `renderReview()` — calls `recomputeAllStatuses()`, then `renderIssuesPanel()` and `renderTable()`
- `buildCSV()` — generates UTF-8 BOM CSV string from `reviewState.rows` (public columns only)
- `downloadBlob(text, filename)` — triggers browser download

---

## Known issues / limitations

- Wikimedia full-text search sometimes returns false positives for short or ambiguous filenames
- LOC search can return unrelated items (e.g. `loc_Gypsy children of Macedonia.jpg` matched a book PDF)
- HTML tags sometimes appear in Wikimedia author fields — stripped with regex but edge cases exist
- Shutterstock: only generates a link from the ID, no license verification possible without paid API
- Artvee has no API — images from Artvee are typically Public Domain (sourced from museums) but cannot be auto-verified
- Thumbnails require the user to have selected files via the file picker (no server-side path access)

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
