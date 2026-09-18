// ============================================================
//  CHRISTWOOD SCHOOL — CALL LOG SYSTEM  v4
//  Header-based, self-healing. Replace your entire script with this.
//
//  What changed from v3:
//   • No more Config sheet / column numbers. Columns are found by
//     HEADER NAME, so inserting or reordering columns can't break it.
//   • No "Unknown". Everything is Parent, Staff, or "Someone else".
//   • Number matching extracts every valid number from a cell
//     (fixes the "two numbers in one cell" staff row).
//   • Duplicate POSTs within 10s are dropped (MacroDroid double-fire).
//   • Menu tools: Backfill, Diagnose, Cleanup.
//
//  ONE-TIME SETUP:
//   1. Paste this over the old script. Save.
//   2. Run setupSheet once (authorise when asked).
//   3. Make sure importSD / importHR have your real data with a
//      header row containing the labels in HEADERS below.
//   4. Reload the spreadsheet → use the "📞 Call Log" menu →
//      "Backfill & re-resolve" to fix existing rows.
//   5. Sibling-name dropdown auto-fill needs no setup (simple onEdit).
//      Optionally: 📞 Call Log menu → "Install triggers".
//
//  Maintaining this for ANOTHER school? You only ever edit the
//  HEADERS block below. Nothing else.
//
//  ⚠ DEPLOYING CHANGES — READ THIS
//  MacroDroid posts to a VERSIONED web app deployment. Saving the script
//  (or `clasp push`) updates HEAD only; the deployment keeps serving its
//  frozen snapshot, so incoming calls run OLD code while the menus run new
//  code. Symptom: menus behave correctly but newly logged rows don't.
//  After any change, publish a new version to the SAME deployment so the
//  URL doesn't change:
//    Editor:  Deploy ▸ Manage deployments ▸ (pencil) ▸ Version: New version
//    clasp :  clasp push && clasp deploy --deploymentId <ID> -d "<note>"
//  Verify with `clasp deployments` — but note it can print stale output;
//  the Apps Script API is authoritative.
// ============================================================


// ── What the import tabs are called ─────────────────────────
const CALL_LOG = 'Call Log';
const SUMMARY  = 'Summary';
const SD_SHEET = 'importSD';
const HR_SHEET = 'importHR';
const SCRATCH  = 'scratch';
const REPORTS  = 'Reports';
const DIAG     = 'Diagnostics';

const TZ = 'Asia/Kolkata';
const BRAND = { blue: '#1e3a5f', gold: '#d4a853', lightGold: '#f7ecd4', line: '#dfe3e8' };

//  Signature spaces at the foot of every PDF report, left to right.
//  Add or remove entries and the row re-spaces itself.
const SIGNATORIES = ['Head - HR', 'Trustee', 'CEO'];

//  Summary tab layout
const PERIOD_CELL      = 'B2';   // the "Showing:" dropdown
const PANEL_ROW        = 5;      // top row of the side panels
const HELP_COL         = 27;     // AA..AC — hidden helper block
const CHART_POS_KEY    = 'summary_chart_positions';
//  Used only the first time; after that the charts remember where you put them.
const CHART_DEFAULT_POS = [
  { row: 5,  col: 15, ox: 0, oy: 0 },    // O5  — clear of every side panel
  { row: 20, col: 15, ox: 0, oy: 0 },    // O20
];

//  Reports tab layout
const REP_HEAD_ROW  = 8;
const REP_FIRST_ROW = 9;
//  SUMPRODUCT needs equal-length ranges, so blank-cell counts scan a fixed
//  window rather than an open range. Raise this if the log ever gets bigger.
const SUMMARY_SCAN_ROWS = 20000;
//  Dropdowns read scratch!<col>2:<col>100 — room to keep adding options.
const SCRATCH_LAST_ROW = 100;
//  Used only when a header can't be matched, so a dropdown can never fall
//  back to a stale built-in list just because a header was renamed.
const SCRATCH_DEFAULT_COLS = {
  type: 1,                                              // A
  queries: { 'Parent': 2, 'Staff': 3, 'Someone else': 4 },   // B, C, D
};

// ── The only thing you edit per-school ──────────────────────
// Header labels exactly as they appear in your import tabs.
// Apostrophes, case and extra spaces don't matter.
const HEADERS = {
  // importSD — list ALL contact-number / name pairs you want matched.
  // Order = priority for naming the caller. First match wins.
  sdContacts: [
    ["Father's Contact Number",   "Father's Name"],
    ["Mother's Contact Number",   "Mother's Name"],
    ["Guardian's Contact Number", "Guardian's Name"],
    ["Primary Contact Number",    "Primary Contact Person"],
  ],
  sdStudent: 'Name of the Student',
  sdGrade:   'Grade',
  sdSection: 'Section',

  // importHR
  hrPhone: 'Contact Number',
  hrName:  'Name of the Staff',

  // scratch — every dropdown list lives here, one column per list.
  // Edit the tab, not the script. Header casing/apostrophes don't matter.
  scratchType: 'Type of Call',
  scratchQuery: {                       // keyed by Call Source value
    'Parent':       'Nature of Query - Parent',
    'Staff':        'Nature of Query - Staff',
    'Someone else': 'Nature of Query - Someone Else',
  },
};

const FALLBACK_SOURCE  = 'Someone else';   // never "Unknown"
const DEBOUNCE_SECONDS = 10;               // drop duplicate POSTs within this window

// ── Call Log column order (fixed) ───────────────────────────
const COL_PHONE = 1, COL_LOGGED = 2, COL_SOURCE = 3, COL_TYPE = 4,
      COL_CALLER = 5, COL_STUDENT = 6, COL_GRADE = 7, COL_SECTION = 8,
      COL_QUERY = 9, COL_NOTES = 10, TOTAL_COLS = 10;

const DEFAULT_HEADERS = ['Phone Number','Logged At','Call Source','Type of Call',
  'Caller Name','Student Name','Grade','Section','Nature of Query','Notes'];


// ─────────────────────────────────────────────────────────────
//  NUMBER NORMALISER  → returns one clean 10-digit string, or ''
// ─────────────────────────────────────────────────────────────
function normaliseNumber(raw) {
  if (raw === null || raw === undefined) return '';
  let s = (typeof raw === 'number') ? Math.round(raw).toString() : String(raw);
  let d = s.replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  if (d.length === 11 && d.startsWith('0'))  d = d.slice(1);
  return (d.length === 10) ? d : (d || '');
}

//  A cell may contain several numbers ("9840…, 9962…"). Return all
//  valid 10-digit Indian mobiles found in it.
function extractNumbers(raw) {
  if (raw === null || raw === undefined) return [];
  const s = (typeof raw === 'number') ? Math.round(raw).toString() : String(raw);
  const out = [];
  (s.match(/\d{10,12}/g) || []).forEach(chunk => {
    const n = normaliseNumber(chunk);
    if (n.length === 10 && /^[6-9]/.test(n)) out.push(n);
  });
  return out;
}


// ─────────────────────────────────────────────────────────────
//  HEADER DETECTION  — find the header row and map labels→columns
// ─────────────────────────────────────────────────────────────
//  1 → A, 26 → Z, 27 → AA. String.fromCharCode(64+n) breaks past Z, which
//  matters now that the Summary uses helper columns at AA..AC.
function columnLetter(n) {
  let s = '';
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = (n - 1 - r) / 26; }
  return s;
}

function normLabel(s) {
  return String(s || '').toLowerCase().replace(/[’'`]/g, '').replace(/\s+/g, ' ').trim();
}

//  Scan the first 8 rows; pick the one matching the most probes.
//  Returns { headerRow:0-based, map:{normLabel: 0-based colIndex} }.
function mapHeaders(values, probes) {
  let best = { row: 0, score: -1 };
  const limit = Math.min(8, values.length);
  for (let r = 0; r < limit; r++) {
    const cells = values[r].map(normLabel);
    let score = 0;
    probes.forEach(p => { if (cells.some(c => c === normLabel(p))) score++; });
    if (score > best.score) best = { row: r, score };
  }
  const map = {};
  values[best.row].forEach((h, i) => {
    const k = normLabel(h);
    if (k && !(k in map)) map[k] = i;   // first occurrence wins
  });
  return { headerRow: best.row, map };
}

function colOf(map, label) {
  const k = normLabel(label);
  return (k in map) ? map[k] : -1;
}


// ─────────────────────────────────────────────────────────────
//  INDEX BUILDERS  — phone → record, built once per request
// ─────────────────────────────────────────────────────────────
function buildSDIndex() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SD_SHEET);
  const idx = new Map();
  if (!sh) return idx;
  const v = sh.getDataRange().getValues();
  if (!v.length) return idx;

  const probes = [HEADERS.sdStudent, HEADERS.sdGrade, HEADERS.sdSection,
                  HEADERS.sdContacts[0][0]];
  const { headerRow, map } = mapHeaders(v, probes);

  const cStu = colOf(map, HEADERS.sdStudent);
  const cGr  = colOf(map, HEADERS.sdGrade);
  const cSe  = colOf(map, HEADERS.sdSection);
  const pairs = HEADERS.sdContacts
    .map(([ph, nm]) => [colOf(map, ph), colOf(map, nm)])
    .filter(([p]) => p >= 0);

  for (let i = headerRow + 1; i < v.length; i++) {
    const row = v[i];
    const student = cStu >= 0 ? String(row[cStu] || '').trim() : '';
    const grade   = cGr  >= 0 ? String(row[cGr]  || '').trim() : '';
    const section = cSe  >= 0 ? String(row[cSe]  || '').trim() : '';
    pairs.forEach(([pCol, nCol]) => {
      const caller = nCol >= 0 ? String(row[nCol] || '').trim() : '';
      extractNumbers(row[pCol]).forEach(num => {
        if (!idx.has(num)) idx.set(num, []);
        const list = idx.get(num);
        if (!list.some(r => r.student === student)) {
          list.push({ caller, student, grade, section });
        } else if (caller && !list.find(r => r.student === student).caller) {
          list.find(r => r.student === student).caller = caller;
        }
      });
    });
  }
  return idx;
}

function buildHRIndex() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(HR_SHEET);
  const idx = new Map();
  if (!sh) return idx;
  const v = sh.getDataRange().getValues();
  if (!v.length) return idx;

  const { headerRow, map } = mapHeaders(v, [HEADERS.hrName, HEADERS.hrPhone]);
  const cPh = colOf(map, HEADERS.hrPhone);
  const cNm = colOf(map, HEADERS.hrName);
  if (cPh < 0) return idx;

  for (let i = headerRow + 1; i < v.length; i++) {
    const name = cNm >= 0 ? String(v[i][cNm] || '').trim() : '';
    extractNumbers(v[i][cPh]).forEach(num => { if (!idx.has(num)) idx.set(num, name); });
  }
  return idx;
}


// ─────────────────────────────────────────────────────────────
//  LOOKUP
// ─────────────────────────────────────────────────────────────
function resolve(number, sdIdx, hrIdx) {
  const empty = { source: FALLBACK_SOURCE, callerName: '', studentName: '',
                  grade: '', section: '', siblings: false };
  const n = normaliseNumber(number);
  if (!n) return empty;

  if (sdIdx.has(n)) {
    const m = sdIdx.get(n);
    if (m.length === 1) {
      return { source: 'Parent', siblings: false, callerName: m[0].caller,
               studentName: m[0].student, grade: m[0].grade, section: m[0].section };
    }
    return { source: 'Parent', siblings: true, callerName: m[0].caller,
             studentName: m.map(r => r.student), grade: '', section: '', allMatches: m };
  }
  if (hrIdx.has(n)) {
    return { source: 'Staff', siblings: false, callerName: hrIdx.get(n),
             studentName: '', grade: '', section: '' };
  }
  return empty;
}


// ─────────────────────────────────────────────────────────────
//  VALIDATION + ROW STYLING
// ─────────────────────────────────────────────────────────────
//  Used only if the scratch tab is missing or a column is empty — a dropdown
//  must never come back blank, or the cell becomes unfillable.
const FALLBACK_OPTIONS = {
  types: ['Incoming','Outgoing','Missed'],
  queries: {
    'Parent':       ['Leave request','Lunch','Feedback','Supplies','Other - Parent'],
    'Staff':        ['Child is unwell in class','Other - Staff'],
    'Someone else': ['Job vacancies','Admissions','Vendors','Other - Someone Else'],
  },
};

const OPTIONS_CACHE_KEY = 'calllog_options_v1';
const OPTIONS_TTL       = 300;      // 5 min, per house style
let _options = null;                // memo for the current execution

//  Reads every dropdown list out of the scratch tab. Column order is
//  irrelevant — columns are located by header name.
function getOptions() {
  if (_options) return _options;

  const cache = CacheService.getScriptCache();
  const hit = cache.get(OPTIONS_CACHE_KEY);
  if (hit) { try { return (_options = JSON.parse(hit)); } catch (e) {} }

  const opts = { types: [], queries: {} };
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SCRATCH);
  if (sh) {
    const v = sh.getDataRange().getValues();
    if (v.length) {
      const probes = [HEADERS.scratchType].concat(
        Object.keys(HEADERS.scratchQuery).map(k => HEADERS.scratchQuery[k]));
      const { headerRow, map } = mapHeaders(v, probes);

      //  Read one column down from the header, skipping blanks and dupes.
      const column = label => {
        const c = colOf(map, label);
        if (c < 0) return [];
        const seen = new Set(), out = [];
        for (let i = headerRow + 1; i < v.length; i++) {
          const s = String(v[i][c] === undefined ? '' : v[i][c]).trim();
          if (s && !seen.has(s)) { seen.add(s); out.push(s); }
        }
        return out;
      };

      opts.types = column(HEADERS.scratchType);
      Object.keys(HEADERS.scratchQuery).forEach(src => {
        opts.queries[src] = column(HEADERS.scratchQuery[src]);
      });
    }
  }

  //  Fill any gap from the fallbacks.
  if (!opts.types.length) opts.types = FALLBACK_OPTIONS.types;
  Object.keys(FALLBACK_OPTIONS.queries).forEach(src => {
    if (!opts.queries[src] || !opts.queries[src].length) {
      opts.queries[src] = FALLBACK_OPTIONS.queries[src];
    }
  });

  cache.put(OPTIONS_CACHE_KEY, JSON.stringify(opts), OPTIONS_TTL);
  return (_options = opts);
}

function queryOptions(source) {
  const q = getOptions().queries;
  return q[source] || q[FALLBACK_SOURCE] || FALLBACK_OPTIONS.queries[FALLBACK_SOURCE];
}

function callTypeOptions() { return getOptions().types; }

//  Edited the scratch tab and want it live now, before the 5-min TTL expires.
//  NOTE: the dropdowns themselves are live — they read the scratch range
//  directly, so option edits show up in every row with no action at all.
//  This only refreshes the cached copies used by the Summary and PDF reports.
function reloadOptions() {
  const cache = CacheService.getScriptCache();
  cache.remove(OPTIONS_CACHE_KEY);
  cache.remove(COLS_CACHE_KEY);
  _options = null; _optionCols = null;

  const o = getOptions(), c = getOptionCols();
  const letter = n => n ? columnLetter(n) : '(not found)';
  SpreadsheetApp.getUi().alert(
    '✅ Re-read the "' + SCRATCH + '" tab.\n\n' +
    'Type of Call → column ' + letter(c.type) + '  (' + o.types.length + ' option(s))\n' +
    Object.keys(o.queries).map(s =>
      s + ' → column ' + letter(c.queries[s]) + '  (' + o.queries[s].length + ' option(s))'
    ).join('\n') +
    '\n\nThe dropdowns in the Call Log are live: they read the scratch ' +
    'columns directly, so your edits are already in effect on every row.\n\n' +
    'Run "Rebuild Summary" if you added an option and want a row for it in ' +
    'the Summary totals.');
}

// ───────────────────────────────────────────────────────
//  LIVE DROPDOWN RANGES
//
//  These point AT the scratch tab rather than copying values out of it.
//  requireValueInList() takes a snapshot: rows written yesterday keep
//  yesterday's list forever, which is why earlier edits to scratch appeared
//  to do nothing. requireValueInRange() re-reads the range every time the
//  cell is opened, so adding, removing or renaming an option in scratch
//  updates every row in the log at once — no backfill, no cache to clear.
//
//  Columns are still located by HEADER NAME, then converted to a range, so
//  the tab can be reordered without breaking anything.
// ───────────────────────────────────────────────────────
const COLS_CACHE_KEY = 'calllog_optioncols_v1';
let _optionCols = null;

//  { type: 1-based col | 0, queries: { <source>: 1-based col | 0 } }
function getOptionCols() {
  if (_optionCols) return _optionCols;

  const cache = CacheService.getScriptCache();
  const hit = cache.get(COLS_CACHE_KEY);
  if (hit) { try { return (_optionCols = JSON.parse(hit)); } catch (e) {} }

  const cols = { type: 0, queries: {}, firstRow: 2 };
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SCRATCH);
  if (sh && sh.getLastRow()) {
    const v = sh.getDataRange().getValues();
    const probes = [HEADERS.scratchType].concat(
      Object.keys(HEADERS.scratchQuery).map(k => HEADERS.scratchQuery[k]));
    const { headerRow, map } = mapHeaders(v, probes);
    const at = label => colOf(map, label) + 1;          // 0 when not found
    cols.type = at(HEADERS.scratchType);
    Object.keys(HEADERS.scratchQuery).forEach(src => {
      cols.queries[src] = at(HEADERS.scratchQuery[src]);
    });
    cols.firstRow = headerRow + 2;
  }

  //  Header match is preferred (survives reordering), but never let a header
  //  typo silently drop a dropdown back to the old built-in list: fall back to
  //  the agreed fixed positions — A=Type, B=Parent, C=Staff, D=Someone else.
  if (!cols.type) cols.type = SCRATCH_DEFAULT_COLS.type;
  Object.keys(SCRATCH_DEFAULT_COLS.queries).forEach(src => {
    if (!cols.queries[src]) cols.queries[src] = SCRATCH_DEFAULT_COLS.queries[src];
  });
  cache.put(COLS_CACHE_KEY, JSON.stringify(cols), OPTIONS_TTL);
  return (_optionCols = cols);
}

//  scratch!<col>2:<col>SCRATCH_LAST_ROW, or null if the column isn't there.
function scratchRange(col) {
  if (!col) return null;
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SCRATCH);
  if (!sh) return null;
  const first = getOptionCols().firstRow || 2;
  const last  = Math.min(SCRATCH_LAST_ROW, sh.getMaxRows());
  if (last < first) return null;
  return sh.getRange(first, col, last - first + 1, 1);
}

function typeRange()          { return scratchRange(getOptionCols().type); }
//  An unclassified caller falls back to the "Someone Else" column.
function queryRange(source)   {
  const q = getOptionCols().queries;
  return scratchRange(q[source] || q[FALLBACK_SOURCE]);
}

//  Range-backed rule, with a snapshot rule as fallback if scratch is missing.
function listOrRange(range, fallbackList) {
  const b = SpreadsheetApp.newDataValidation().setAllowInvalid(false);
  return (range ? b.requireValueInRange(range, true)
                : b.requireValueInList(fallbackList, true)).build();
}


//  sibNames: array of student names → put a dropdown on the Student cell.
//  Anything else (single child, staff, someone else) → CLEAR that cell's
//  validation. appendRow inherits validation from the row above, so without
//  an explicit clear a stale sibling dropdown propagates down every new row
//  and flags the correctly auto-filled name as invalid.
function applyRowValidation(sheet, row, source, sibNames) {
  sheet.getRange(row, COL_QUERY)
    .setDataValidation(listOrRange(queryRange(source), queryOptions(source)));
  sheet.getRange(row, COL_TYPE)
    .setDataValidation(listOrRange(typeRange(), callTypeOptions()));

  const studentCell = sheet.getRange(row, COL_STUDENT);
  if (Array.isArray(sibNames) && sibNames.length) {
    studentCell.setDataValidation(
      SpreadsheetApp.newDataValidation().requireValueInList(sibNames, true)
        .setAllowInvalid(false).build());
  } else {
    studentCell.clearDataValidations();
  }
}

//  Re-points the Type of Call and Nature of Query dropdowns on EVERY existing
//  row at the live scratch ranges. Batched: two reads and two writes for the
//  whole log, so it finishes in seconds where a per-row loop would time out.
//  Only needed once, to convert rows written before the switch to live ranges.
function applyAllDropdowns(silent) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CALL_LOG);
  const last  = sheet.getLastRow();
  if (last < 2) {
    if (silent !== true) SpreadsheetApp.getUi().alert('No rows in the Call Log yet.');
    return 0;
  }

  const n       = last - 1;
  const sources = sheet.getRange(2, COL_SOURCE, n, 1).getValues();
  const tRule   = listOrRange(typeRange(), callTypeOptions());
  const byS     = {};                                  // one rule per source
  const ruleFor = src => {
    if (!(src in byS)) byS[src] = listOrRange(queryRange(src), queryOptions(src));
    return byS[src];
  };

  const tRules = [], qRules = [];
  for (let i = 0; i < n; i++) {
    tRules.push([tRule]);
    qRules.push([ruleFor(String(sources[i][0] || '').trim())]);
  }
  sheet.getRange(2, COL_TYPE,  n, 1).setDataValidations(tRules);
  sheet.getRange(2, COL_QUERY, n, 1).setDataValidations(qRules);

  if (silent !== true) {
    SpreadsheetApp.getUi().alert(
      '✅ Dropdowns re-pointed on ' + n + ' row(s).\n\n' +
      'Type of Call  → ' + rangeLabel(typeRange()) + '\n' +
      Object.keys(getOptionCols().queries).map(src =>
        'Query (' + src + ')  → ' + rangeLabel(queryRange(src))).join('\n') +
      '\n\nThese read the "' + SCRATCH + '" tab live, so future option ' +
      'changes need no action at all.\n\n' +
      'Cells holding a value that is no longer an option keep that value and ' +
      'show a red corner flag, so staff can spot and re-pick them.');
  }
  return n;
}

function rangeLabel(r) {
  return r ? (SCRATCH + '!' + r.getA1Notation()) : '(built-in list — scratch tab not found)';
}

//  What is ACTUALLY on the cell right now — used by diagnose() so a dropdown
//  problem can be read off the report instead of guessed at.
function describeValidation(cell) {
  const rule = cell.getDataValidation();
  if (!rule) return '(no dropdown)';
  const type = String(rule.getCriteriaType());
  const vals = rule.getCriteriaValues();
  if (type === 'VALUE_IN_RANGE' && vals[0] && vals[0].getSheet) {
    return 'live range → ' + vals[0].getSheet().getName() + '!' + vals[0].getA1Notation();
  }
  if (type === 'VALUE_IN_LIST') {
    const list = vals[0] || [];
    return 'FIXED LIST (' + list.length + ') → ' + list.slice(0, 6).join(', ') +
           (list.length > 6 ? ', …' : '');
  }
  return type;
}


function styleRow(sheet, row, source) {
  const bg = source === 'Parent' ? '#e6f4ea'
           : source === 'Staff'  ? '#e8f0fe'
           : source === 'Someone else' ? '#fff3e0' : '#f8f9fa';
  sheet.getRange(row, 1, 1, TOTAL_COLS).setBackground(bg);
  sheet.getRange(row, COL_PHONE).setFontWeight('bold');
  if (source !== 'Parent') {
    sheet.getRange(row, COL_STUDENT, 1, 3).setBackground('#e8eaed').setFontColor('#aaaaaa');
  } else {
    sheet.getRange(row, COL_STUDENT, 1, 3).setFontColor('#000000');
  }
}


// ─────────────────────────────────────────────────────────────
//  WEB APP ENTRY  — called by MacroDroid
// ─────────────────────────────────────────────────────────────
function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    const data   = JSON.parse(e.postData.contents);
    const number = normaliseNumber(data.number || '');
    const typeMap = { INCOMING: 'Incoming', OUTGOING: 'Outgoing', MISSED: 'Missed' };
    const callType = typeMap[String(data.direction || '').toUpperCase()] || '';

    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CALL_LOG);

    // Debounce: same number+direction within DEBOUNCE_SECONDS, prior row untouched → drop
    const last = sheet.getLastRow();
    if (last >= 2) {
      const prev = sheet.getRange(last, 1, 1, TOTAL_COLS).getValues()[0];
      const sameNum = normaliseNumber(prev[COL_PHONE - 1]) === number;
      const ts = prev[COL_LOGGED - 1] instanceof Date ? prev[COL_LOGGED - 1].getTime() : 0;
      const fresh = (Date.now() - ts) < DEBOUNCE_SECONDS * 1000;
      const untouched = !prev[COL_QUERY - 1] && !prev[COL_NOTES - 1];
      if (sameNum && fresh && untouched) {
        return json({ status: 'ok', deduped: true });
      }
    }

    const sdIdx = buildSDIndex(), hrIdx = buildHRIndex();
    const r = resolve(number, sdIdx, hrIdx);
    const source = r.source;
    const isSib = r.siblings === true;

    const row = new Array(TOTAL_COLS).fill('');
    row[COL_PHONE  - 1] = number;
    row[COL_LOGGED - 1] = new Date();
    row[COL_SOURCE - 1] = source;
    row[COL_TYPE   - 1] = callType;
    row[COL_CALLER - 1] = r.callerName || '';
    row[COL_STUDENT- 1] = isSib ? '' : (r.studentName || '');
    row[COL_GRADE  - 1] = isSib ? '' : (r.grade || '');
    row[COL_SECTION- 1] = isSib ? '' : (r.section || '');

    sheet.appendRow(row);
    const lr = sheet.getLastRow();

    const sibNames = (isSib && Array.isArray(r.studentName)) ? r.studentName : null;
    if (sibNames && sibNames.length) {
      sheet.getRange(lr, COL_PHONE).setNote('SIBLINGS:' + sibNames.join('|'));
    } else {
      sheet.getRange(lr, COL_PHONE).clearNote();   // don't inherit a stale marker
    }

    applyRowValidation(sheet, lr, source, sibNames);
    styleRow(sheet, lr, source);
    return json({ status: 'ok', source });

  } catch (err) {
    return json({ status: 'error', message: err.message });
  } finally {
    try { lock.releaseLock(); } catch (e2) {}
  }
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}


// ─────────────────────────────────────────────────────────────
//  onEdit  — sibling dropdown picked → auto-fill grade & section
//
//  Two entry points on purpose:
//   • onEdit             — the SIMPLE trigger. Fires with zero setup, so
//                          the feature works the moment this script is saved.
//   • onEditInstallable  — for the installable trigger (full auth). Install
//                          it from the 📞 Call Log menu → "Install triggers".
//  Both delegate to handleStudentEdit; running both is harmless (idempotent).
// ─────────────────────────────────────────────────────────────
function onEdit(e)            { handleStudentEdit(e); }
function onEditInstallable(e) { handleStudentEdit(e); }

function handleStudentEdit(e) {
  if (!e || !e.range) return;
  const sheet = e.range.getSheet();
  if (sheet.getName() !== CALL_LOG) return;
  if (e.range.getRow() < 2) return;

  //  Call Source changed by hand → re-point the Nature of Query dropdown at
  //  the matching scratch column, and drop a reason that no longer applies.
  if (e.range.getColumn() === COL_SOURCE) { handleSourceEdit(sheet, e.range.getRow()); return; }
  if (e.range.getColumn() !== COL_STUDENT) return;

  const row    = e.range.getRow();
  const chosen = String(e.range.getValue() || '').trim();
  if (!chosen) return;

  // Resolve straight from the SD index by phone number. Deliberately NOT
  // gated on the SIBLINGS: note — the note is a UI hint, not the data
  // source, so clearing it (or re-picking a different sibling) still works.
  const phoneCell = sheet.getRange(row, COL_PHONE);
  const list = buildSDIndex().get(normaliseNumber(phoneCell.getValue())) || [];
  const hit  = list.find(r => r.student === chosen);
  if (!hit) return;

  // One batched write for grade + section (adjacent columns).
  sheet.getRange(row, COL_GRADE, 1, 2).setValues([[hit.grade, hit.section]]);
}


function handleSourceEdit(sheet, row) {
  const source = String(sheet.getRange(row, COL_SOURCE).getValue() || '').trim();
  applyRowValidation(sheet, row, source, currentSibNames(sheet, row));
  styleRow(sheet, row, source);

  //  Clear the query if it isn't offered for the new source.
  const cell = sheet.getRange(row, COL_QUERY);
  const val  = String(cell.getValue() || '').trim();
  if (val && queryOptions(source).indexOf(val) === -1) cell.clearContent();
}

//  Re-reads the SIBLINGS: marker so re-applying validation doesn't wipe a
//  sibling dropdown that is still needed on this row.
function currentSibNames(sheet, row) {
  const note = String(sheet.getRange(row, COL_PHONE).getNote() || '');
  if (note.indexOf('SIBLINGS:') !== 0) return null;
  const names = note.slice('SIBLINGS:'.length).split('|').filter(String);
  return names.length ? names : null;
}


// ─────────────────────────────────────────────────────────────
//  MENU
// ─────────────────────────────────────────────────────────────
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('📞 Call Log')
    .addSubMenu(ui.createMenu('📄 Reports')
      .addItem('Generate PDF report (uses dates on Reports tab)', 'generateReport')
      .addSeparator()
      .addItem('Quick: this month',   'reportThisMonth')
      .addItem('Quick: last month',   'reportLastMonth')
      .addItem('Quick: last 7 days',  'reportLast7Days')
      .addSeparator()
      .addItem('Open reports folder', 'openReportsFolder'))
    .addItem('Rebuild Summary',                'rebuildSummary')
    .addItem('Lock chart positions',           'lockChartPositions')
    .addSeparator()
    .addItem('Backfill & re-resolve all rows', 'backfill')
    .addItem('Diagnose (write report)',        'diagnose')
    .addItem('Cleanup phone numbers',          'cleanupNumbers')
    .addSeparator()
    .addItem('Refresh dropdowns on all rows',  'applyAllDropdowns')
    .addItem('Re-read scratch tab (options)',  'reloadOptions')
    .addItem('Rebuild sheet structure',        'setupSheet')
    .addItem('Install triggers',               'installTriggers')
    .addToUi();
}


//  Idempotent: removes any existing onEditInstallable trigger first, so
//  re-running never stacks duplicates.
function installTriggers() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'onEditInstallable')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('onEditInstallable').forSpreadsheet(ss).onEdit().create();
  SpreadsheetApp.getUi().alert('✅ Edit trigger installed.');
}


// ─────────────────────────────────────────────────────────────
//  BACKFILL  — re-resolve every existing row (fixes old "Unknown")
// ─────────────────────────────────────────────────────────────
function backfill() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CALL_LOG);
  const v = sheet.getDataRange().getValues();
  const sdIdx = buildSDIndex(), hrIdx = buildHRIndex();
  let changed = 0;

  for (let i = 1; i < v.length; i++) {
    const num = normaliseNumber(v[i][COL_PHONE - 1]);
    if (!num) continue;
    const r = resolve(num, sdIdx, hrIdx);
    const row = i + 1;

    sheet.getRange(row, COL_SOURCE).setValue(r.source);
    sheet.getRange(row, COL_CALLER).setValue(r.callerName || '');

    let sibNames = null;
    if (!r.siblings) {
      sheet.getRange(row, COL_STUDENT, 1, 3)
        .setValues([[r.studentName || '', r.grade || '', r.section || '']]);
    } else {
      sibNames = r.studentName;
      // If someone already picked a sibling, keep it and fill their grade/section.
      const chosen = String(v[i][COL_STUDENT - 1] || '').trim();
      const hit = (r.allMatches || []).find(m => m.student === chosen);
      if (hit) {
        sheet.getRange(row, COL_GRADE, 1, 2).setValues([[hit.grade, hit.section]]);
        sibNames = null;                      // resolved — no dropdown needed
        sheet.getRange(row, COL_PHONE).clearNote();
      }
    }

    applyRowValidation(sheet, row, r.source, sibNames);
    styleRow(sheet, row, r.source);
    changed++;
  }
  //  Re-point every row's dropdowns at the live scratch ranges too — batched,
  //  so this costs 4 calls regardless of how many rows were re-resolved.
  applyAllDropdowns(true);
  SpreadsheetApp.getUi().alert('✅ Backfill done. ' + changed + ' row(s) re-resolved,\n' +
    'and all dropdowns re-pointed at the "' + SCRATCH + '" tab.');
}


// ─────────────────────────────────────────────────────────────
//  DIAGNOSE  — never guess again. Writes a full report.
// ─────────────────────────────────────────────────────────────
function diagnose() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let d = ss.getSheetByName(DIAG);
  if (!d) d = ss.insertSheet(DIAG); else d.clear();

  const out = [];
  const push = (a, b) => out.push([a, b === undefined ? '' : String(b)]);
  const letter = i => i < 0 ? '(not found)' : columnLetter(i + 1);

  // SD mapping
  const sdSh = ss.getSheetByName(SD_SHEET);
  push('importSD', sdSh ? 'found' : 'MISSING');
  if (sdSh) {
    const v = sdSh.getDataRange().getValues();
    const probes = [HEADERS.sdStudent, HEADERS.sdGrade, HEADERS.sdSection, HEADERS.sdContacts[0][0]];
    const { headerRow, map } = mapHeaders(v, probes);
    push('  header row detected', headerRow + 1);
    push('  Name of the Student → col', letter(colOf(map, HEADERS.sdStudent)));
    push('  Grade → col',   letter(colOf(map, HEADERS.sdGrade)));
    push('  Section → col', letter(colOf(map, HEADERS.sdSection)));
    HEADERS.sdContacts.forEach(([ph, nm]) =>
      push('  ' + ph + ' / ' + nm, letter(colOf(map, ph)) + ' / ' + letter(colOf(map, nm))));
  }

  // HR mapping
  const hrSh = ss.getSheetByName(HR_SHEET);
  push('importHR', hrSh ? 'found' : 'MISSING');
  if (hrSh) {
    const v = hrSh.getDataRange().getValues();
    const { headerRow, map } = mapHeaders(v, [HEADERS.hrName, HEADERS.hrPhone]);
    push('  header row detected', headerRow + 1);
    push('  ' + HEADERS.hrName + ' → col',  letter(colOf(map, HEADERS.hrName)));
    push('  ' + HEADERS.hrPhone + ' → col', letter(colOf(map, HEADERS.hrPhone)));
  }

  // scratch / dropdown mapping
  const scSh = ss.getSheetByName(SCRATCH);
  push(SCRATCH, scSh ? 'found' : 'MISSING — using built-in fallback lists');
  if (scSh) {
    const v = scSh.getDataRange().getValues();
    const probes = [HEADERS.scratchType].concat(
      Object.keys(HEADERS.scratchQuery).map(k => HEADERS.scratchQuery[k]));
    const { headerRow, map } = mapHeaders(v, probes);
    push('  header row detected', headerRow + 1);
    push('  ' + HEADERS.scratchType + ' → col', letter(colOf(map, HEADERS.scratchType)));
    Object.keys(HEADERS.scratchQuery).forEach(src =>
      push('  ' + HEADERS.scratchQuery[src] + ' → col',
           letter(colOf(map, HEADERS.scratchQuery[src])) + '   (Call Source = ' + src + ')'));
  }
  const o = getOptions();
  push('  Type of Call options loaded', o.types.length + ': ' + o.types.join(', '));
  Object.keys(o.queries).forEach(src =>
    push('  Query options — ' + src, o.queries[src].length));

  //  Where the dropdowns SHOULD point…
  push('', '');
  push('— Dropdown ranges the script will apply —', '');
  push('  Type of Call', rangeLabel(typeRange()));
  Object.keys(getOptionCols().queries).forEach(src =>
    push('  Nature of Query — ' + src, rangeLabel(queryRange(src))));

  //  …and what is actually sitting on the sheet right now. A row still
  //  showing "FIXED LIST" was written before the switch to live ranges —
  //  run "Refresh dropdowns on all rows".
  const logSh = ss.getSheetByName(CALL_LOG);
  push('', '');
  push('— What is actually on the Call Log now (sampled rows) —', '');
  const lastR = logSh.getLastRow();
  if (lastR < 2) {
    push('  (no rows yet)', '');
  } else {
    let stale = 0;
    const sample = [2, Math.floor((lastR + 2) / 2), lastR]
      .filter((r, i, a) => r >= 2 && a.indexOf(r) === i);
    sample.forEach(r => {
      const src = String(logSh.getRange(r, COL_SOURCE).getValue() || '(blank)');
      push('  Row ' + r + ' [' + src + '] Type of Call',
           describeValidation(logSh.getRange(r, COL_TYPE)));
      push('  Row ' + r + ' [' + src + '] Nature of Query',
           describeValidation(logSh.getRange(r, COL_QUERY)));
    });
    //  One read for the whole column — never getDataValidation() per row.
    logSh.getRange(2, COL_QUERY, lastR - 1, 1).getDataValidations()
      .forEach(row => {
        if (row[0] && String(row[0].getCriteriaType()) === 'VALUE_IN_LIST') stale++;
      });
    push('  Rows still on a FIXED LIST (need refreshing)', stale);
    if (stale) push('  → Fix: menu ▸ "Refresh dropdowns on all rows"', '');
  }
  push('', '');

  const sdIdx = buildSDIndex(), hrIdx = buildHRIndex();
  push('Distinct parent numbers indexed', sdIdx.size);
  push('Distinct staff numbers indexed',  hrIdx.size);
  let overlap = 0; sdIdx.forEach((_, n) => { if (hrIdx.has(n)) overlap++; });
  push('Numbers that are BOTH (resolve as Parent)', overlap);

  // Unresolved numbers currently in the Call Log
  push('', '');
  push('— Call Log numbers that resolve to "' + FALLBACK_SOURCE + '" —', '');
  const log = ss.getSheetByName(CALL_LOG).getDataRange().getValues();
  const seen = new Set();
  let unresolved = 0;
  for (let i = 1; i < log.length; i++) {
    const num = normaliseNumber(log[i][COL_PHONE - 1]);
    if (!num || seen.has(num)) continue;
    seen.add(num);
    const r = resolve(num, sdIdx, hrIdx);
    if (r.source === FALLBACK_SOURCE) { push('  ' + num, 'not in importSD or importHR'); unresolved++; }
  }
  if (!unresolved) push('  (none — every logged number resolves)', '');

  //  Report starts at row 2 — writing it at row 1 and then stamping the
  //  header over the top silently ate the first line of every report.
  d.getRange(2, 1, out.length, 2).setValues(out);
  d.getRange(1, 1, 1, 2).setValues([['Check', 'Result']])
    .setBackground(BRAND.blue).setFontColor('#fff').setFontWeight('bold');
  d.setColumnWidth(1, 380); d.setColumnWidth(2, 320); d.setFrozenRows(1);
  ss.setActiveSheet(d);
  SpreadsheetApp.getUi().alert('✅ Diagnostics written. Check the "' + DIAG + '" tab.');
}


// ─────────────────────────────────────────────────────────────
//  CLEANUP — fix 12-digit numbers already in the Call Log
// ─────────────────────────────────────────────────────────────
function cleanupNumbers() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CALL_LOG);
  const v = sheet.getDataRange().getValues();
  let fixed = 0;
  for (let i = 1; i < v.length; i++) {
    const clean = normaliseNumber(v[i][COL_PHONE - 1]);
    if (clean && clean !== String(v[i][COL_PHONE - 1])) {
      sheet.getRange(i + 1, COL_PHONE).setValue(clean); fixed++;
    }
  }
  SpreadsheetApp.getUi().alert('Done. ' + fixed + ' number(s) cleaned.');
}


// ─────────────────────────────────────────────────────────────
//  SETUP — build Call Log + Summary + Reports (safe to re-run)
// ─────────────────────────────────────────────────────────────
function setupSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  let log = ss.getSheetByName(CALL_LOG) || ss.insertSheet(CALL_LOG);
  if (log.getLastRow() === 0) log.appendRow(DEFAULT_HEADERS);
  log.getRange(1, 1, 1, TOTAL_COLS)
    .setBackground(BRAND.blue).setFontColor('#fff').setFontWeight('bold')
    .setHorizontalAlignment('center');
  const widths = [140,165,120,120,160,160,80,80,200,260];
  widths.forEach((w, i) => log.setColumnWidth(i + 1, w));
  log.setFrozenRows(1);

  buildSummary(ss);
  buildReportsTab(ss);
  applyAllDropdowns(true);

  SpreadsheetApp.getUi().alert(
    '✅ Structure ready.\n\n' +
    'Summary rebuilt with breakdowns by call source, type of call and nature of query.\n' +
    'Reports tab ready for date-range PDF exports.');
}


// ═════════════════════════════════════════════════════════════
//  SUMMARY — management view.
//
//  Everything here is a LIVE FORMULA, not a snapshot: the numbers move
//  as calls are logged. Only the *structure* is rebuilt by this function,
//  and it is rebuilt from the scratch tab, so adding a dropdown option
//  there and re-running this adds the matching row.
// ═════════════════════════════════════════════════════════════
function rebuildSummary() {
  buildSummary(SpreadsheetApp.getActiveSpreadsheet());
  SpreadsheetApp.getUi().alert('✅ Summary rebuilt from the "' + SCRATCH + '" tab.');
}

function buildSummary(ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(SUMMARY) || ss.insertSheet(SUMMARY);

  //  Remember where the charts have been dragged to, and which period was
  //  being viewed, BEFORE wiping the sheet.
  const chartPos = captureChartPositions(sh);
  const prevSel  = String(sh.getRange(PERIOD_CELL).getValue() || '').trim();

  sh.getCharts().forEach(ch => sh.removeChart(ch));
  sh.clear();

  const c  = n => columnLetter(n);
  const CL = `'${CALL_LOG}'`;
  const openR = col => `${CL}!${c(col)}2:${c(col)}`;
  const bndR  = col => `${CL}!${c(col)}2:${c(col)}${SUMMARY_SCAN_ROWS}`;

  const rP = openR(COL_PHONE), rL = openR(COL_LOGGED), rS = openR(COL_SOURCE),
        rT = openR(COL_TYPE),  rQ = openR(COL_QUERY);
  const bP = bndR(COL_PHONE), bL = bndR(COL_LOGGED), bS = bndR(COL_SOURCE),
        bT = bndR(COL_TYPE),  bQ = bndR(COL_QUERY);
  const q = s => '"' + String(s).replace(/"/g, '""') + '"';

  //  Period window, driven by the dropdown. Every figure on the sheet is
  //  filtered through these two cells, so one selection moves the whole tab.
  const PS = '$' + columnLetter(HELP_COL + 1) + '$1';     // period start
  const PE = '$' + columnLetter(HELP_COL + 1) + '$2';     // period end
  const inPeriod  = `${rL},">="&${PS},${rL},"<"&${PE}+1`;
  const inPeriodP = `(${bL}>=${PS})*(${bL}<${PE}+1)`;     // SUMPRODUCT form

  const opts    = getOptions();
  const sources = Object.keys(HEADERS.scratchQuery);

  const rows = [], secRows = [], subRows = [], warnRows = [];
  const add = (a, b, cc) => {
    rows.push([a === undefined ? '' : a, b === undefined ? '' : b, cc === undefined ? '' : cc]);
    return rows.length;
  };
  const blank   = () => add('', '', '');
  const section = t => { const r = add(t); secRows.push(r); return r; };
  const subhead = (a, b, cc) => { const r = add(a, b, cc); subRows.push(r); return r; };
  const addPct = (label, formula, denom) => {
    const r = rows.length + 1;
    rows.push([label, formula, denom ? `=IFERROR(B${r}/${denom},"")` : '']);
    return r;
  };

  // ── Title + period selector ──────────────────────────────
  add('📞 Call Log — Management Summary');
  add('Showing:', '', '');                       // B2 = the dropdown itself
  add('Live figures — they update as calls are logged. ' +
      'Structure rebuilt ' + Utilities.formatDate(new Date(), TZ, "dd MMM yyyy 'at' HH:mm"));
  blank();

  // ── Key numbers ──────────────────────────────────────────
  section('KEY NUMBERS');
  const rTotal = add('Total calls in period', `=COUNTIFS(${inPeriod})`);
  const TOT = '$B$' + rTotal;
  add('First call in period',  `=IFERROR(TEXT(MINIFS(${rL},${inPeriod}),"dd MMM yyyy"),"—")`);
  add('Most recent in period', `=IFERROR(TEXT(MAXIFS(${rL},${inPeriod}),"dd MMM yyyy HH:mm"),"—")`);
  add('Busiest single day',
      `=IFERROR(TEXT(MODE(ARRAYFORMULA(INT(FILTER(${rL},${rL}<>"",${rL}>=${PS},${rL}<${PE}+1)))),"dd MMM yyyy"),"—")`);
  add('Daily average',
      `=IFERROR(ROUND(${TOT}/COUNTUNIQUE(ARRAYFORMULA(INT(FILTER(${rL},${rL}<>"",${rL}>=${PS},${rL}<${PE}+1)))),1),0)`);
  blank();
  subhead('Regardless of the period above', '', '');
  add('Calls today',           `=COUNTIFS(${rL},">="&TODAY(),${rL},"<"&TODAY()+1)`);
  add('Calls in last 7 days',  `=COUNTIFS(${rL},">="&TODAY()-6,${rL},"<"&TODAY()+1)`);
  add('Last 14 days',
      `=IFERROR(SPARKLINE(ARRAYFORMULA(COUNTIFS(${rL},">="&SEQUENCE(1,14,TODAY()-13),` +
      `${rL},"<"&SEQUENCE(1,14,TODAY()-13)+1)),{"charttype","column";"color","${BRAND.gold}"}),"")`);
  blank();

  // ── Data quality ─────────────────────────────────────────
  section('DATA QUALITY — needs attention');
  warnRows.push(addPct('Rows with no Type of Call',
    `=SUMPRODUCT(${inPeriodP}*(${bT}=""))`, TOT));
  warnRows.push(addPct('Rows with no Nature of Query',
    `=SUMPRODUCT(${inPeriodP}*(${bQ}=""))`, TOT));
  warnRows.push(addPct('Callers not identified ("' + FALLBACK_SOURCE + '")',
    `=COUNTIFS(${rS},${q(FALLBACK_SOURCE)},${inPeriod})`, TOT));
  warnRows.push(addPct('Rows with a source but no phone number',
    `=SUMPRODUCT(${inPeriodP}*(${bP}="")*(${bS}<>""))`, TOT));
  add('These are blanks in the log, not script errors — fill them in on the Call Log tab.');
  blank();

  // ── By call source ───────────────────────────────────────
  section('WHO IS CALLING — by call source');
  subhead('Call source', 'Calls', '% of all');
  const srcStart = rows.length + 1;
  sources.forEach(s => addPct(s, `=COUNTIFS(${rS},${q(s)},${inPeriod})`, TOT));
  const srcEnd = rows.length;
  addPct('(not classified)', `=SUMPRODUCT(${inPeriodP}*(${bS}=""))`, TOT);
  blank();

  // ── By type of call ──────────────────────────────────────
  section('HOW THEY CALLED — by type of call');
  subhead('Type of call', 'Calls', '% of all');
  const typStart = rows.length + 1;
  opts.types.forEach(t => addPct(t, `=COUNTIFS(${rT},${q(t)},${inPeriod})`, TOT));
  const typEnd = rows.length;
  addPct('(not set)', `=SUMPRODUCT(${inPeriodP}*(${bT}=""))`, TOT);
  blank();

  // ── Nature of query, one block per source ────────────────
  sources.forEach(src => {
    section('WHY THEY CALLED — ' + src.toUpperCase());
    const rDen = subhead('All ' + src + ' calls', `=COUNTIFS(${rS},${q(src)},${inPeriod})`, '');
    const DEN = '$B$' + rDen;
    (opts.queries[src] || []).forEach(o =>
      addPct(o, `=COUNTIFS(${rS},${q(src)},${rQ},${q(o)},${inPeriod})`, DEN));
    addPct('(not set)', `=COUNTIFS(${rS},${q(src)},${rQ},"",${inPeriod})`, DEN);
    blank();
  });

  // ── ORDER MATTERS ────────────────────────────────────────
  //  The helper cells and the dropdown are written FIRST. Every figure below
  //  reads $AB$1/$AB$2, and a formula written before its dependency exists
  //  evaluates against an empty cell and caches that result — which showed up
  //  as "Total calls in period 0" while the date window read correctly.
  buildPeriodHelpers(sh, rL, PS, PE);
  //  The month list is a SPILL FORMULA. It must actually calculate before the
  //  dropdown can be validated against it, or setValue() is rejected with
  //  "the data you entered violates the data validation rules".
  SpreadsheetApp.flush();

  const selCell = sh.getRange(PERIOD_CELL);
  selCell.clearDataValidations();                // never reject our own write

  //  Keep the previous choice only if it's still on offer (a month can drop
  //  off the list). Value first, validation second — applying validation to a
  //  cell flags a bad value but never throws, whereas the reverse order does.
  const choices = sh.getRange(1, HELP_COL, 200, 1).getValues()
    .map(r => String(r[0] === undefined ? '' : r[0]).trim()).filter(String);
  selCell.setValue(choices.indexOf(prevSel) >= 0 ? prevSel : 'Overall');
  selCell.setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInRange(sh.getRange(1, HELP_COL, 200, 1), true)
    .setAllowInvalid(false).build());

  sh.getRange('C2').setFormula(
    `=IF(${PERIOD_CELL}="Overall","All calls ever logged",` +
    `"Showing "&TEXT(${PS},"dd MMM yyyy")&" to "&TEXT(${PE},"dd MMM yyyy"))`);
  SpreadsheetApp.flush();                        // settle AB1/AB2 before use

  //  Now the figures — row 2 keeps the dropdown and its caption, so write
  //  around it rather than over it.
  sh.getRange(1, 1, 1, 3).setValues([rows[0]]);
  sh.getRange(2, 1).setValue(rows[1][0]);
  sh.getRange(3, 1, rows.length - 2, 3).setValues(rows.slice(2));

  // ── Side panels ──────────────────────────────────────────
  //  Closes the SQL string, concatenates the date window, and leaves the
  //  string OPEN for the caller's " group by …" tail. The leading &" is what
  //  makes it a concatenation — without it the formula is a syntax error,
  //  which is why all three panels showed #ERROR!.
  const dateWhere = `"&" and ${c(COL_LOGGED)} >= datetime '"&TEXT(${PS},"yyyy-MM-dd HH:mm:ss")&` +
                    `"' and ${c(COL_LOGGED)} < datetime '"&TEXT(${PE}+1,"yyyy-MM-dd HH:mm:ss")&"'`;
  const panel = (col, title, formula) => {
    sh.getRange(PANEL_ROW, col, 1, 2).setBackground(BRAND.blue);
    sh.getRange(PANEL_ROW, col).setValue(title).setFontWeight('bold').setFontColor('#fff');
    sh.getRange(PANEL_ROW + 1, col).setFormula(formula);
  };
  panel(5, 'TOP REASONS FOR CALLING',
    `=IFERROR(QUERY(${CL}!A2:J,"select ${c(COL_QUERY)}, count(${c(COL_PHONE)}) ` +
    `where ${c(COL_QUERY)} is not null and ${c(COL_QUERY)} <> ''` + dateWhere +
    ` group by ${c(COL_QUERY)} order by count(${c(COL_PHONE)}) desc limit 20 ` +
    `label ${c(COL_QUERY)} 'Nature of query', count(${c(COL_PHONE)}) 'Calls'"),"No data yet")`);
  panel(8, 'PARENT CALLS BY GRADE',
    `=IFERROR(QUERY(${CL}!A2:J,"select ${c(COL_GRADE)}, count(${c(COL_PHONE)}) ` +
    `where ${c(COL_SOURCE)} = 'Parent' and ${c(COL_GRADE)} is not null and ${c(COL_GRADE)} <> ''` + dateWhere +
    ` group by ${c(COL_GRADE)} order by count(${c(COL_PHONE)}) desc ` +
    `label ${c(COL_GRADE)} 'Grade', count(${c(COL_PHONE)}) 'Calls'"),"No data yet")`);
  panel(11, 'CALLS BY MONTH',
    `=IFERROR(QUERY(${CL}!A2:J,"select year(${c(COL_LOGGED)}), month(${c(COL_LOGGED)})+1, ` +
    `count(${c(COL_PHONE)}) where ${c(COL_LOGGED)} is not null` + dateWhere +
    ` group by year(${c(COL_LOGGED)}), month(${c(COL_LOGGED)}) ` +
    `order by year(${c(COL_LOGGED)}) desc, month(${c(COL_LOGGED)}) desc ` +
    `label year(${c(COL_LOGGED)}) 'Year', month(${c(COL_LOGGED)})+1 'Month', ` +
    `count(${c(COL_PHONE)}) 'Calls'"),"No data yet")`);

  // ── Formatting ───────────────────────────────────────────
  sh.getRange('A1').setFontSize(18).setFontWeight('bold').setFontColor(BRAND.blue);
  sh.getRange('A2').setFontWeight('bold').setFontColor(BRAND.blue);
  selCell.setBackground(BRAND.lightGold).setFontWeight('bold')
    .setBorder(true, true, true, true, false, false, BRAND.blue, SpreadsheetApp.BorderStyle.SOLID);
  sh.getRange('C2').setFontColor('#666').setFontSize(9);
  sh.getRange('A3').setFontSize(9).setFontColor('#666');
  secRows.forEach(r => {
    sh.getRange(r, 1, 1, 3).merge()
      .setBackground(BRAND.blue).setFontColor('#fff').setFontWeight('bold')
      .setVerticalAlignment('middle');
    sh.setRowHeight(r, 24);
  });
  subRows.forEach(r => sh.getRange(r, 1, 1, 3)
    .setBackground(BRAND.lightGold).setFontWeight('bold')
    .setBorder(null, null, true, null, null, null, BRAND.blue, SpreadsheetApp.BorderStyle.SOLID));
  warnRows.forEach(r => sh.getRange(r, 1).setFontColor('#b00020'));

  sh.getRange(1, 2, rows.length, 1).setNumberFormat('#,##0').setHorizontalAlignment('right');
  sh.getRange(1, 3, rows.length, 1).setNumberFormat('0.0%').setHorizontalAlignment('right');
  sh.getRange('B2:C2').setNumberFormat('@');
  [[1,330],[2,110],[3,150],[4,24],[5,260],[6,70],[7,24],[8,150],[9,70],[10,24],[11,60],[12,60],[13,70]]
    .forEach(([col, w]) => sh.setColumnWidth(col, w));
  sh.setFrozenRows(3);

  sh.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule()
      .whenNumberEqualTo(0).setFontColor('#bbbbbb')
      .setRanges([sh.getRange(4, 2, rows.length - 3, 2)]).build(),
  ]);

  // ── Charts, at their remembered positions ────────────────
  insertSummaryCharts(sh, srcStart, srcEnd, typStart, typEnd, chartPos);
  SpreadsheetApp.flush();
}


//  Hidden columns holding the dropdown's option list and the resolved window.
//  Kept as formulas so the month list grows by itself as calls come in.
function buildPeriodHelpers(sh, rL, PS, PE) {
  const L = n => columnLetter(n);
  const cLabel = L(HELP_COL);           // dropdown options
  const cWin   = L(HELP_COL + 1);       // start / end
  const cDate  = L(HELP_COL + 2);       // month start dates, parallel to labels

  //  Distinct months present in the log, newest first.
  const months = `SORT(UNIQUE(ARRAYFORMULA(EOMONTH(FILTER(${rL},${rL}<>""),0))),1,FALSE)`;

  sh.getRange(cLabel + '1').setValue('Overall');
  sh.getRange(cLabel + '2').setValue('Current month');
  sh.getRange(cLabel + '3').setFormula(
    `=IFERROR(ARRAYFORMULA(TEXT(${months},"mmmm")&" '"&TEXT(${months},"yy")),"")`);
  sh.getRange(cDate + '3').setFormula(
    `=IFERROR(ARRAYFORMULA(EOMONTH(${months},-1)+1),"")`);

  //  Start / end of the selected window.
  const idx = `MATCH(${PERIOD_CELL},$${cLabel}$3:$${cLabel},0)`;
  sh.getRange(cWin + '1').setFormula(
    `=IF(${PERIOD_CELL}="Overall",DATE(1900,1,1),` +
    `IF(${PERIOD_CELL}="Current month",EOMONTH(TODAY(),-1)+1,` +
    `IFERROR(INDEX($${cDate}$3:$${cDate},${idx}),DATE(1900,1,1))))`);
  sh.getRange(cWin + '2').setFormula(
    `=IF(${PERIOD_CELL}="Overall",DATE(2999,12,31),` +
    `IF(${PERIOD_CELL}="Current month",EOMONTH(TODAY(),0),` +
    `IFERROR(EOMONTH(INDEX($${cDate}$3:$${cDate},${idx}),0),DATE(2999,12,31))))`);

  sh.hideColumns(HELP_COL, 3);
}


//  Chart anchors survive a rebuild: drag a chart where you want it, and every
//  future rebuild puts it back there. Positions are also saved to document
//  properties so they outlive a chart being deleted.
function captureChartPositions(sh) {
  const pos = sh.getCharts().map(ch => {
    const i = ch.getContainerInfo();
    return { col: i.getAnchorColumn(), row: i.getAnchorRow(),
             ox: i.getOffsetX(), oy: i.getOffsetY() };
  });
  if (pos.length) {
    PropertiesService.getDocumentProperties()
      .setProperty(CHART_POS_KEY, JSON.stringify(pos));
    return pos;
  }
  try {
    const saved = PropertiesService.getDocumentProperties().getProperty(CHART_POS_KEY);
    if (saved) return JSON.parse(saved);
  } catch (e) {}
  return null;
}

function insertSummaryCharts(sh, srcStart, srcEnd, typStart, typEnd, pos) {
  const at = (i, dflt) => (pos && pos[i]) ? pos[i] : dflt;
  const a = at(0, CHART_DEFAULT_POS[0]), b = at(1, CHART_DEFAULT_POS[1]);

  sh.insertChart(sh.newChart().asPieChart()
    .addRange(sh.getRange(srcStart, 1, srcEnd - srcStart + 1, 2))
    .setNumHeaders(0).setOption('title', 'Who is calling')
    .setOption('pieHole', 0.45).setOption('width', 380).setOption('height', 240)
    .setPosition(a.row, a.col, a.ox, a.oy).build());

  sh.insertChart(sh.newChart().asColumnChart()
    .addRange(sh.getRange(typStart, 1, typEnd - typStart + 1, 2))
    .setNumHeaders(0).setOption('title', 'How they called').setOption('legend', 'none')
    .setOption('colors', [BRAND.gold]).setOption('width', 380).setOption('height', 240)
    .setPosition(b.row, b.col, b.ox, b.oy).build());
}

//  Drag the charts, then run this — no rebuild required.
function lockChartPositions() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SUMMARY);
  const pos = sh ? captureChartPositions(sh) : null;
  SpreadsheetApp.getUi().alert(pos && pos.length
    ? '✅ Saved the position of ' + pos.length + ' chart(s).\n\n' +
      'Rebuilding the Summary will put them back exactly here.'
    : 'No charts found on the "' + SUMMARY + '" tab.');
}


// ═════════════════════════════════════════════════════════════
//  REPORTS TAB — date range in, PDF out, links kept here
// ═════════════════════════════════════════════════════════════
function buildReportsTab(ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(REPORTS) || ss.insertSheet(REPORTS);
  const existing = (sh.getLastRow() >= REP_FIRST_ROW)
    ? sh.getRange(REP_FIRST_ROW, 1, sh.getLastRow() - REP_FIRST_ROW + 1, 7).getValues()
    : [];                                  // never destroy the report history

  sh.clear();
  sh.getRange('A1').setValue('📄 Call Log — PDF Reports')
    .setFontSize(18).setFontWeight('bold').setFontColor(BRAND.blue);
  sh.getRange('A3').setValue('From date');
  sh.getRange('A4').setValue('To date');
  sh.getRange('B3:B4').setNumberFormat('yyyy-mm-dd')
    .setBackground(BRAND.lightGold).setFontWeight('bold')
    .setBorder(true, true, true, true, false, false, BRAND.blue, SpreadsheetApp.BorderStyle.SOLID);
  sh.getRange('B3:B4').setDataValidation(
    SpreadsheetApp.newDataValidation().requireDate().setAllowInvalid(false).build());
  sh.getRange('A6').setValue(
    'Enter both dates above, then: 📞 Call Log → Reports → "Generate PDF report". ' +
    'Both dates are included. Quick ranges (this month / last month / last 7 days) ' +
    'fill the dates in for you.').setFontSize(9).setFontColor('#666');

  const head = ['#','From','To','Calls','Generated At','Generated By','PDF'];
  sh.getRange(REP_HEAD_ROW, 1, 1, head.length).setValues([head])
    .setBackground(BRAND.blue).setFontColor('#fff').setFontWeight('bold');
  if (existing.length) {
    sh.getRange(REP_FIRST_ROW, 1, existing.length, 7).setValues(existing);
  }
  [[1,50],[2,110],[3,110],[4,70],[5,170],[6,220],[7,120]]
    .forEach(([col, w]) => sh.setColumnWidth(col, w));
  //  Column A holds zero-padded numbers ("007") — keep it text, not numeric.
  sh.getRange(REP_FIRST_ROW, 1, sh.getMaxRows() - REP_FIRST_ROW + 1, 1).setNumberFormat('@');
  sh.setFrozenRows(REP_HEAD_ROW);
  return sh;
}


//  Quick ranges — write the dates, then run the same core.
function reportThisMonth() {
  const now = new Date();
  runReport(new Date(now.getFullYear(), now.getMonth(), 1), now);
}
function reportLastMonth() {
  const now = new Date();
  runReport(new Date(now.getFullYear(), now.getMonth() - 1, 1),
            new Date(now.getFullYear(), now.getMonth(), 0));
}
function reportLast7Days() {
  const now = new Date(), from = new Date(now);
  from.setDate(from.getDate() - 6);
  runReport(from, now);
}

//  Uses whatever is typed on the Reports tab.
function generateReport() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(REPORTS) || buildReportsTab(ss);
  const from = sh.getRange('B3').getValue(), to = sh.getRange('B4').getValue();
  if (!(from instanceof Date) || !(to instanceof Date)) {
    SpreadsheetApp.getUi().alert(
      'Please enter both a From date and a To date on the "' + REPORTS + '" tab first.');
    return;
  }
  runReport(from, to);
}

function runReport(from, to) {
  const ui = SpreadsheetApp.getUi();
  if (from > to) { ui.alert('The From date is after the To date. Please swap them.'); return; }

  const ss  = SpreadsheetApp.getActiveSpreadsheet();
  const sh  = ss.getSheetByName(REPORTS) || buildReportsTab(ss);
  const agg = aggregateRange(from, to);
  if (!agg.total) {
    ui.alert('No calls logged between ' + fmtDate(from) + ' and ' + fmtDate(to) +
             '. Nothing to report.');
    return;
  }

  const num  = ('00' + nextReportNumber(sh)).slice(-3);   // 1 → "001"
  const name = 'Call Log Report ' + num +
               ' - ' + fmtDate(from) + ' to ' + fmtDate(to) +
               ' (generated ' + fmtDate(new Date()) + ').pdf';

  let file;
  try {
    const pdf = Utilities.newBlob(buildReportHtml(agg, from, to), 'text/html', name)
      .getAs('application/pdf').setName(name);
    file = getReportsFolder(ss).createFile(pdf);
  } catch (err) {
    ui.alert('Could not create the PDF.\n\n' + err.message +
             '\n\nIf this mentions authorisation, run the menu item once more and approve ' +
             'Drive access when asked.');
    return;
  }

  //  Write dates as text so they can never be reinterpreted by locale.
  sh.appendRow([num, fmtDate(from), fmtDate(to), agg.total,
                Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm'),
                Session.getActiveUser().getEmail() || '(unknown)',
                '=HYPERLINK("' + file.getUrl() + '","📄 Open PDF")']);
  sh.getRange(sh.getLastRow(), 1).setNumberFormat('@');
  ss.setActiveSheet(sh);

  ui.alert('✅ Report ' + num + ' created.\n\n' + name + '\n\n' +
           agg.total + ' call(s) in range. The link is on the "' + REPORTS + '" tab.');
}


//  Folder: sibling of the sheet's own folder, "<folder minus trailing ]> REPORTS]".
function getReportsFolder(ss) {
  const parents = DriveApp.getFileById(ss.getId()).getParents();
  const parent  = parents.hasNext() ? parents.next() : DriveApp.getRootFolder();
  const base    = parent.getName();
  const name    = /\]\s*$/.test(base)
    ? base.replace(/\s*\]\s*$/, '') + ' REPORTS]'
    : base + ' REPORTS';
  const it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

function openReportsFolder() {
  const f = getReportsFolder(SpreadsheetApp.getActiveSpreadsheet());
  SpreadsheetApp.getUi().alert('Reports folder:\n\n' + f.getName() + '\n' + f.getUrl());
}

//  Highest number already used, +1. Survives deleted rows and manual edits.
function nextReportNumber(sh) {
  if (sh.getLastRow() < REP_FIRST_ROW) return 1;
  const v = sh.getRange(REP_FIRST_ROW, 1, sh.getLastRow() - REP_FIRST_ROW + 1, 1).getValues();
  let max = 0;
  v.forEach(r => {
    const n = parseInt(String(r[0]).replace(/\D/g, ''), 10);
    if (!isNaN(n) && n > max) max = n;
  });
  return max + 1;
}

function fmtDate(d) { return Utilities.formatDate(d, TZ, 'yyyy-MM-dd'); }


// ─────────────────────────────────────────────────────────────
//  AGGREGATION — one read of the Call Log, everything counted
// ─────────────────────────────────────────────────────────────
function aggregateRange(from, to) {
  const start = new Date(from); start.setHours(0, 0, 0, 0);
  const end   = new Date(to);   end.setHours(23, 59, 59, 999);

  const v = SpreadsheetApp.getActiveSpreadsheet()
    .getSheetByName(CALL_LOG).getDataRange().getValues();

  const NOT_SET = '(not recorded)';
  const agg = { total: 0, noType: 0, noQuery: 0,
                bySource: {}, byType: {}, byQuery: {}, byGrade: {}, byDay: {},
                start: start, end: end };
  const bump = (obj, k) => { obj[k] = (obj[k] || 0) + 1; };

  for (let i = 1; i < v.length; i++) {
    const when = v[i][COL_LOGGED - 1];
    if (!(when instanceof Date) || when < start || when > end) continue;

    const src   = String(v[i][COL_SOURCE - 1] || '').trim() || NOT_SET;
    const type  = String(v[i][COL_TYPE   - 1] || '').trim();
    const query = String(v[i][COL_QUERY  - 1] || '').trim();
    const grade = String(v[i][COL_GRADE  - 1] || '').trim();

    agg.total++;
    bump(agg.bySource, src);
    bump(agg.byType, type || NOT_SET);
    if (!type)  agg.noType++;
    if (!query) agg.noQuery++;
    if (!agg.byQuery[src]) agg.byQuery[src] = {};
    bump(agg.byQuery[src], query || NOT_SET);
    if (src === 'Parent' && grade) bump(agg.byGrade, grade);
    bump(agg.byDay, fmtDate(when));
  }
  agg.NOT_SET = NOT_SET;
  return agg;
}


// ─────────────────────────────────────────────────────────────
//  REPORT HTML → PDF.  Brand palette, print-friendly.
// ─────────────────────────────────────────────────────────────
function buildReportHtml(agg, from, to) {
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const pct = (n, d) => d ? (Math.round(n / d * 1000) / 10).toFixed(1) + '%' : '—';

  //  Biggest first — management reads the top of the table.
  const sorted = obj => Object.keys(obj)
    .map(k => [k, obj[k]])
    .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));

  const table = (heading, obj, denom, unit) => {
    const rows = sorted(obj);
    if (!rows.length) return '';
    return '<h2>' + esc(heading) + '</h2><table><thead><tr>' +
      '<th>' + esc(unit) + '</th><th class="n">Calls</th><th class="n">Share</th>' +
      '</tr></thead><tbody>' +
      rows.map(([k, n]) =>
        '<tr' + (k === agg.NOT_SET ? ' class="muted"' : '') + '>' +
        '<td>' + esc(k) + '</td><td class="n">' + n + '</td>' +
        '<td class="n">' + pct(n, denom) + '</td></tr>').join('') +
      '</tbody><tfoot><tr><td>Total</td><td class="n">' + denom +
      '</td><td class="n">100%</td></tr></tfoot></table>';
  };

  const days   = Object.keys(agg.byDay).length;
  const busiest = sorted(agg.byDay)[0] || ['—', 0];
  const kpi = (label, value) =>
    '<div class="kpi"><div class="kv">' + esc(value) + '</div><div class="kl">' +
    esc(label) + '</div></div>';

  let html =
  '<style>' +
  '@page{size:A4 landscape;margin:12mm 10mm}' +
  'body{font-family:Helvetica,Arial,sans-serif;color:#222;font-size:10pt;margin:0}' +
  'h1{color:' + BRAND.blue + ';font-size:19pt;margin:0}' +
  '.sub{color:#666;font-size:9pt;margin:2mm 0 6mm}' +
  '.rule{height:3px;background:' + BRAND.gold + ';margin:0 0 5mm}' +
  'h2{color:' + BRAND.blue + ';font-size:12pt;margin:7mm 0 2mm;' +
     'border-bottom:1px solid ' + BRAND.line + ';padding-bottom:1mm}' +
  'table{width:100%;border-collapse:collapse;font-size:9.5pt}' +
  'th,td{padding:2.2mm 2.5mm;border-bottom:1px solid ' + BRAND.line + ';text-align:left}' +
  'thead th{background:' + BRAND.blue + ';color:#fff;font-size:9pt}' +
  'td.n,th.n{text-align:right;white-space:nowrap}' +
  'tfoot td{font-weight:bold;background:' + BRAND.lightGold + '}' +
  'tr.muted td{color:#999;font-style:italic}' +
  '.kpis{display:table;width:100%;table-layout:fixed;border-spacing:2mm 0}' +
  '.kpi{display:table-cell;background:' + BRAND.lightGold + ';border-left:3px solid ' +
       BRAND.gold + ';padding:3mm;text-align:center}' +
  '.kv{font-size:16pt;font-weight:bold;color:' + BRAND.blue + '}' +
  '.kl{font-size:7.5pt;color:#555;text-transform:uppercase;letter-spacing:.4pt}' +
  '.warn{background:#fff4e5;border-left:3px solid #d98800;padding:3mm;font-size:9pt;margin:5mm 0}' +
  //  Landscape is wide: run the breakdown tables two abreast rather than
  //  stretching each one across the whole page.
  '.grid{width:100%;border-collapse:separate;border-spacing:5mm 0;table-layout:fixed}' +
  //  Only border-BOTTOM is overridden — killing all borders would also wipe
  //  the signature rule further down.
  '.gcell{width:50%;vertical-align:top;border-bottom:none !important;padding:0}' +
  '.grid h2{margin-top:5mm}' +
  //  Keep a heading with the start of its table. Deliberately NOT
  //  page-break-inside:avoid on the rows — that shunts whole 2-table rows
  //  onto fresh pages and leaves half the report blank. Long tables may
  //  split; their header row repeats, so a split stays readable.
  'h2{page-break-after:avoid;break-after:avoid}' +
  'thead{display:table-header-group}' +
  //  Signature row — kept whole, never split across a page break.
  //  separate + spacing keeps the three rules discrete; collapse would fuse
  //  them into one line straight across the page.
  '.sig{width:100%;table-layout:fixed;border-collapse:separate;border-spacing:9mm 0;' +
       'margin-top:10mm;page-break-inside:avoid;break-inside:avoid}' +
  '.sig td{border-bottom:none !important;padding:0;vertical-align:bottom;text-align:left}' +
  '.sig .cap{font-size:8pt;color:#666;text-transform:uppercase;letter-spacing:.4pt;' +
             'padding-bottom:16mm}' +
  '.sig .ln{border-top:1px solid #333;padding-top:1.5mm;font-weight:bold;' +
            'color:' + BRAND.blue + ';font-size:10pt}' +
  '.foot{margin-top:6mm;border-top:1px solid ' + BRAND.line +
        ';padding-top:2mm;color:#888;font-size:8pt}' +
  '</style>' +
  '<h1>Call Log Report</h1>' +
  '<div class="sub"><b>' + esc(fmtDate(from)) + '</b> to <b>' + esc(fmtDate(to)) +
  '</b> &nbsp;·&nbsp; both dates included<br>' +
  'Generated ' + esc(Utilities.formatDate(new Date(), TZ, "dd MMM yyyy 'at' HH:mm")) +
  ' &nbsp;·&nbsp; ' + esc(SpreadsheetApp.getActiveSpreadsheet().getName()) + '</div>' +
  '<div class="rule"></div>' +
  '<div class="kpis">' +
    kpi('Total calls', agg.total) +
    kpi('Days covered', days) +
    kpi('Avg per active day', days ? (Math.round(agg.total / days * 10) / 10) : 0) +
    kpi('Busiest day', busiest[0] + ' (' + busiest[1] + ')') +
  '</div>';

  if (agg.noType || agg.noQuery) {
    html += '<div class="warn"><b>Incomplete entries in this period:</b> ' +
      agg.noType + ' call(s) with no Type of Call (' + pct(agg.noType, agg.total) + '), ' +
      agg.noQuery + ' with no Nature of Query (' + pct(agg.noQuery, agg.total) + '). ' +
      'Percentages below are of all calls in range, so these appear as ' +
      esc(agg.NOT_SET) + '.</div>';
  }

  const blocks = [
    table('Who is calling',  agg.bySource, agg.total, 'Call source'),
    table('How they called', agg.byType,   agg.total, 'Type of call'),
  ];
  //  Why they called — one table per source, ordered by that source's volume.
  sorted(agg.bySource).forEach(([src, n]) => {
    if (agg.byQuery[src]) blocks.push(table('Why they called — ' + src, agg.byQuery[src], n, 'Nature of query'));
  });
  if (Object.keys(agg.byGrade).length) {
    blocks.push(table('Parent calls by grade', agg.byGrade,
                      agg.bySource['Parent'] || agg.total, 'Grade'));
  }
  blocks.push('<h2>Daily volume</h2><table><thead><tr><th>Date</th><th class="n">Calls</th>' +
    '</tr></thead><tbody>' +
    Object.keys(agg.byDay).sort().map(d =>
      '<tr><td>' + esc(d) + '</td><td class="n">' + agg.byDay[d] + '</td></tr>').join('') +
    '</tbody></table>');

  //  Two per row; a trailing odd block gets an empty partner cell.
  const live = blocks.filter(String);
  html += '<table class="grid"><tbody>';
  for (let i = 0; i < live.length; i += 2) {
    html += '<tr><td class="gcell">' + live[i] + '</td>' +
            '<td class="gcell">' + (live[i + 1] || '') + '</td></tr>';
  }
  html += '</tbody></table>';

  html += '<div class="foot">Christwood School — generated automatically from the Call Log. ' +
          'Days with no calls are omitted from the daily table.</div>';

  html += '<table class="sig"><tbody><tr>' +
    SIGNATORIES.map(() => '<td class="cap">Signature</td>').join('') +
    '</tr><tr>' +
    SIGNATORIES.map(s => '<td class="ln">' + esc(s) + '</td>').join('') +
    '</tr></tbody></table>';
  return html;
}