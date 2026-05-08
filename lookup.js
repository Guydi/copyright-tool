/**
 * lookup.js — Archive lookup engine for copyright_tool (static SPA version)
 * Translated from lookup.py. Handles: Wikimedia Commons, Library of Congress,
 * Pexels, Shutterstock.
 *
 * Usage: import as ES module (<script type="module">)
 * Exports: processFilenames, analyzeFilename, findDuplicates,
 *          findPotentialDuplicates, normalizeLicense, lookupImage
 */

// ── Utility ───────────────────────────────────────────────────────────────────

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Constants ─────────────────────────────────────────────────────────────────

const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'tif', 'tiff', 'webp', 'svg'];

const SOURCE_PREFIXES = {
  'loc_':          'loc',
  'artvee_':       'artvee',
  'wellcome_':     'wikimedia',
  'shutterstock_': 'shutterstock',
  'pexels-':       'pexels',
};

const DERIVATIVE_PATTERNS = [
  /_cropped?$/i,
  /_crop$/i,
  /[\s_]\(cropped?\)$/i,
  /_edited?$/i,
  /_modified$/i,
  /_resized$/i,
  /_\d+px$/i,
  /_\(\d+\)$/i,
  /\s*\(\d+\)$/i,
];

const RESOLUTION_PREFIX = /^\d+px-/i;

// ── License normalization ─────────────────────────────────────────────────────

// Each entry: { pattern, label, requiresCredit, commercialOk, externalOk }
// Canonical labels: 'Public Domain', 'No known copyright restrictions',
//                   'CC BY', 'CC BY SA', 'Royalty free', 'C'
const LICENSE_MAP = [
  { pattern: /cc0|creative commons zero/i,                   label: 'Public Domain',                   requiresCredit: false, commercialOk: true,  externalOk: true  },
  { pattern: /public.?domain|no.?copyright/i,                label: 'Public Domain',                   requiresCredit: false, commercialOk: true,  externalOk: true  },
  { pattern: /no.?known.?copyright/i,                        label: 'No known copyright restrictions', requiresCredit: false, commercialOk: true,  externalOk: true  },
  { pattern: /no.?restrictions/i,                            label: 'No known copyright restrictions', requiresCredit: false, commercialOk: true,  externalOk: true  },
  { pattern: /cc.?by.?sa/i,                                  label: 'CC BY SA',                        requiresCredit: true,  commercialOk: true,  externalOk: true  },
  { pattern: /cc.?by(?!.?sa)/i,                              label: 'CC BY',                           requiresCredit: true,  commercialOk: true,  externalOk: true  },
  { pattern: /pexels.?licen|royalty.?free|shutterstock|rf\b/i, label: 'Royalty free',                  requiresCredit: false, commercialOk: true,  externalOk: true  },
  { pattern: /\bc\b|all rights reserved|copyright/i,         label: 'C',                               requiresCredit: true,  commercialOk: false, externalOk: false },
];

/**
 * Normalize a raw license string to a standard label + permission flags.
 * @returns {{ label, requiresCredit, commercialOk, externalOk, isUnknown }}
 */
function normalizeLicense(raw) {
  if (!raw) {
    return { label: 'לא ידוע', requiresCredit: false, commercialOk: false, externalOk: false, isUnknown: true };
  }
  for (const entry of LICENSE_MAP) {
    if (entry.pattern.test(raw)) {
      return {
        label:         entry.label,
        requiresCredit: entry.requiresCredit,
        commercialOk:  entry.commercialOk,
        externalOk:    entry.externalOk,
        isUnknown:     false,
      };
    }
  }
  return { label: raw.trim(), requiresCredit: false, commercialOk: false, externalOk: false, isUnknown: true };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Strip HTML tags and decode common HTML entities. */
function stripHtml(text) {
  let s = String(text ?? '');
  s = s.replace(/<[^>]+>/g, '');
  s = s.replace(/&amp;/g,  '&');
  s = s.replace(/&lt;/g,   '<');
  s = s.replace(/&gt;/g,   '>');
  s = s.replace(/&quot;/g, '"');
  s = s.replace(/&#\d+;/g, '');
  return s.trim();
}

/** Truncate a title at maxLen, adding an ellipsis. */
function shortenTitle(title, maxLen = 80) {
  if (!title) return title;
  const s = String(title).trim();
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen - 1).trimEnd() + '…';
}

/** Extract a human-readable title from a Shutterstock filename stem. */
function titleFromShutterstockStem(stem) {
  let cleaned = stem.replace(/^shutterstock[_\-]?/i, '').replace(/^[_\- ]+/, '');
  // Remove trailing numeric ID (6+ digits)
  cleaned = cleaned.replace(/[\s_\-]\d{6,}$/, '').replace(/[_\- ]+$/, '');
  cleaned = cleaned.replace(/[_\-]/g, ' ').trim();
  if (!cleaned) return '';
  // Title-case
  return cleaned.replace(/\b\w/g, c => c.toUpperCase());
}

/** Build a "Title, by Author, under License, via Source" attribution string. */
function formatAttribution(title, author, licenseLabel, sourceName) {
  const parts = [];
  if (title)        parts.push(title);
  if (author)       parts.push(`by ${author}`);
  if (licenseLabel) parts.push(`under ${licenseLabel}`);
  if (sourceName)   parts.push(`via ${sourceName}`);
  return parts.join(', ');
}

/**
 * Generate a display name for an item.
 * Prefers `title` if it's meaningfully different from the filename `stem`.
 * Falls back to cleaned stem (underscores/dashes → spaces).
 * Truncates at the last word boundary before maxLen chars.
 * @returns {{ itemName: string, isRawStem: boolean }}
 */
function makeItemName(title, stem, maxLen = 60) {
  const cleanedStem = stem.replace(/[_\-]/g, ' ').trim();

  const norm = s => s.toLowerCase().replace(/\s+/g, ' ').trim();

  const titleStripped = (title || '').trim();
  let useTitle = false;

  if (titleStripped) {
    if (norm(titleStripped) !== norm(cleanedStem)) {
      useTitle = true;
    }
  }

  let text = useTitle ? titleStripped : (cleanedStem || stem);
  const isRawStem = !useTitle;

  if (text.length > maxLen) {
    const truncated = text.slice(0, maxLen);
    const lastSpace = truncated.lastIndexOf(' ');
    if (lastSpace > maxLen / 2) {
      text = truncated.slice(0, lastSpace).trimEnd();
    } else {
      text = truncated.trimEnd();
    }
  }

  if (!text) {
    return { itemName: stem, isRawStem: true };
  }

  return { itemName: text, isRawStem };
}

// ── Filename analysis ─────────────────────────────────────────────────────────

/**
 * Analyse a filename, stripping known prefixes and detecting derivatives.
 * Faithfully translated from Python analyze_filename().
 * @returns {{ stem, sourceHint, notes, isDerivative, canonical }}
 */
function analyzeFilename(filename) {
  // Extract stem: everything before the last dot
  const lastDot = filename.lastIndexOf('.');
  let stem = lastDot > 0 ? filename.slice(0, lastDot) : filename;
  const notes = [];
  let sourceHint = null;
  let isDerivative = false;

  // Strip resolution prefix (e.g. "1920px-")
  const resPrefixMatch = stem.match(RESOLUTION_PREFIX);
  if (resPrefixMatch) {
    notes.push(`הוסרה תחילית רזולוציה: '${resPrefixMatch[0]}'`);
    stem = stem.slice(resPrefixMatch[0].length);
  }

  // Strip known source prefix (case-insensitive comparison)
  const stemLower = stem.toLowerCase();
  for (const [prefix, hint] of Object.entries(SOURCE_PREFIXES)) {
    if (stemLower.startsWith(prefix)) {
      notes.push(`הוסרה תחילית מקור: '${prefix}'`);
      sourceHint = hint;
      stem = stem.slice(prefix.length);
      break;
    }
  }

  // Detect derivative patterns (e.g. _cropped, _edited, (2))
  let canonical = stem;
  for (const pat of DERIVATIVE_PATTERNS) {
    const m = stem.match(pat);
    if (m) {
      canonical = stem.slice(0, m.index).trim();
      isDerivative = true;
      notes.push(`זוהה כגרסה נגזרת של: '${canonical}'`);
      break;
    }
  }

  // Strip resolution prefix from canonical too
  const canonResMatch = canonical.match(RESOLUTION_PREFIX);
  if (canonResMatch) {
    canonical = canonical.slice(canonResMatch[0].length);
  }

  // Auto-detect source from stem patterns if no prefix was found
  if (!sourceHint) {
    if (/^shutterstock[_\-]\d+/i.test(stem)) {
      sourceHint = 'shutterstock';
    } else if (/^pexels[_\-]/i.test(stem)) {
      sourceHint = 'pexels';
    }
  }

  return { stem, sourceHint, notes, isDerivative, canonical };
}

/**
 * Group filenames by their canonical stem (lowercased).
 * @returns {{ groups: Object, analyses: Object }}
 */
function findDuplicates(filenames) {
  const groups = {};
  const analyses = {};
  for (const fn of filenames) {
    const a = analyzeFilename(fn);
    const canonKey = a.canonical.toLowerCase();
    analyses[fn] = a;
    if (!groups[canonKey]) groups[canonKey] = [];
    groups[canonKey].push(fn);
  }
  return { groups, analyses };
}

/** Strip source/resolution prefixes and normalise punctuation for prefix comparison. */
function cleanStemForPrefix(stem) {
  let s = stem.toLowerCase();
  s = s.replace(RESOLUTION_PREFIX, '');
  for (const prefix of Object.keys(SOURCE_PREFIXES)) {
    if (s.startsWith(prefix)) {
      s = s.slice(prefix.length);
      break;
    }
  }
  s = s.replace(/[_\-\s]+/g, ' ').trim();
  return s;
}

/**
 * Find confirmed derivative groups and potential duplicate groups.
 * Faithfully translated from Python find_potential_duplicates().
 * @returns {{ confirmed: Object, potential: Object, analyses: Object }}
 */
function findPotentialDuplicates(filenames) {
  const { groups, analyses } = findDuplicates(filenames);

  // Files already in confirmed multi-file groups
  const confirmedMulti = new Set();
  for (const group of Object.values(groups)) {
    if (group.length > 1) {
      for (const fn of group) confirmedMulti.add(fn);
    }
  }

  // Candidates for potential duplicate detection: not in confirmed groups
  const candidates = filenames.filter(fn => !confirmedMulti.has(fn));

  // Compute cleaned stems for each candidate
  const candidateStems = {};
  for (const fn of candidates) {
    candidateStems[fn] = cleanStemForPrefix(analyses[fn].canonical);
  }

  // Find pairs sharing a common prefix of >= 8 chars
  const MIN_PREFIX = 8;
  const adjacency = {};
  for (const fn of candidates) adjacency[fn] = new Set();

  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const fnA = candidates[i], fnB = candidates[j];
      const sA = candidateStems[fnA], sB = candidateStems[fnB];
      if (sA === sB) continue; // identical after normalisation — skip

      let prefixLen = 0;
      const minLen = Math.min(sA.length, sB.length);
      while (prefixLen < minLen && sA[prefixLen] === sB[prefixLen]) prefixLen++;

      if (prefixLen >= MIN_PREFIX) {
        adjacency[fnA].add(fnB);
        adjacency[fnB].add(fnA);
      }
    }
  }

  // Transitive closure via BFS
  const visited = new Set();
  const potGroups = {};

  for (const fn of candidates) {
    if (visited.has(fn) || adjacency[fn].size === 0) {
      visited.add(fn);
      continue;
    }
    const group = [];
    const queue = [fn];
    while (queue.length) {
      const cur = queue.shift();
      if (visited.has(cur)) continue;
      visited.add(cur);
      group.push(cur);
      for (const nb of adjacency[cur]) {
        if (!visited.has(nb)) queue.push(nb);
      }
    }
    if (group.length >= 2) {
      const key = [...group].sort()[0]; // deterministic key
      potGroups[key] = group;
    }
  }

  return { confirmed: groups, potential: potGroups, analyses };
}

// ── Wikimedia Commons lookup ──────────────────────────────────────────────────

const WIKIMEDIA_API = 'https://commons.wikimedia.org/w/api.php';

/** Parse Wikimedia imageinfo + extmetadata into a standard internal result. */
function parseWikimediaMeta(info, meta) {
  const objectName   = stripHtml(meta.ObjectName?.value ?? '');
  const title        = shortenTitle(objectName);
  let   author       = stripHtml(meta.Artist?.value ?? '');
  // Deduplicate repeated "Unknown author" strings
  author = author.replace(/(Unknown author)+/g, 'Unknown author');
  const licenseRaw   = meta.LicenseShortName?.value || meta.UsageTerms?.value || '';
  const url          = info.descriptionurl ?? '';
  const thumbnailUrl = info.thumburl ?? '';
  return { _sourceName: 'Wikimedia Commons', _title: title, _author: author, _licenseRaw: licenseRaw, _url: url, _objectName: objectName, _thumbnailUrl: thumbnailUrl };
}

/**
 * Search Wikimedia Commons for a file stem.
 * Strategy 1: exact title match (File:{stem} then bare stem).
 * Strategy 2: full-text search fallback.
 * Returns a parsed result object or null.
 */
async function searchWikimedia(stem, notesOut) {
  // Strategy 1: exact title match
  for (const titleTry of [`File:${stem}`, stem]) {
    const params = new URLSearchParams({
      action:     'query',
      titles:     titleTry,
      prop:       'imageinfo',
      iiprop:     'url|extmetadata|canonicaltitle',
      iiurlwidth: '300',
      format:     'json',
      origin:     '*',
    });
    try {
      const res  = await fetch(`${WIKIMEDIA_API}?${params}`);
      const data = await res.json();
      const pages = data?.query?.pages ?? {};
      const page  = Object.values(pages)[0];
      if (page?.pageid !== undefined && page.pageid !== -1) {
        const info = (page.imageinfo ?? [{}])[0];
        const meta = info.extmetadata ?? {};
        if (meta.LicenseShortName || meta.UsageTerms) {
          notesOut.push('נמצא בהתאמה מדויקת של שם קובץ');
          return parseWikimediaMeta(info, meta);
        }
      }
    } catch (_) { /* network or parse error — continue */ }
    await sleep(200);
  }

  // Strategy 2: full-text search
  let searchQuery = stem.replace(/[_\-]/g, ' ');
  searchQuery = searchQuery.replace(/\b(original|cropped?|edit|resized)\b/gi, '').trim();

  const searchParams = new URLSearchParams({
    action:      'query',
    list:        'search',
    srsearch:    `File:${searchQuery}`,
    srnamespace: '6',
    srlimit:     '5',
    format:      'json',
    origin:      '*',
  });
  try {
    const res     = await fetch(`${WIKIMEDIA_API}?${searchParams}`);
    const data    = await res.json();
    const results = data?.query?.search ?? [];
    if (!results.length) return null;

    const pageTitle = results[0].title;
    notesOut.push(`נמצא בחיפוש טקסט: '${shortenTitle(pageTitle, 60)}'`);

    const infoParams = new URLSearchParams({
      action:     'query',
      titles:     pageTitle,
      prop:       'imageinfo',
      iiprop:     'url|extmetadata',
      iiurlwidth: '300',
      format:     'json',
      origin:     '*',
    });
    const res2  = await fetch(`${WIKIMEDIA_API}?${infoParams}`);
    const data2 = await res2.json();
    const pages2 = data2?.query?.pages ?? {};
    const page2  = Object.values(pages2)[0];
    const info2  = (page2?.imageinfo ?? [{}])[0];
    const meta2  = info2?.extmetadata ?? {};
    if (!meta2.LicenseShortName && !meta2.UsageTerms) return null;
    return parseWikimediaMeta(info2, meta2);
  } catch (_) {
    return null;
  }
}

// ── Library of Congress lookup ────────────────────────────────────────────────

const LOC_API = 'https://www.loc.gov/search/';

/**
 * Search the Library of Congress for a file stem.
 * Returns a standard result object or null.
 */
async function searchLOC(stem, notesOut) {
  const query = stem.replace(/[_\-]/g, ' ').trim();
  const params = new URLSearchParams({ q: query, fo: 'json', at: 'results', c: '3' });
  try {
    const res     = await fetch(`${LOC_API}?${params}`);
    const data    = await res.json();
    const results = data?.results ?? [];
    if (!results.length) return null;

    const item = results[0];
    const title = shortenTitle(item.title ?? stem);

    let link = item.id ?? '';
    if (link && !link.startsWith('http')) {
      link = `https://www.loc.gov${link}`;
    }

    let rights = item.rights || item.rights_advisory || '';
    if (Array.isArray(rights)) rights = rights.join(' ');
    if (!rights) rights = 'No known copyright restrictions';

    let contributor = item.contributor || item.creator || '';
    if (Array.isArray(contributor)) contributor = contributor.join(', ');

    const thumbRaw     = item.image_url || item.thumbnail || '';
    const thumbnailUrl = Array.isArray(thumbRaw) ? (thumbRaw[0] || '') : (thumbRaw || '');
    notesOut.push('נמצא בספריית הקונגרס');
    return { _sourceName: 'Library of Congress', _title: title, _author: contributor, _licenseRaw: rights, _url: link, _thumbnailUrl: thumbnailUrl };
  } catch (_) {
    return null;
  }
}

// ── Pexels resolver ───────────────────────────────────────────────────────────

/**
 * Resolve a Pexels image from its filename stem.
 * Extracts the photo ID and constructs the Pexels URL. No API call.
 */
function resolvePexels(stem, notesOut) {
  const idMatch = stem.match(/-(\d{5,})(?:\.|$)/);
  const photoId = idMatch ? idMatch[1] : null;
  const url = photoId ? `https://www.pexels.com/photo/${photoId}/` : 'https://www.pexels.com';
  notesOut.push('Pexels — זוהה לפי שם קובץ, ללא API key');
  return { _sourceName: 'Pexels', _title: '', _author: '', _licenseRaw: 'Pexels License', _url: url, _thumbnailUrl: '' };
}

// ── Shutterstock resolver ─────────────────────────────────────────────────────

/**
 * Resolve a Shutterstock image from its filename stem.
 * Extracts photo ID and constructs link. No API call (stub).
 */
function resolveShutterstock(stem, notesOut) {
  const idMatch = stem.match(/(\d{7,})/);
  const photoId = idMatch ? idMatch[1] : null;
  const url = photoId ? `https://www.shutterstock.com/image/${photoId}` : 'https://www.shutterstock.com';
  const title = titleFromShutterstockStem(stem);
  notesOut.push('Shutterstock — זוהה לפי שם קובץ, יש לאמת ידנית');
  return { _sourceName: 'Shutterstock', _title: title, _author: '', _licenseRaw: 'Royalty free', _url: url, _thumbnailUrl: '' };
}

// ── Main dispatcher ───────────────────────────────────────────────────────────

/**
 * Look up copyright information for a single image filename.
 * Translated from Python lookup_image().
 * @param {string}   filename        - The image filename
 * @param {string[]} enabledSources  - e.g. ['wikimedia', 'loc', 'pexels', 'shutterstock']
 * @returns {Promise<Object>}        - Full result with CSV fields + metadata
 */
async function lookupImage(filename, enabledSources) {
  const sources = new Set(enabledSources);
  const analysis = analyzeFilename(filename);
  const stem  = analysis.isDerivative ? analysis.canonical : analysis.stem;
  const hint  = analysis.sourceHint;
  const notes = [...analysis.notes];
  let resultRaw = null;

  // Source-aware dispatch
  if (hint === 'shutterstock' && sources.has('shutterstock')) {
    resultRaw = resolveShutterstock(stem, notes);
  } else if (hint === 'pexels' && sources.has('pexels')) {
    resultRaw = resolvePexels(stem, notes);
  } else if (hint === 'loc' && sources.has('loc')) {
    resultRaw = await searchLOC(stem, notes);
    if (!resultRaw && sources.has('wikimedia')) {
      notes.push('לא נמצא ב-LOC, מנסה Wikimedia');
      resultRaw = await searchWikimedia(stem, notes);
    }
  } else if (hint === 'wikimedia' && sources.has('wikimedia')) {
    resultRaw = await searchWikimedia(stem, notes);
  } else {
    // No hint or hint not in enabled sources — try all in priority order
    const order = ['wikimedia', 'loc', 'pexels', 'shutterstock'];
    for (const src of order) {
      if (!sources.has(src)) continue;
      if (src === 'wikimedia') {
        resultRaw = await searchWikimedia(stem, notes);
      } else if (src === 'loc') {
        resultRaw = await searchLOC(stem, notes);
      } else if (src === 'pexels' && /^pexels/i.test(stem)) {
        resultRaw = resolvePexels(stem, notes);
      } else if (src === 'shutterstock' && /\d{7,}/.test(stem)) {
        resultRaw = resolveShutterstock(stem, notes);
      }
      if (resultRaw) break;
      await sleep(200);
    }
  }

  // Not found — return empty row
  if (!resultRaw) {
    const { itemName, isRawStem } = makeItemName('', stem);
    return {
      'שם פריט':              itemName,
      'שם קובץ':              filename,
      'מקור':                 '',
      'קישור למדיה במקור':   '',
      'סוג זכויות היוצרים':  '',
      'יש צורך במתן קרדיט?': '',
      'איך לרשום את הקרדיט?':'',
      'מותר לשימוש מסחרי?':  '',
      'מותר לשימוש חיצוני?': '',
      'קבצים נוספים':         '',
      _notes:          notes,
      _found:          false,
      _source:         '',
      _unknownLicense: false,
      _isRawFilename:  isRawStem,
      _thumbnailUrl:   '',
    };
  }

  // Normalize license
  const { label, requiresCredit, commercialOk, externalOk, isUnknown } = normalizeLicense(resultRaw._licenseRaw);

  // Build attribution string
  const attribution = requiresCredit
    ? formatAttribution(resultRaw._title, resultRaw._author, resultRaw._licenseRaw, resultRaw._sourceName)
    : '';

  if (isUnknown) {
    notes.push(`רישיון לא מזוהה: '${resultRaw._licenseRaw}' — נדרשת בדיקה ידנית`);
  }

  // Generate item name based on source
  let itemName, isRawStem;
  const sourceName = resultRaw._sourceName;
  const rawTitle   = resultRaw._title || '';

  if (sourceName === 'Wikimedia Commons') {
    const objectName = resultRaw._objectName || rawTitle;
    ({ itemName, isRawStem } = makeItemName(objectName, stem));
  } else if (sourceName === 'Library of Congress') {
    ({ itemName, isRawStem } = makeItemName(rawTitle, stem));
  } else if (sourceName === 'Pexels') {
    ({ itemName, isRawStem } = makeItemName('', stem));
  } else if (sourceName === 'Shutterstock') {
    const ssTitle = titleFromShutterstockStem(stem);
    ({ itemName, isRawStem } = makeItemName(ssTitle, stem));
  } else {
    ({ itemName, isRawStem } = makeItemName(rawTitle, stem));
  }

  const isRestricted = (label === 'C');

  return {
    'שם פריט':              itemName,
    'שם קובץ':              filename,
    'מקור':                 sourceName,
    'קישור למדיה במקור':   resultRaw._url,
    'סוג זכויות היוצרים':  label,
    'יש צורך במתן קרדיט?': requiresCredit ? 'כן' : 'לא',
    'איך לרשום את הקרדיט?':attribution,
    'מותר לשימוש מסחרי?':  isRestricted ? 'אסור' : 'מותר',
    'מותר לשימוש חיצוני?': isRestricted ? 'אסור' : 'מותר',
    'קבצים נוספים':         '',
    _notes:          notes,
    _found:          true,
    _source:         sourceName,
    _unknownLicense: isUnknown,
    _isRawFilename:  isRawStem,
    _thumbnailUrl:   resultRaw._thumbnailUrl || '',
  };
}

// ── Batch processor ───────────────────────────────────────────────────────────

// Notes that are informational only — not surfaced in the flagged issues UI
const TRIVIAL_NOTE_SUBSTRINGS = [
  'נמצא בהתאמה מדויקת',
  'נמצא בספריית הקונגרס',
];

function filterMeaningfulNotes(notes) {
  return notes.filter(n => !TRIVIAL_NOTE_SUBSTRINGS.some(t => n.includes(t)));
}

/**
 * Process an array of image filenames, performing lookups and grouping duplicates.
 * Handles confirmed derivatives: they are merged into their canonical row.
 *
 * @param {string[]}  filenames       - Array of image filenames
 * @param {string[]}  enabledSources  - e.g. ['wikimedia', 'loc', 'pexels', 'shutterstock']
 * @param {Function}  onProgress      - Called as (current, total, filename) after each file
 * @returns {Promise<{ results: Object[], summary: Object }>}
 */
async function processFilenames(filenames, enabledSources, onProgress) {
  const { confirmed: confirmedGroups, potential: potentialGroups, analyses } =
    findPotentialDuplicates(filenames);

  const canonicalResults = {}; // canonicalKey → result row
  const processed = [];        // ordered array of result rows (one per canonical)

  for (let i = 0; i < filenames.length; i++) {
    const fn = filenames[i];
    const a  = analyses[fn];
    const canonKey = a.canonical.toLowerCase();

    if (a.isDerivative && canonKey in canonicalResults) {
      // Derivative of an already-processed canonical — skip; will be merged below
    } else {
      const result = await lookupImage(fn, enabledSources);
      canonicalResults[canonKey] = result;
      processed.push(result);
    }

    if (typeof onProgress === 'function') {
      // Pass result as 4th arg so UI can update live feed (null for skipped derivatives)
      const lastResult = canonicalResults[canonKey] || null;
      onProgress(i + 1, filenames.length, fn, lastResult);
    }
  }

  // Merge confirmed derivative groups into canonical rows
  for (const [canonKey, groupFiles] of Object.entries(confirmedGroups)) {
    if (groupFiles.length < 2) continue;

    // Find the canonical file (non-derivative), or fall back to first
    let canonicalFile = groupFiles.find(fn => !analyses[fn].isDerivative) ?? groupFiles[0];

    const row = processed.find(r => r['שם קובץ'] === canonicalFile);
    if (!row) continue;

    const others = groupFiles.filter(fn => fn !== canonicalFile);
    const existing = row['קבצים נוספים'];
    row['קבצים נוספים'] = existing ? `${existing}, ${others.join(', ')}` : others.join(', ');
  }

  // Build potential duplicates list (array of sorted file arrays)
  const potentialDuplicates = Object.values(potentialGroups).map(g => [...g].sort());

  // Build summary
  const found    = processed.filter(r => r._found);
  const notFound = processed.filter(r => !r._found);

  const bySource = {};
  for (const r of found) {
    bySource[r._source] = (bySource[r._source] ?? 0) + 1;
  }

  const flagged = [];
  for (const r of processed) {
    const meaningful = filterMeaningfulNotes(r._notes);
    if (meaningful.length) flagged.push({ file: r['שם קובץ'], notes: meaningful });
  }

  const unknownLicenses = processed
    .filter(r => r._unknownLicense)
    .map(r => ({ file: r['שם קובץ'], license: r['סוג זכויות היוצרים'] }));

  const needsItemName = processed
    .filter(r => r._isRawFilename)
    .map(r => r['שם קובץ']);

  return {
    results: processed,
    summary: {
      total:              processed.length,
      found:              found.length,
      notFound:           notFound.length,
      bySource,
      flagged,
      unknownLicenses,
      potentialDuplicates,
      needsItemName,
    },
  };
}

// ── Exports ───────────────────────────────────────────────────────────────────

export {
  processFilenames,
  analyzeFilename,
  findDuplicates,
  findPotentialDuplicates,
  normalizeLicense,
  lookupImage,
  // Also export lower-level helpers that the UI may need
  IMAGE_EXTENSIONS,
  stripHtml,
  formatAttribution,
  makeItemName,
};
