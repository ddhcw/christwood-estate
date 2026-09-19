/**
 * Christwood ICT — Projects Tracker
 * Util.js — batch sheet I/O, header-name lookup, dates, retry, locking.
 *
 * Two rules this file exists to enforce:
 *   1. Columns are found by header NAME, never by position.
 *   2. Read the whole range once, work in memory, write once.
 */

// ---------- Table reading (batch, header-keyed) ----------

/**
 * Reads a sheet once into { headers, idx, rows }.
 *   idx  — normalised header name -> column index
 *   rows — data rows only (header excluded), as raw arrays
 * Blank sheets return an empty, safe shape rather than throwing.
 */
function readTable_(sheet) {
  if (!sheet || sheet.getLastRow() < 1 || sheet.getLastColumn() < 1) {
    return { headers: [], idx: {}, rows: [], firstDataRow: 2 };
  }
  var values = sheet.getDataRange().getValues();
  var headers = values[0].map(function (h) { return String(h).trim(); });
  var idx = {};
  headers.forEach(function (h, i) {
    var k = normalizeKey_(h);
    if (k && idx[k] === undefined) idx[k] = i;   // first wins on duplicate headers
  });
  return { headers: headers, idx: idx, rows: values.slice(1), firstDataRow: 2 };
}

/** Value of a named column in a row array. Missing column -> ''. */
function cell_(table, row, headerName) {
  var i = table.idx[normalizeKey_(headerName)];
  if (i === undefined || i >= row.length) return '';
  var v = row[i];
  return (v === null || v === undefined) ? '' : v;
}

/** Trimmed string value of a named column. */
function str_(table, row, headerName) {
  var v = cell_(table, row, headerName);
  return (v instanceof Date) ? fmtDate_(v) : String(v).trim();
}

/** Column index (1-based, for getRange) of a named column, or 0 if absent. */
function colNum_(table, headerName) {
  var i = table.idx[normalizeKey_(headerName)];
  return i === undefined ? 0 : i + 1;
}

function normalizeKey_(header) {
  return String(header)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** True when a cell holds nothing meaningful ('', 'N/A', 'Nil', '<To be filled>'…). */
function isEmptyToken_(v) {
  var s = String(v === null || v === undefined ? '' : v).trim().toLowerCase();
  return CONFIG.EMPTY_TOKENS.indexOf(s) !== -1;
}

function isBlankRow_(row) {
  return row.every(function (c) { return c === '' || c === null || c === undefined; });
}

// ---------- Dates (pinned to Asia/Kolkata) ----------

function fmtDate_(d)      { return d ? Utilities.formatDate(toDate_(d), CONFIG.TIMEZONE, 'yyyy-MM-dd') : ''; }
function fmtDateTime_(d)  { return d ? Utilities.formatDate(toDate_(d), CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm') : ''; }
function fmtTime_(d)      { return d ? Utilities.formatDate(toDate_(d), CONFIG.TIMEZONE, 'HH:mm') : ''; }
function todayStr_()      { return fmtDate_(new Date()); }

/**
 * Defensive date parsing: real Date, spreadsheet serial number, or text.
 * Returns null rather than an Invalid Date, so callers can branch honestly.
 */
function toDate_(v) {
  if (!v && v !== 0) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  if (typeof v === 'number') {
    // Sheets serial: days since 1899-12-30.
    var ms = (v - 25569) * 86400 * 1000;
    var d = new Date(ms);
    return isNaN(d.getTime()) ? null : d;
  }
  var s = String(v).trim();
  if (!s) return null;
  var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  var parsed = new Date(s);
  return isNaN(parsed.getTime()) ? null : parsed;
}

/** Whole days from `from` to `to` (default now). Null-safe -> null. */
function daysSince_(from, to) {
  var a = toDate_(from);
  if (!a) return null;
  var b = toDate_(to) || new Date();
  return Math.floor((b.getTime() - a.getTime()) / 86400000);
}

/** "today", "3 days ago", "34 days ago" — the pressure the brief asks for (§4.8). */
function ageLabel_(from) {
  var d = daysSince_(from);
  if (d === null) return '';
  if (d <= 0) return 'today';
  if (d === 1) return 'yesterday';
  return d + ' days ago';
}

/**
 * Days until a deadline. Positive = still to come, 0 = today, negative = past.
 * Null when there is no date, which is the common case and must stay cheap to
 * check — most items legitimately have no deadline at all.
 */
function dueInDays_(neededBy) {
  var d = daysSince_(neededBy);
  return d === null ? null : -d;
}

/** "overdue by 4 days", "due today", "due in 9 days", or the bare date. */
function dueLabel_(neededBy) {
  var n = dueInDays_(neededBy);
  if (n === null) return '';
  if (n < -1) return 'overdue by ' + Math.abs(n) + ' days';
  if (n === -1) return 'overdue by a day';
  if (n === 0) return 'due today';
  if (n === 1) return 'due tomorrow';
  if (n <= 21) return 'due in ' + n + ' days';
  return 'due ' + fmtDate_(toDate_(neededBy));
}

/**
 * Parses dates humans bake into status text: "Completed - 13th Aug",
 * "done 3/8", "Completed 13 Aug 2026". Returns yyyy-MM-dd or ''.
 * Year is inferred as the current year, stepped back one if that lands
 * in the future — "13th Aug" written in January means last August.
 */
var MONTHS_ = { jan:0, feb:1, mar:2, apr:3, may:4, jun:5, jul:6, aug:7, sep:8, oct:9, nov:10, dec:11 };

function extractDateFromText_(text) {
  var s = String(text || '').toLowerCase();
  if (!s) return '';

  var now = new Date();
  var m = s.match(/(\d{1,2})\s*(?:st|nd|rd|th)?\s*[-\/ ]?\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s*(\d{4})?/);
  if (m) {
    var day = Number(m[1]);
    var mon = MONTHS_[m[2]];
    var yr  = m[3] ? Number(m[3]) : now.getFullYear();
    var d   = new Date(yr, mon, day);
    if (!m[3] && d.getTime() > now.getTime() + 86400000) d = new Date(yr - 1, mon, day);
    return isNaN(d.getTime()) ? '' : fmtDate_(d);
  }

  m = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return fmtDate_(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])));

  m = s.match(/\b(\d{1,2})[\/.](\d{1,2})(?:[\/.](\d{2,4}))?\b/);   // d/m or d/m/yy
  if (m) {
    var yy = m[3] ? Number(m[3]) : now.getFullYear();
    if (yy < 100) yy += 2000;
    var dd = new Date(yy, Number(m[2]) - 1, Number(m[1]));
    if (!m[3] && dd.getTime() > now.getTime() + 86400000) dd = new Date(yy - 1, Number(m[2]) - 1, Number(m[1]));
    return isNaN(dd.getTime()) ? '' : fmtDate_(dd);
  }
  return '';
}

// ---------- Retry, locking, ids ----------

/**
 * 2-3 attempts with exponential backoff + jitter. Used for openById and every
 * UrlFetch. A transient Drive 5xx must never kill the nightly run.
 */
function withRetry_(label, fn, attempts, baseMs) {
  attempts = attempts || 3;
  baseMs = baseMs || 400;
  var lastErr = null;
  for (var i = 0; i < attempts; i++) {
    try { return fn(); }
    catch (err) {
      lastErr = err;
      if (i === attempts - 1) break;
      Utilities.sleep(baseMs * Math.pow(2, i) + Math.floor(Math.random() * 250));
    }
  }
  throw new Error(label + ' failed after ' + attempts + ' attempts: ' +
                  (lastErr && lastErr.message ? lastErr.message : String(lastErr)));
}

/** Script lock with a real timeout. Returns null if someone else holds it. */
function acquireLock_(waitMs) {
  var lock = LockService.getScriptLock();
  try {
    if (!lock.tryLock(waitMs || 30000)) return null;
    return lock;
  } catch (e) {
    return null;
  }
}

/**
 * Short, stable hash of a cell value. '0' for empty, so a blank is
 * distinguishable from "never recorded".
 */
function shortHash_(v) {
  var str = (v === null || v === undefined) ? '' : String(v);
  if (str === '') return '0';
  return Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, str)).substr(0, 8);
}

/**
 * The fingerprint records what the sync last wrote DOWN into a project file,
 * per column. It is the only way to tell these two apart on the next run:
 *
 *   project value != master value  because ICT changed it in the master
 *      -> push down, as always
 *   project value != master value  because a HUMAN typed in the project file
 *      -> pull up; overwriting it would silently destroy their decision
 *
 * Without it the sync cannot distinguish them and always assumes the first.
 */
function buildFingerprint_(map) {
  return Object.keys(map).map(function (k) { return k + ':' + map[k]; }).join('|');
}

function parseFingerprint_(s) {
  var out = {};
  String(s || '').split('|').forEach(function (part) {
    var i = part.indexOf(':');
    if (i > 0) out[part.substring(0, i)] = part.substring(i + 1);
  });
  return out;
}

/**
 * Did a human change this cell in the project file, or is the master simply
 * ahead of it? The whole conflict resolution turns on this one decision, so it
 * is a pure function — values in, boolean out — and exhaustively tested.
 *
 * @param {string} projVal     what the project file holds now
 * @param {string} masterVal   what the master holds now
 * @param {string|undefined} lastPushed  hash of what the sync last wrote down,
 *                                       or undefined for a row predating the
 *                                       fingerprint
 * @return {boolean} true = the project side was edited by a person; pull it up.
 */
function isHumanEdit_(projVal, masterVal, lastPushed) {
  var p = (projVal === null || projVal === undefined) ? '' : String(projVal);
  var m = (masterVal === null || masterVal === undefined) ? '' : String(masterVal);
  if (p === m) return false;                       // no disagreement at all

  if (lastPushed !== undefined && lastPushed !== '') {
    // Known ground truth: differs from what we wrote => a person changed it.
    return shortHash_(p) !== lastPushed;
  }

  // No fingerprint. Writeback has been keeping the two equal, so a non-empty
  // project value that differs means someone typed it. A BLANK project value is
  // treated as never-written rather than as a deliberate clearing — the safer
  // reading for the one run before fingerprints exist.
  return p !== '';
}

function newRef_() {
  return 'S-' + Utilities.getUuid().split('-')[0].toUpperCase();
}

// ---------- Google file id extraction ----------

/**
 * Pulls a SPREADSHEET id out of a cell, handling every shape these cells
 * actually take: a plain URL, a =HYPERLINK() formula, or a renamed rich-text
 * link where the visible text says "Call Logs" and the URL is hidden underneath.
 * Drive folder links and file links are deliberately rejected — they cannot
 * host a Suggestions tab (SUGGESTIONS_SYSTEM.md §C6).
 *
 * @return {{id:string, kind:string}} kind: 'spreadsheet' | 'folder' | 'file' | 'none'
 */
function extractSpreadsheetTarget_(displayValue, formula, richTextUrl) {
  var candidates = [];
  if (richTextUrl) candidates.push(String(richTextUrl));
  if (formula)     candidates.push(String(formula));
  if (displayValue && !isEmptyToken_(displayValue)) candidates.push(String(displayValue));

  var sawFolder = false, sawFile = false;

  for (var i = 0; i < candidates.length; i++) {
    var text = candidates[i];

    var sheetMatch = text.match(/spreadsheets\/d\/([a-zA-Z0-9_-]{20,})/);
    if (sheetMatch) return { id: sheetMatch[1], kind: 'spreadsheet' };

    if (/drive\.google\.com\/drive\/folders\//.test(text) || /\/folderview\?/.test(text)) sawFolder = true;
    if (/drive\.google\.com\/file\/d\//.test(text) || /\/document\/d\//.test(text)) sawFile = true;
  }

  // A bare id pasted on its own.
  var bare = String(displayValue || '').trim();
  if (/^[a-zA-Z0-9_-]{30,}$/.test(bare)) return { id: bare, kind: 'spreadsheet' };

  if (sawFolder) return { id: '', kind: 'folder' };
  if (sawFile)   return { id: '', kind: 'file' };
  return { id: '', kind: 'none' };
}

/**
 * Reads the tracker's link column across all three representations in one pass.
 * Returns an array aligned to the data rows.
 */
function readLinkColumn_(sheet, table, headerName) {
  var col = colNum_(table, headerName);
  var n = table.rows.length;
  if (!col || n === 0) return new Array(n).fill({ id: '', kind: 'none' });

  var range   = sheet.getRange(table.firstDataRow, col, n, 1);
  var values  = range.getValues();
  var formulas = range.getFormulas();
  var rich;
  try { rich = range.getRichTextValues(); } catch (e) { rich = null; }

  var out = [];
  for (var i = 0; i < n; i++) {
    var url = '';
    if (rich && rich[i] && rich[i][0]) {
      var rt = rich[i][0];
      url = rt.getLinkUrl() || '';
      if (!url) {
        // A cell can hold several runs; take the first that carries a link.
        var runs = rt.getRuns() || [];
        for (var r = 0; r < runs.length; r++) {
          if (runs[r].getLinkUrl()) { url = runs[r].getLinkUrl(); break; }
        }
      }
    }
    out.push(extractSpreadsheetTarget_(values[i][0], formulas[i][0], url));
  }
  return out;
}

// ---------- Misc ----------

function uniq_(arr) {
  var seen = {}, out = [];
  arr.forEach(function (v) {
    var k = String(v);
    if (!seen[k]) { seen[k] = true; out.push(v); }
  });
  return out;
}

/**
 * Splits "Prem, Stella; Monica" into ['Prem','Stella','Monica'].
 *
 * The whole cell is tested for emptiness BEFORE splitting, and '/' is not a
 * separator: splitting on it turned the literal cell "N/A" into two staff
 * members named "N" and "A", which then appeared in every owner dropdown.
 */
function splitNames_(v) {
  var raw = String(v || '').trim();
  if (isEmptyToken_(raw)) return [];
  return raw
    .split(/[,;\n]+/)
    .map(function (s) { return s.trim(); })
    .filter(function (s) { return s && !isEmptyToken_(s); });
}

function titleCase_(s) {
  return String(s || '').replace(/\w\S*/g, function (t) {
    return t.charAt(0).toUpperCase() + t.substr(1).toLowerCase();
  });
}
