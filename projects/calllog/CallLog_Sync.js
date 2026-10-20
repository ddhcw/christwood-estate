// ============================================================
//  CHRISTWOOD SCHOOL — CALL LOG, SYNC TRANSPORT
//
//  Web-app entry point for the capture app. Replaces MacroDroid's
//  one-POST-per-call arrangement with:
//    • a shared secret on every request
//    • a BATCH sync, so the SD/HR indexes are built once per sync
//      instead of once per call (each legacy POST re-read a
//      ~1,400-row x 70-column roster)
//    • deterministic hash dedupe, so re-runs, overlap windows,
//      backfills and a phone that was offline are all safe
//    • an options endpoint, so the app's classify picker shows the
//      same lists as the sheet's dropdowns
//
//  The Call Log's own columns are UNCHANGED. The dedupe index lives in
//  its own hidden sheet, deliberately: columns K-V of the Call Log are
//  occupied (K is an abandoned half-filled date column, L-V a hand-built
//  analysis block), so adding columns there is not currently safe.
//  Duration is captured into the index now and can be surfaced in the log
//  later without re-syncing anything.
//
//  ⚠ Same deployment rule as always — the app posts to a VERSIONED
//  deployment, so `clasp push` alone changes nothing for incoming calls:
//    clasp push -f && clasp deploy --deploymentId <ID> -d "<note>"
// ============================================================

const SYNC_SHEET = '_sync';

//  Script Properties (never in source):
//    CALLLOG_SECRET        the shared secret the app sends
//    CALLLOG_ENFORCE_AUTH  'true' once MacroDroid is migrated — see below
const PROP_SECRET  = 'CALLLOG_SECRET';
const PROP_ENFORCE = 'CALLLOG_ENFORCE_AUTH';
const PROP_UNAUTH  = 'CALLLOG_UNAUTH_COUNT';
const PROP_LASTSYNC = 'CALLLOG_LAST_SYNC';

const SYNC_HEADERS = ['Call ID', 'Call Log Row', 'Call At', 'Duration (s)',
                      'Direction', 'Synced At', 'Device'];

//  One sync must not exceed the 6-minute execution limit. The app chunks
//  anything larger and syncs again; nothing is lost because dedupe is by hash.
const MAX_CALLS_PER_SYNC = 400;


// ─────────────────────────────────────────────────────────────
//  WEB APP ENTRY
// ─────────────────────────────────────────────────────────────
function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return json({ status: 'error', message: 'empty body' });
    }
    let data;
    try {
      data = JSON.parse(e.postData.contents);
    } catch (parseErr) {
      return json({ status: 'error', message: 'body is not valid JSON' });
    }
    return dispatchPost(data);
  } catch (err) {
    return json({ status: 'error', message: err.message });
  }
}

function dispatchPost(data) {
  const auth = authorise(data);
  if (!auth.ok) {
    return json({ status: 'error', message: 'unauthorised' });
  }

  const action = String((data && data.action) || '').toLowerCase();

  //  No action at all = MacroDroid's original {number, direction} body.
  if (!action || action === 'log') return handleLegacyPost(data);

  switch (action) {
    case 'sync':     return json(syncCalls(data));
    case 'classify': return json(classifyCall(data));
    case 'options': return json(optionsPayload());
    case 'ping':    return json({ status: 'ok', authenticated: auth.authenticated,
                                  enforcing: auth.enforcing, time: nowStamp() });
    default:        return json({ status: 'error', message: 'unknown action: ' + action });
  }
}


// ─────────────────────────────────────────────────────────────
//  AUTH — two-phase, so deploying this cannot stop calls being logged
//
//  Phase 1 (CALLLOG_ENFORCE_AUTH unset/false): requests WITHOUT a valid
//  secret are still accepted, but counted in CALLLOG_UNAUTH_COUNT. Deploy,
//  then update MacroDroid (or retire it) and watch that counter stop rising.
//  Phase 2: set CALLLOG_ENFORCE_AUTH='true'. Unauthenticated requests are
//  then rejected and the public endpoint is closed.
//
//  Flipping it the other way round — enforcing from the first deploy —
//  silently drops every call between the deploy and the MacroDroid edit,
//  which needs the handset in hand.
// ─────────────────────────────────────────────────────────────
function authorise(data) {
  const props   = PropertiesService.getScriptProperties();
  const secret  = props.getProperty(PROP_SECRET) || '';
  const enforce = String(props.getProperty(PROP_ENFORCE) || 'false').toLowerCase() === 'true';
  const given   = String((data && data.secret) || '');

  if (secret && given && constantTimeEquals(given, secret)) {
    return { ok: true, authenticated: true, enforcing: enforce };
  }
  if (!enforce) {
    //  Visible evidence of how much unauthenticated traffic is left.
    const n = parseInt(props.getProperty(PROP_UNAUTH) || '0', 10) || 0;
    props.setProperty(PROP_UNAUTH, String(n + 1));
    return { ok: true, authenticated: false, enforcing: false };
  }
  return { ok: false, authenticated: false, enforcing: true };
}

//  Compares in time independent of where the first difference falls. The
//  length check leaks length only, which is not sensitive here.
function constantTimeEquals(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a.charCodeAt(i) ^ b.charCodeAt(i));
  return diff === 0;
}

//  Run once from the editor to mint and store a secret. Prints it so it can
//  be copied into the app; it is never written to source or to a sheet.
function generateSharedSecret() {
  //  NOT Math.random — it is a PRNG, not a cryptographic source, and this
  //  value is the only thing standing in front of a public endpoint.
  //  getUuid() is v4 and seeded from the platform's secure source; hashing
  //  two of them plus the clock gives 256 bits with no single weak input.
  const seed = Utilities.getUuid() + '|' + Utilities.getUuid() + '|' + Date.now();
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, seed,
                                         Utilities.Charset.UTF_8);
  const secret = Utilities.base64EncodeWebSafe(digest).replace(/=+$/, '');
  PropertiesService.getScriptProperties().setProperty(PROP_SECRET, secret);
  Logger.log('Shared secret stored in Script Properties. Copy into the app:\n\n' + secret);
  return secret;
}


// ─────────────────────────────────────────────────────────────
//  BATCH SYNC
//
//  Payload:
//  { secret, action:'sync',
//    device: { id, model, androidVersion, appVersion, battery, queued },
//    calls: [ { id, number, direction, startedAt, duration } ] }
//
//    id         deterministic hash from the app — the dedupe key
//    startedAt  epoch millis of the CALL, not of the sync. A phone that
//               was offline for a day still logs calls at their real time.
//    direction  INCOMING | OUTGOING | MISSED | REJECTED | BLOCKED | VOICEMAIL
//
//  Returns { status, added, duplicates, rows:[{id,row,source}] } so the app
//  holds a row handle for each call and can write a classification back.
// ─────────────────────────────────────────────────────────────
function syncCalls(data) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);

    const calls = (data && Array.isArray(data.calls)) ? data.calls : [];
    recordHeartbeat(data && data.device, calls.length);
    if (!calls.length) return { status: 'ok', added: 0, duplicates: 0, rows: [] };
    if (calls.length > MAX_CALLS_PER_SYNC) {
      return { status: 'error',
               message: 'too many calls in one sync (max ' + MAX_CALLS_PER_SYNC + ')' };
    }

    const ss    = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(CALL_LOG);
    if (!sheet) return { status: 'error', message: 'Call Log sheet not found' };

    const index = ensureSyncSheet(ss);
    const known = loadKnownIds(index);

    //  Indexes built ONCE for the whole batch.
    const sdIdx = buildSDIndex(), hrIdx = buildHRIndex();

    const fresh = [], rowsOut = [], sources = [], sibLists = [], indexRows = [];
    let duplicates = 0;

    calls.forEach(c => {
      const id = String((c && c.id) || '').trim();
      if (!id) return;
      if (known.has(id)) {
        duplicates++;
        //  Only report a row when one actually exists. A repeat inside this
        //  same payload has no row yet; returning 0 would invite the app to
        //  write a classification onto row 0.
        const existing = known.get(id);
        if (existing) rowsOut.push({ id: id, row: existing, duplicate: true });
        return;
      }
      known.set(id, 0);                       // guard against repeats inside one payload

      const number = normaliseNumber(c.number || '');
      const r      = resolve(number, sdIdx, hrIdx);
      const isSib  = r.siblings === true;
      const when   = toDate(c.startedAt);

      const row = new Array(TOTAL_COLS).fill('');
      row[COL_PHONE   - 1] = number;
      row[COL_LOGGED  - 1] = when;
      row[COL_SOURCE  - 1] = r.source;
      row[COL_TYPE    - 1] = directionToType(c.direction);
      row[COL_CALLER  - 1] = r.callerName || '';
      row[COL_STUDENT - 1] = isSib ? '' : (r.studentName || '');
      row[COL_GRADE   - 1] = isSib ? '' : (r.grade || '');
      row[COL_SECTION - 1] = isSib ? '' : (r.section || '');

      fresh.push(row);
      sources.push(r.source);
      sibLists.push(isSib && Array.isArray(r.studentName) ? r.studentName : null);
      indexRows.push({ id: id, when: when, duration: numberOr(c.duration, ''),
                       direction: String(c.direction || '') });
    });

    if (!fresh.length) {
      return { status: 'ok', added: 0, duplicates: duplicates, rows: rowsOut };
    }

    //  One write for the whole block.
    const firstRow = sheet.getLastRow() + 1;
    const needed   = firstRow + fresh.length - 1;
    if (sheet.getMaxRows() < needed) sheet.insertRowsAfter(sheet.getMaxRows(), needed - sheet.getMaxRows());
    sheet.getRange(firstRow, 1, fresh.length, TOTAL_COLS).setValues(fresh);

    applyBlockValidation(sheet, firstRow, sources, sibLists);
    styleBlock(sheet, firstRow, sources);

    //  Sibling marker notes, only on the rows that need one.
    sibLists.forEach((names, i) => {
      const cell = sheet.getRange(firstRow + i, COL_PHONE);
      if (names && names.length) cell.setNote('SIBLINGS:' + names.join('|'));
      else cell.clearNote();
    });

    //  Record the index last: a row that exists but is unindexed would be
    //  re-added on the next sync, whereas an indexed row that failed to write
    //  would be lost. Writing the sheet first makes the failure mode a
    //  duplicate, which is visible, rather than a silent gap.
    const idxValues = indexRows.map((ir, i) => [
      ir.id, firstRow + i, ir.when, ir.duration, ir.direction, new Date(),
      (data.device && data.device.id) || '',
    ]);
    const idxFirst = index.getLastRow() + 1;
    if (index.getMaxRows() < idxFirst + idxValues.length - 1) {
      index.insertRowsAfter(index.getMaxRows(),
                            idxFirst + idxValues.length - 1 - index.getMaxRows());
    }
    index.getRange(idxFirst, 1, idxValues.length, SYNC_HEADERS.length).setValues(idxValues);

    indexRows.forEach((ir, i) => rowsOut.push({
      id: ir.id, row: firstRow + i, source: sources[i],
      caller: fresh[i][COL_CALLER - 1] || '',
      student: fresh[i][COL_STUDENT - 1] || '',
      grade: fresh[i][COL_GRADE - 1] || '',
      needsQuery: true,
    }));
    return { status: 'ok', added: fresh.length, duplicates: duplicates, rows: rowsOut };

  } catch (err) {
    return { status: 'error', message: err.message };
  } finally {
    try { lock.releaseLock(); } catch (e2) {}
  }
}

//  Android's call types, including the three MacroDroid never reported.
//  Anything unrecognised leaves Type of Call blank for the operator rather
//  than inventing a value.
function directionToType(direction) {
  const map = {
    INCOMING: 'Incoming', OUTGOING: 'Outgoing', MISSED: 'Missed',
    REJECTED: 'Missed',   BLOCKED: 'Missed',    VOICEMAIL: 'Missed',
  };
  return map[String(direction || '').toUpperCase()] || '';
}

function toDate(startedAt) {
  const n = Number(startedAt);
  if (isFinite(n) && n > 0) return new Date(n);
  const d = new Date(startedAt);
  return isNaN(d.getTime()) ? new Date() : d;
}

function numberOr(v, fallback) {
  //  Number(null) and Number('') are both 0, which would record a missing
  //  duration as a zero-second call — indistinguishable from a real rejected
  //  or blocked call. Treat absent as absent.
  if (v === null || v === undefined || v === '') return fallback;
  const n = Number(v);
  return isFinite(n) ? n : fallback;
}


// ─────────────────────────────────────────────────────────────
//  BATCHED VALIDATION + STYLING
//  Per-row versions exist for the legacy path; these do the whole block in
//  a handful of calls so a 200-call sync costs the same as a 1-call sync.
// ─────────────────────────────────────────────────────────────
function applyBlockValidation(sheet, firstRow, sources, sibLists) {
  const n     = sources.length;
  const tRule = listOrRange(typeRange(), callTypeOptions());
  const byS   = {};
  const ruleFor = src => {
    if (!(src in byS)) byS[src] = listOrRange(queryRange(src), queryOptions(src));
    return byS[src];
  };

  const tRules = [], qRules = [], sRules = [];
  for (let i = 0; i < n; i++) {
    tRules.push([tRule]);
    qRules.push([ruleFor(sources[i])]);
    const sib = sibLists[i];
    //  null clears the cell's validation — necessary, or a sibling dropdown
    //  propagates onto rows that correctly auto-filled a single student.
    sRules.push([(sib && sib.length)
      ? SpreadsheetApp.newDataValidation().requireValueInList(sib, true)
          .setAllowInvalid(false).build()
      : null]);
  }
  sheet.getRange(firstRow, COL_TYPE,    n, 1).setDataValidations(tRules);
  sheet.getRange(firstRow, COL_QUERY,   n, 1).setDataValidations(qRules);
  sheet.getRange(firstRow, COL_STUDENT, n, 1).setDataValidations(sRules);
}

function styleBlock(sheet, firstRow, sources) {
  const n = sources.length;
  const bgs = [], studentColours = [];
  sources.forEach(src => {
    const bg = src === 'Parent' ? '#e6f4ea'
             : src === 'Staff'  ? '#e8f0fe'
             : src === 'Someone else' ? '#fff3e0' : '#f8f9fa';
    const row = new Array(TOTAL_COLS).fill(bg);
    if (src !== 'Parent') {
      row[COL_STUDENT - 1] = '#e8eaed';
      row[COL_GRADE   - 1] = '#e8eaed';
      row[COL_SECTION - 1] = '#e8eaed';
    }
    bgs.push(row);
    const fc = src === 'Parent' ? '#000000' : '#aaaaaa';
    studentColours.push([fc, fc, fc]);
  });
  sheet.getRange(firstRow, 1, n, TOTAL_COLS).setBackgrounds(bgs);
  sheet.getRange(firstRow, COL_PHONE, n, 1).setFontWeight('bold');
  sheet.getRange(firstRow, COL_STUDENT, n, 3).setFontColors(studentColours);
}


// ─────────────────────────────────────────────────────────────
//  DEDUPE INDEX
// ─────────────────────────────────────────────────────────────
function ensureSyncSheet(ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SYNC_SHEET);
  if (!sh) {
    sh = ss.insertSheet(SYNC_SHEET);
    sh.hideSheet();
  }
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, SYNC_HEADERS.length).setValues([SYNC_HEADERS])
      .setBackground(BRAND.primary).setFontColor('#fff').setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.setColumnWidth(1, 150);
  }
  return sh;
}

//  One read of the id column for the whole sync.
function loadKnownIds(index) {
  const map = new Map();
  const last = index.getLastRow();
  if (last < 2) return map;
  const v = index.getRange(2, 1, last - 1, 2).getValues();
  v.forEach(r => {
    const id = String(r[0] || '').trim();
    if (id) map.set(id, r[1]);
  });
  return map;
}


// ─────────────────────────────────────────────────────────────
//  OPTIONS — the app's classify picker reads the same scratch lists the
//  sheet's own dropdowns do, so the two can never drift apart.
// ─────────────────────────────────────────────────────────────
function optionsPayload() {
  const o = getOptions();
  return {
    status: 'ok',
    types: o.types,
    queries: o.queries,
    sources: Object.keys(HEADERS.scratchQuery),
    fallbackSource: FALLBACK_SOURCE,
  };
}


// ─────────────────────────────────────────────────────────────
//  HEARTBEAT — a handset that stops syncing must announce itself. Today a
//  dead phone just stops producing rows and nobody finds out.
//  (Silence ALERTING to the Ops Alerts space is the next piece; this records
//  the state it will read.)
// ─────────────────────────────────────────────────────────────
function recordHeartbeat(device, callCount) {
  try {
    PropertiesService.getScriptProperties().setProperty(PROP_LASTSYNC, JSON.stringify({
      at: nowStamp(),
      calls: callCount || 0,
      device: device || null,
    }));
  } catch (e) { /* a heartbeat must never fail a sync */ }
}

function nowStamp() {
  return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss');
}


// ─────────────────────────────────────────────────────────────
//  MENU HELPERS — the auth cutover is run from the sheet, not the editor,
//  so whoever does it can see the state they are changing.
// ─────────────────────────────────────────────────────────────
function syncStatus() {
  const props = PropertiesService.getScriptProperties();
  const secret  = props.getProperty(PROP_SECRET);
  const enforce = String(props.getProperty(PROP_ENFORCE) || 'false').toLowerCase() === 'true';
  const unauth  = props.getProperty(PROP_UNAUTH) || '0';
  let last = props.getProperty(PROP_LASTSYNC);
  try { last = last ? JSON.parse(last) : null; } catch (e) { last = null; }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const idx = ss.getSheetByName(SYNC_SHEET);
  const indexed = idx && idx.getLastRow() > 1 ? idx.getLastRow() - 1 : 0;

  const lines = [
    'Shared secret:        ' + (secret ? 'set' : 'NOT SET — run "Generate shared secret"'),
    'Authentication:       ' + (enforce ? 'ENFORCED' : 'not enforced (phase 1)'),
    'Unauthenticated hits: ' + unauth + (enforce ? '' : '  ← should stop rising once the app is live'),
    '',
    'Calls in sync index:  ' + indexed,
    'Last sync:            ' + (last ? last.at + '  (' + last.calls + ' call(s))' : 'never'),
  ];
  if (last && last.device) {
    const d = last.device;
    lines.push('Device:               ' +
      [d.model, d.androidVersion ? 'Android ' + d.androidVersion : '', d.appVersion ? 'app ' + d.appVersion : '']
        .filter(String).join(' · '));
    if (d.battery !== undefined && d.battery !== null) lines.push('Battery:              ' + d.battery + '%');
    if (d.queued) lines.push('Queued on device:     ' + d.queued);
  }
  SpreadsheetApp.getUi().alert('📶 Sync status\n\n' + lines.join('\n'));
}

function generateSharedSecretUi() {
  const ui = SpreadsheetApp.getUi();
  const existing = PropertiesService.getScriptProperties().getProperty(PROP_SECRET);
  if (existing) {
    const go = ui.alert('A shared secret is already set.',
      'Generating a new one immediately stops the current app from syncing until the ' +
      'new secret is entered on the handset.\n\nReplace it?', ui.ButtonSet.YES_NO);
    if (go !== ui.Button.YES) return;
  }
  const secret = generateSharedSecret();
  //  Shown once, in a dialog, and never written to a sheet or a log the
  //  whole school can read.
  ui.alert('🔑 Shared secret created\n\n' + secret +
    '\n\nEnter this in the app on the handset now. It is stored in Script ' +
    'Properties; this dialog is the only time it is displayed.');
}

function enforceAuthUi() {
  const ui = SpreadsheetApp.getUi();
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty(PROP_SECRET)) {
    ui.alert('No shared secret is set yet. Run "Generate shared secret" first, ' +
             'and enter it in the app, before enforcing.');
    return;
  }
  const unauth = props.getProperty(PROP_UNAUTH) || '0';
  const go = ui.alert('Enforce authentication?',
    'Requests without the shared secret will be REJECTED from now on.\n\n' +
    'Unauthenticated requests so far: ' + unauth + '\n\n' +
    'If MacroDroid is still running and has not been given the secret, it will ' +
    'stop logging calls the moment you confirm. Check that counter has stopped ' +
    'rising first.', ui.ButtonSet.YES_NO);
  if (go !== ui.Button.YES) return;
  props.setProperty(PROP_ENFORCE, 'true');
  ui.alert('✅ Authentication is now enforced. The endpoint no longer accepts ' +
           'anonymous requests.\n\nIf calls stop appearing, use "Stop enforcing ' +
           '(rollback)" and check the secret on the handset.');
}

function relaxAuthUi() {
  PropertiesService.getScriptProperties().setProperty(PROP_ENFORCE, 'false');
  SpreadsheetApp.getUi().alert('Authentication is no longer enforced.\n\n' +
    'The endpoint accepts anonymous requests again — this is a rollback for when ' +
    'calls stop arriving, not a resting state. Re-enforce once the secret is fixed.');
}


// ─────────────────────────────────────────────────────────────
//  MAINTENANCE — remove rows that have no phone number and that nobody has
//  filled in. The Summary's data-quality panel counts these ("Rows with a
//  source but no phone number"); they come from malformed posts.
//
//  Deliberately conservative: a row is only removed when Phone Number is
//  blank AND Nature of Query is blank AND Notes are blank. Anything a human
//  has touched is left alone, whatever else is wrong with it.
// ─────────────────────────────────────────────────────────────
function removeBlankPhoneRows() {
  const ui = SpreadsheetApp.getUi();
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CALL_LOG);
  const last = sheet.getLastRow();
  if (last < 2) { ui.alert('No rows in the Call Log.'); return; }

  const v = sheet.getRange(2, 1, last - 1, TOTAL_COLS).getValues();
  const doomed = [];
  for (let i = 0; i < v.length; i++) {
    const phone = String(v[i][COL_PHONE - 1] || '').trim();
    const query = String(v[i][COL_QUERY - 1] || '').trim();
    const notes = String(v[i][COL_NOTES - 1] || '').trim();
    if (!phone && !query && !notes) doomed.push(i + 2);
  }
  if (!doomed.length) { ui.alert('✅ No blank-phone rows to remove.'); return; }

  const preview = doomed.slice(0, 12).map(r => {
    const row = v[r - 2];
    const when = row[COL_LOGGED - 1];
    return '  row ' + r + ' — ' +
      (when instanceof Date ? Utilities.formatDate(when, TZ, 'yyyy-MM-dd HH:mm') : '(no date)') +
      '  ' + (String(row[COL_SOURCE - 1] || '(no source)'));
  }).join('\n');

  const go = ui.alert('Remove ' + doomed.length + ' blank-phone row(s)?',
    'These have no phone number, no Nature of Query and no Notes:\n\n' + preview +
    (doomed.length > 12 ? '\n  …and ' + (doomed.length - 12) + ' more' : '') +
    '\n\nThis cannot be undone.', ui.ButtonSet.YES_NO);
  if (go !== ui.Button.YES) return;

  //  Delete from the bottom up so earlier indices stay valid.
  doomed.sort((a, b) => b - a).forEach(r => sheet.deleteRow(r));
  ui.alert('✅ Removed ' + doomed.length + ' row(s).');
}


// ─────────────────────────────────────────────────────────────
//  CLASSIFY — the app writes a Nature of Query (and optionally a Type of
//  Call) back to a row the operator picked on the handset, seconds after the
//  call ended. This is the piece aimed at the 37% of rows that never get one.
//
//  The row handle is verified against the dedupe index before anything is
//  written: a stale handle from an old sync must never land a classification
//  on somebody else's call.
// ─────────────────────────────────────────────────────────────
function classifyCall(data) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);

    const id    = String((data && data.id) || '').trim();
    const row   = parseInt(data && data.row, 10);
    const query = String((data && data.query) || '').trim();
    const type  = String((data && data.type) || '').trim();
    if (!id || !row || row < 2) return { status: 'error', message: 'id and row are required' };

    const ss    = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(CALL_LOG);
    const index = ensureSyncSheet(ss);

    //  The index is the source of truth for which row this call owns.
    const known = loadKnownIds(index);
    if (!known.has(id)) return { status: 'error', message: 'unknown call id' };
    const expected = parseInt(known.get(id), 10);
    if (expected !== row) {
      return { status: 'error', message: 'row mismatch for this call id (expected ' + expected + ')' };
    }
    if (row > sheet.getLastRow()) return { status: 'error', message: 'row is past the end of the log' };

    const written = [];
    if (query) { sheet.getRange(row, COL_QUERY).setValue(query); written.push('query'); }
    if (type)  { sheet.getRange(row, COL_TYPE).setValue(type);   written.push('type'); }
    if (!written.length) return { status: 'error', message: 'nothing to write' };

    return { status: 'ok', row: row, written: written };
  } catch (err) {
    return { status: 'error', message: err.message };
  } finally {
    try { lock.releaseLock(); } catch (e2) {}
  }
}
