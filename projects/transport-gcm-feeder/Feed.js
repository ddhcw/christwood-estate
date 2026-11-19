/**
 * Feed.js — Apps Script glue of the transport GCM feeder (PRD rev 4 R42, R43).
 *
 * A standalone project with no doGet/doPost and no web app (R42). It runs on
 * time triggers under the feeder's own account, which is on GCM's access list.
 * It opens two spreadsheets by ID (Script Properties, never in source):
 *   - the transport workbook: reads Parent_Notify_Log, Student_Trip_Stops,
 *     Transport_Trips, Vehicle_Master, Settings; writes only the gcm_* and status
 *     columns of the log, gcm_reachable, and the feeder_heartbeat setting;
 *   - the GCM control sheet: reads SETTINGS (SEND_WINDOW), ROSTER, OUTBOX and
 *     MESSAGE LOG, and APPENDS rows to OUTBOX. Nothing else, ever. It never edits
 *     an existing OUTBOX row (the sweeper writes a fixed region back).
 *
 * All decisions are in FeedLogic.js (pure, unit-tested). This file reads, calls
 * them, and writes.
 *
 * Script Properties (names only): TRANSPORT_WORKBOOK_ID, GCM_CONTROL_SHEET_ID,
 * GCM_SHADOW_SPACE, OPS_ALERTS_WEBHOOK, FEED_LIVE_ALLOWED. State the feeder keeps
 * itself: FEED_GUARD_TRIPPED, FEED_SHADOW_SEQ, FEED_ALERT_STATE, FEED_ALERTED_RUNS,
 * FEED_LAST_NIGHTLY.
 *
 * Top-level code here must not reference constants from other files.
 */

const FD_PROP = {
  WORKBOOK: 'TRANSPORT_WORKBOOK_ID', CONTROL: 'GCM_CONTROL_SHEET_ID', SHADOW: 'GCM_SHADOW_SPACE',
  OPS: 'OPS_ALERTS_WEBHOOK', LIVE: 'FEED_LIVE_ALLOWED',
  TRIPPED: 'FEED_GUARD_TRIPPED', SEQ: 'FEED_SHADOW_SEQ', ALERTS: 'FEED_ALERT_STATE',
  RUNS: 'FEED_ALERTED_RUNS', NIGHTLY: 'FEED_LAST_NIGHTLY'
};
const FD_LOCK_WAIT_MS = 25000;
const FD_HTTP_ATTEMPTS = 3;
const FD_HTTP_BACKOFF_MS = 1000;
const FD_LOG_TAIL_ROWS = 6000;          // same tail the library scans (LOG_SCAN_ROWS)
const FD_ALERTED_RUNS_KEEP = 300;
const FD_HEARTBEAT_KEY = 'feeder_heartbeat';

// ---- Properties and alerts --------------------------------------------------

function fdProps_() { return PropertiesService.getScriptProperties(); }
function fdProp_(name) { return fdStr_(fdProps_().getProperty(name)); }

function fdJsonProp_(name, fallback) {
  try {
    var raw = fdProps_().getProperty(name);
    var v = raw ? JSON.parse(raw) : fallback;
    return v && typeof v === 'object' ? v : fallback;
  } catch (e) { return fallback; }
}

/** Run attemptFn until it returns ok, or attempts run out. 429/5xx/0 retry; other codes do not. */
function fdWithRetry_(attemptFn, attempts, backoffMs) {
  var last = { ok: false, status: 0 };
  for (var i = 0; i < attempts; i++) {
    try { last = attemptFn(); } catch (e) { last = { ok: false, status: 0 }; }
    if (last.ok) return last;
    if (!(last.status === 0 || last.status === 429 || last.status >= 500)) return last;
    if (i < attempts - 1) Utilities.sleep(backoffMs * Math.pow(2, i));
  }
  return last;
}

/**
 * Post one line to Ops Alerts through the webhook, falling back to email so a
 * failed alert is never silent. Returns true if either delivered. The webhook
 * URL and the text are never logged.
 */
function fdOpsPost_(text) {
  var hook = fdProp_(FD_PROP.OPS);
  if (/^https:\/\/[^\s]+$/.test(hook)) {
    var res = fdWithRetry_(function () {
      var r = UrlFetchApp.fetch(hook, { method: 'post', contentType: 'application/json',
        payload: JSON.stringify({ text: 'Transport GCM feeder: ' + text }), muteHttpExceptions: true });
      var code = r.getResponseCode();
      return { ok: code >= 200 && code < 300, status: code };
    }, FD_HTTP_ATTEMPTS, FD_HTTP_BACKOFF_MS);
    if (res.ok) return true;
    try { Logger.log('Ops Alerts post failed (HTTP ' + res.status + '); falling back to email'); } catch (e) { /* ignore */ }
  } else {
    try { Logger.log('Ops Alerts webhook is not configured; falling back to email'); } catch (e) { /* ignore */ }
  }
  try {
    var to = Session.getEffectiveUser().getEmail();
    if (!to) return false;
    MailApp.sendEmail({ to: to, subject: 'Transport GCM feeder alert', body: text });
    return true;
  } catch (e) {
    try { Logger.log('Feeder alert email failed'); } catch (x) { /* ignore */ }
    return false;
  }
}

/** One alert per distinct problem: the same text for the same key is not posted again until it is cleared. */
function fdAlertOnce_(key, text) {
  var state = fdJsonProp_(FD_PROP.ALERTS, {});
  var stamp = fdHash_(text);
  if (state[key] === stamp) return false;
  if (!fdOpsPost_(text)) return false;     // not delivered: try again next run
  state[key] = stamp;
  fdProps_().setProperty(FD_PROP.ALERTS, JSON.stringify(state));
  return true;
}

function fdClearAlert_(key) {
  var state = fdJsonProp_(FD_PROP.ALERTS, {});
  if (state[key] === undefined) return;
  delete state[key];
  fdProps_().setProperty(FD_PROP.ALERTS, JSON.stringify(state));
}

// ---- Sheet helpers ----------------------------------------------------------

function fdValues_(sh, display) {
  var lr = sh.getLastRow(), lc = sh.getLastColumn();
  if (lr < 1 || lc < 1) return [];
  var r = sh.getRange(1, 1, lr, lc);
  return display ? r.getDisplayValues() : r.getValues();
}

/** Key/value tab -> {key: value}. Header names are matched without regard to case. */
function fdKeyValues_(values, keyHeader, valueHeader) {
  var map = {};
  if (!values || values.length < 2) return map;
  var idx = {};
  values[0].forEach(function (h, i) { var k = fdStr_(h).toLowerCase(); if (k && idx[k] === undefined) idx[k] = i; });
  var kc = idx[keyHeader.toLowerCase()], vc = idx[valueHeader.toLowerCase()];
  if (kc === undefined || vc === undefined) return map;
  for (var i = 1; i < values.length; i++) { var k = fdStr_(values[i][kc]); if (k) map[k] = values[i][vc]; }
  return map;
}

function fdTableRows_(ss, name) {
  var sh = ss.getSheetByName(name);
  return sh ? fdRows_(fdValues_(sh, false)) : [];
}

function fdRowsLower_(values) {
  if (!values || values.length < 2) return [];
  var lowered = [values[0].map(function (h) { return fdStr_(h).toLowerCase(); })].concat(values.slice(1));
  return fdRows_(lowered);
}

/** Write the planned log updates, one block per touched column, then flush. Returns blocks written. */
function fdWriteLogUpdates_(sh, values, updates) {
  if (!updates.length) return 0;
  var blocks = fdColumnWrites_(values, updates);
  blocks.forEach(function (b) { sh.getRange(b.row, b.col, b.values.length, 1).setValues(b.values); });
  SpreadsheetApp.flush();
  return blocks.length;
}

function fdOpenById_(id) {
  if (!id) return { ok: false, message: 'Script Property is not set' };
  try { return { ok: true, ss: SpreadsheetApp.openById(id) }; }
  catch (e) { return { ok: false, message: 'cannot open the spreadsheet (check the ID and that this account can edit it)' }; }
}

/** Append rows after the last row in one setValues. Never touches an existing row. */
function fdAppendOutbox_(sh, rows) {
  var start = sh.getLastRow() + 1;
  var over = start + rows.length - 1 - sh.getMaxRows();
  if (over > 0) sh.insertRowsAfter(sh.getMaxRows(), over);
  sh.getRange(start, 1, rows.length, FD_OUTBOX_HEADERS.length).setValues(rows);
  SpreadsheetApp.flush();
}

function fdWriteHeartbeat_(settingsSh, settingsValues, nowMs) {
  if (!settingsSh || !settingsValues.length) return;
  var idx = {};
  settingsValues[0].forEach(function (h, i) { var k = fdStr_(h).toLowerCase(); if (k && idx[k] === undefined) idx[k] = i; });
  var kc = idx['setting'], vc = idx['value'], nc = idx['notes'];
  if (kc === undefined || vc === undefined) return;
  var iso = fdIso_(nowMs), found = 0;
  for (var i = 1; i < settingsValues.length; i++) if (fdStr_(settingsValues[i][kc]) === FD_HEARTBEAT_KEY) { found = i + 1; break; }
  if (found) { settingsSh.getRange(found, vc + 1).setValue(iso); return; }
  var width = Math.max(kc, vc, nc === undefined ? 0 : nc) + 1, row = [];
  for (var c = 0; c < width; c++) row.push('');
  row[kc] = FD_HEARTBEAT_KEY; row[vc] = iso;
  if (nc !== undefined) row[nc] = 'Written by the GCM feeder on every run. The watchdog alerts if it is older than 5 minutes';
  settingsSh.getRange(settingsSh.getLastRow() + 1, 1, 1, width).setValues([row]);
}

function fdReasonCounts_(decisions) {
  var c = {};
  decisions.forEach(function (d) { c[d.reason] = (c[d.reason] || 0) + 1; });
  return Object.keys(c).sort().map(function (k) { return k + '=' + c[k]; }).join(' ');
}

function fdTripText_(reason) {
  return 'Feed guard TRIPPED (' + (reason || 'a cap was broken') + '). Nothing was queued and nothing will be until a person ' +
    'checks Parent_Notify_Log and resets the feed guard from the feeder.';
}

function fdSendFailureAlerts_(terminal) {
  var alerted = fdJsonProp_(FD_PROP.RUNS, []);
  var map = {};
  alerted.forEach(function (r) { map[r] = true; });
  var plan = fdPlanFailureAlerts_(terminal, map), n = 0;
  plan.forEach(function (a) {
    if (fdOpsPost_(a.text)) { alerted.push(a.run); n++; }
  });
  if (n) fdProps_().setProperty(FD_PROP.RUNS, JSON.stringify(alerted.slice(-FD_ALERTED_RUNS_KEEP)));
  return n;
}

// ---- The feed run -----------------------------------------------------------

/**
 * One feed run. Returns a summary object (no student data). `nowMs` is a
 * parameter so tests can pin the clock. Every expected problem is returned as
 * {status:'refused'|'busy', message}; an unexpected exception propagates to
 * feederRun, which alerts once.
 */
function fdRunCore_(nowMs) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(FD_LOCK_WAIT_MS)) return { status: 'busy', message: 'another feeder run holds the lock' };
  try { return fdRunLocked_(nowMs); } finally { try { lock.releaseLock(); } catch (e) { /* nothing to do */ } }
}

function fdRunLocked_(nowMs) {
  var props = fdProps_();
  var wbId = fdProp_(FD_PROP.WORKBOOK);
  var wb = fdOpenById_(wbId);
  if (!wb.ok) { fdAlertOnce_('workbook', 'Feeder cannot open the transport workbook: ' + wb.message + '. Nothing was fed.'); return { status: 'refused', message: 'transport workbook: ' + wb.message }; }
  fdClearAlert_('workbook');
  var ss = wb.ss;

  var logSh = ss.getSheetByName(FD_WB_TABS.LOG);
  if (!logSh) { fdAlertOnce_('log', 'Feeder: Parent_Notify_Log tab is missing. Nothing was fed.'); return { status: 'refused', message: 'Parent_Notify_Log missing' }; }
  var logValues = fdValues_(logSh, false);
  var idx = fdHeaderIndex_(logValues[0] || []);
  var missing = FD_LOG_COLUMNS.filter(function (h) { return idx[h] === undefined; });
  if (missing.length) {
    fdAlertOnce_('log', 'Feeder: Parent_Notify_Log is missing column(s): ' + missing.join(', ') + '. Nothing was fed.');
    return { status: 'refused', message: 'Parent_Notify_Log columns missing: ' + missing.join(', ') };
  }
  fdClearAlert_('log');
  var logRows = fdRows_(logValues);

  var settingsSh = ss.getSheetByName(FD_WB_TABS.SETTINGS);
  var settingsValues = settingsSh ? fdValues_(settingsSh, false) : [];
  var settings = fdKeyValues_(settingsValues, 'setting', 'value');
  var s = fdReadSettings_(settings);

  var trippedRaw = props.getProperty(FD_PROP.TRIPPED);
  var tripped = !!trippedRaw;
  if (tripped) fdAlertOnce_('tripped', fdTripText_(fdJsonProp_(FD_PROP.TRIPPED, {}).reason));

  var pendingRows = logRows.filter(function (r) { return fdStr_(r.status) === 'pending_feed'; });
  var queuedRows = logRows.filter(function (r) { return fdStr_(r.status) === 'queued_gcm'; });
  var wantFeed = (s.mode === 'shadow_gcm' || s.mode === 'live') && !tripped && s.projectId === FD_PROJECT_ID;

  // The GCM side: opened only when there is something to feed or to reconcile.
  var ctl = null, outboxSh = null, outboxOk = false, windowText = '', feedBlock = '', configProblem = '';
  if ((wantFeed && pendingRows.length) || queuedRows.length) {
    var opened = fdOpenById_(fdProp_(FD_PROP.CONTROL));
    if (!opened.ok) { configProblem = 'Feeder cannot open the GCM control sheet (' + FD_PROP.CONTROL + '): ' + opened.message; feedBlock = 'control_unavailable'; }
    else {
      ctl = opened.ss;
      outboxSh = ctl.getSheetByName(FD_GCM_TABS.OUTBOX);
      if (!outboxSh) { configProblem = 'The GCM control sheet has no OUTBOX tab'; feedBlock = 'outbox_missing'; }
      else {
        var hdr = fdCheckOutboxHeaders_(outboxSh.getLastColumn() ? outboxSh.getRange(1, 1, 1, outboxSh.getLastColumn()).getValues()[0] : []);
        if (!hdr.ok) { configProblem = 'GCM OUTBOX headers changed: ' + hdr.message; feedBlock = 'outbox_headers_changed'; }
        else outboxOk = true;
      }
      if (!feedBlock && wantFeed) {
        var cs = ctl.getSheetByName(FD_GCM_TABS.SETTINGS);
        windowText = cs ? fdStr_(fdKeyValues_(fdValues_(cs, true), 'Key', 'Value').SEND_WINDOW) : '';
        if (!fdParseWindow_(windowText)) { configProblem = 'GCM SETTINGS has no usable SEND_WINDOW (HH:mm-HH:mm)'; feedBlock = 'send_window_unusable'; }
      }
    }
  }
  if (!configProblem && (s.mode === 'shadow_gcm' || s.mode === 'live') && s.projectId !== FD_PROJECT_ID) {
    configProblem = 'Settings gcm_project_id is "' + s.projectId + '" but the feeder only feeds ' + FD_PROJECT_ID;
  }
  if (configProblem) fdAlertOnce_('config', 'Feeder: ' + configProblem + '. Nothing was queued.'); else fdClearAlert_('config');

  var feedReads = wantFeed && pendingRows.length > 0;
  var plan = fdPlanFeed_({
    logRows: logRows,
    studentRows: feedReads ? fdTableRows_(ss, FD_WB_TABS.STUDENTS) : [],
    tripRows: feedReads ? fdTableRows_(ss, FD_WB_TABS.TRIPS) : [],
    vehicleRows: feedReads ? fdTableRows_(ss, FD_WB_TABS.VEHICLES) : [],
    settings: settings, nowMs: nowMs, shadowSpace: fdProp_(FD_PROP.SHADOW), liveAllowed: fdProp_(FD_PROP.LIVE),
    windowText: windowText, tripped: tripped, feedBlock: feedBlock,
    seq: Number(props.getProperty(FD_PROP.SEQ)) || 0
  });

  // Reconcile rows queued in earlier runs (read OUTBOX before this run appends to it).
  var rec = { updates: [], terminal: [] };
  if (queuedRows.length && outboxOk) {
    rec = fdReconcileOutbox_(queuedRows, fdIndexOutbox_(fdRows_(fdValues_(outboxSh, false))), nowMs);
  }

  var tripReason = plan.trippedReason;
  // Phase A: log first (queued_gcm + gcm_queued_at), so a crash after this point can never queue a row twice.
  fdWriteLogUpdates_(logSh, logValues, plan.updates.concat(rec.updates));

  // Phase B: one append to OUTBOX for the whole run.
  var appendFailed = false;
  if (plan.outbox.length) {
    try {
      props.setProperty(FD_PROP.SEQ, String(plan.seqNext));
      fdAppendOutbox_(outboxSh, plan.outbox);
      fdClearAlert_('append');
    } catch (e) {
      appendFailed = true;
      var back = plan.updates.filter(function (u) { return u.set.status === 'queued_gcm'; }).map(function (u) {
        return { rowNum: u.rowNum, set: { status: 'pending_feed', gcm_queued_at: '', gcm_status: '', gcm_result: '' } };
      });
      try { fdWriteLogUpdates_(logSh, fdApplyForRevert_(logValues, plan.updates.concat(rec.updates)), back); } catch (x) { /* the row stays queued_gcm; reconcile reports it MISSING */ }
      fdAlertOnce_('append', 'Feeder could not append to GCM OUTBOX (' + String(e && e.message ? e.message : 'error').slice(0, 100) + '). Rows were put back to pending_feed.');
    }
  }

  if (tripReason) {
    props.setProperty(FD_PROP.TRIPPED, JSON.stringify({ at: fdIso_(nowMs), reason: tripReason }));
    fdAlertOnce_('tripped', fdTripText_(tripReason));
  }

  var alerts = fdSendFailureAlerts_(rec.terminal);
  fdWriteHeartbeat_(settingsSh, settingsValues, nowMs);

  var summary = { status: 'ok', mode: s.mode, feeding: plan.feeding && !appendFailed, notFeeding: plan.notFeeding || feedBlock,
    queued: appendFailed ? 0 : plan.counts.queued, expired: plan.counts.expired, suppressed: plan.counts.suppressed,
    waiting: plan.counts.waiting, reconciled: rec.updates.length, failureAlerts: alerts, tripped: !!tripReason || tripped };
  try { Logger.log('feeder run: ' + JSON.stringify(summary) + (plan.decisions.length ? ' reasons: ' + fdReasonCounts_(plan.decisions) : '')); } catch (e) { /* ignore */ }
  return summary;
}

/** The values as they would read after `applied` updates, so a revert writes on top of them. */
function fdApplyForRevert_(values, applied) {
  var copy = values.map(function (r) { return r.slice(); });
  var idx = fdHeaderIndex_(values[0]);
  applied.forEach(function (u) { Object.keys(u.set).forEach(function (h) { copy[u.rowNum - 1][idx[h]] = u.set[h]; }); });
  return copy;
}

// ---- Nightly: ROSTER pre-check and MESSAGE LOG reconcile --------------------

function fdNightlyCore_(nowMs) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(FD_LOCK_WAIT_MS)) return { status: 'busy', message: 'another feeder run holds the lock' };
  try { return fdNightlyLocked_(nowMs); } finally { try { lock.releaseLock(); } catch (e) { /* nothing to do */ } }
}

function fdNightlyLocked_(nowMs) {
  var wb = fdOpenById_(fdProp_(FD_PROP.WORKBOOK));
  var ctl = fdOpenById_(fdProp_(FD_PROP.CONTROL));
  if (!wb.ok || !ctl.ok) {
    var why = (!wb.ok ? 'transport workbook (' + wb.message + ')' : 'GCM control sheet (' + ctl.message + ')');
    fdAlertOnce_('nightly', 'Feeder nightly job cannot open the ' + why + '. ROSTER check and MESSAGE LOG reconcile did not run.');
    return { status: 'refused', message: why };
  }
  fdClearAlert_('nightly');
  var out = { status: 'ok', reachableYes: 0, reachableNo: 0, reachableChanged: 0, logUpdates: 0, failureAlerts: 0 };

  // 1. ROSTER pre-check, read-only on the GCM side.
  var stSh = wb.ss.getSheetByName(FD_WB_TABS.STUDENTS), rosterSh = ctl.ss.getSheetByName(FD_GCM_TABS.ROSTER);
  if (stSh && rosterSh) {
    var stValues = fdValues_(stSh, false);
    if (fdHeaderIndex_(stValues[0] || []).gcm_reachable !== undefined) {
      var plan = fdPlanReachability_(fdRows_(stValues), fdRowsLower_(fdValues_(rosterSh, false)));
      out.reachableYes = plan.yes; out.reachableNo = plan.no; out.reachableChanged = plan.updates.length;
      fdWriteLogUpdates_(stSh, stValues, plan.updates);
    }
  }

  // 2. MESSAGE LOG: true send time and status for rows the per-run copy only saw in OUTBOX.
  var logSh = wb.ss.getSheetByName(FD_WB_TABS.LOG), gcmLog = ctl.ss.getSheetByName(FD_GCM_TABS.LOG);
  if (logSh && gcmLog) {
    var logValues = fdValues_(logSh, false);
    var rows = fdRows_(logValues).filter(function (r) {
      return fdStr_(r.status) === 'sent' && fdParseResult_(r.gcm_result).hash && /seen in OUTBOX/.test(fdStr_(r.gcm_result));
    });
    if (rows.length) {
      var lr = gcmLog.getLastRow(), lc = gcmLog.getLastColumn();
      if (lr >= 2 && lc >= 1) {
        var head = gcmLog.getRange(1, 1, 1, lc).getValues()[0];
        var first = Math.max(2, lr - FD_LOG_TAIL_ROWS + 1);
        var tail = gcmLog.getRange(first, 1, lr - first + 1, lc).getValues();
        var rec = fdReconcileMessageLog_(rows, fdRows_([head].concat(tail)));
        out.logUpdates = rec.updates.length;
        fdWriteLogUpdates_(logSh, logValues, rec.updates);
        out.failureAlerts = fdSendFailureAlerts_(rec.terminal);
      }
    }
  }
  fdProps_().setProperty(FD_PROP.NIGHTLY, fdDate_(nowMs));
  try { Logger.log('feeder nightly: ' + JSON.stringify(out)); } catch (e) { /* ignore */ }
  return out;
}

// ---- Trigger and menu entry points -----------------------------------------
// A standalone project has no spreadsheet menu. onOpen adds one only if this
// project is ever bound to a sheet; otherwise run the menu* functions from the
// Apps Script editor (Run). They are the same "menu items" the PRD names.

/** Every-minute trigger. Never throws: an unexpected error is alerted once and the next minute tries again. */
function feederRun() {
  try {
    var r = fdRunCore_(Date.now());
    fdClearAlert_('run_error');
    return r;
  } catch (e) {
    var msg = String(e && e.message ? e.message : 'error').replace(/\s+/g, ' ').slice(0, 120);
    try { Logger.log('feeder run failed: ' + msg); } catch (x) { /* ignore */ }
    fdAlertOnce_('run_error', 'Feeder run failed: ' + msg + '. Rows stay pending_feed; the watchdog alerts if the heartbeat stops.');
    return { status: 'error', message: msg };
  }
}

/** Daily trigger, after the send window closes. */
function feederNightly() {
  try { return fdNightlyCore_(Date.now()); }
  catch (e) {
    var msg = String(e && e.message ? e.message : 'error').replace(/\s+/g, ' ').slice(0, 120);
    try { Logger.log('feeder nightly failed: ' + msg); } catch (x) { /* ignore */ }
    fdAlertOnce_('nightly_error', 'Feeder nightly job failed: ' + msg);
    return { status: 'error', message: msg };
  }
}

function fdNotify_(title, text) {
  try { Logger.log(title + ': ' + text); } catch (e) { /* ignore */ }
  try { var ui = SpreadsheetApp.getUi(); ui.alert(title, text, ui.ButtonSet.OK); } catch (e) { /* standalone: no UI */ }
  return text;
}

function menuInstallTriggers() {
  var mine = { feederRun: true, feederNightly: true };
  ScriptApp.getProjectTriggers().forEach(function (t) { if (mine[t.getHandlerFunction()]) ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('feederRun').timeBased().everyMinutes(1).create();
  ScriptApp.newTrigger('feederNightly').timeBased().atHour(21).everyDays(1).create();
  return fdNotify_('Feeder triggers', 'Installed: feederRun every minute, feederNightly daily at about 21:00 (Asia/Kolkata).');
}

function menuFeedNow() {
  var r = fdRunCore_(Date.now());
  return fdNotify_('Feed now', JSON.stringify(r));
}

function menuRosterCheckNow() {
  var r = fdNightlyCore_(Date.now());
  return fdNotify_('ROSTER check and MESSAGE LOG reconcile', JSON.stringify(r));
}

/**
 * Reset feed guard. Clears the tripped flag only. Rows that waited while it was
 * tripped stay as they are: those past expires_at are marked expired on the
 * next run and never sent late. Check Parent_Notify_Log before resetting.
 */
function menuResetFeedGuard() {
  var was = fdProps_().getProperty(FD_PROP.TRIPPED);
  fdProps_().deleteProperty(FD_PROP.TRIPPED);
  fdClearAlert_('tripped');
  var who = '';
  try { who = Session.getActiveUser().getEmail(); } catch (e) { who = ''; }
  if (was) fdOpsPost_('Feed guard was reset' + (who ? ' by ' + who : '') + '. The feeder resumes on its next run.');
  return fdNotify_('Reset feed guard', was ? 'The feed guard is reset.' : 'The feed guard was not tripped.');
}

function menuFeederStatus() {
  var t = fdJsonProp_(FD_PROP.TRIPPED, null);
  var trig = ScriptApp.getProjectTriggers().map(function (x) { return x.getHandlerFunction(); }).sort().join(', ') || 'none';
  return fdNotify_('Feeder status', 'Feed guard: ' + (t ? 'TRIPPED at ' + t.at + ' (' + t.reason + ')' : 'ok') +
    '. Triggers: ' + trig + '. Last nightly: ' + (fdProp_(FD_PROP.NIGHTLY) || 'never') + '.');
}

/** Only does anything if the project is bound to a sheet. */
function onOpen() {
  try {
    SpreadsheetApp.getUi().createMenu('GCM feeder')
      .addItem('Install triggers', 'menuInstallTriggers').addItem('Feed now', 'menuFeedNow')
      .addItem('ROSTER check and log reconcile now', 'menuRosterCheckNow')
      .addItem('Reset feed guard', 'menuResetFeedGuard').addItem('Status', 'menuFeederStatus').addToUi();
  } catch (e) { /* standalone project: no UI */ }
}
