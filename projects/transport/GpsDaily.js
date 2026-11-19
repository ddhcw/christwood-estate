/**
 * GpsDaily.js — G-C (PRD R22).
 *
 * gpsDailyPull(date) fetches the Worker's /v1/daily for one service date and
 * upserts GPS_Daily on day_key = service_date|vehicle_id|trip_code. Columns the
 * Worker does not own (events_fired, events_suppressed, median_*) are left
 * exactly as found. Header-name lookup, one read, one write. Running it twice
 * leaves one row per key.
 *
 * rebuildAnalytics() calls gpsNightlyPull_() inside a try/catch, so a GPS
 * failure can never stop the dashboard from rebuilding.
 */

// ---- 1. Pure logic ---------------------------------------------------------

const GPS_DAILY_OWNED = ['service_date', 'vehicle_id', 'pings', 'late_pings', 'first_fix_at', 'last_fix_at', 'summary', 'trip_code', 'session'];

function gpsDayKey_(date, vehicleId, tripCode) {
  return gpsStr_(date) + '|' + gpsStr_(vehicleId) + '|' + gpsStr_(tripCode);
}

/** epoch ms -> "yyyy-MM-dd HH:mm" in Asia/Kolkata, '' if not a number. */
function gpsFormatStamp_(ms) {
  if (ms === null || ms === undefined || ms === '' || !isFinite(ms)) return '';
  return gpsServiceDate_(ms) + ' ' + gpsFormatHm_(ms);
}

/** One Worker /v1/daily row -> {day_key, fields} or null if it has no vehicle. */
function gpsDailyRowFromWorker_(date, r) {
  var vehicle = gpsStr_(r && r.vehicle_id);
  if (!vehicle) return null;
  var trip = gpsStr_(r.trip_code);
  var summary = r.summary === null || r.summary === undefined ? '' : (typeof r.summary === 'string' ? r.summary : JSON.stringify(r.summary));
  return {
    day_key: gpsDayKey_(date, vehicle, trip),
    fields: {
      service_date: date, vehicle_id: vehicle, pings: gpsNumOrNull_(r.pings) === null ? '' : gpsNumOrNull_(r.pings),
      late_pings: gpsNumOrNull_(r.late_pings) === null ? '' : gpsNumOrNull_(r.late_pings),
      first_fix_at: gpsFormatStamp_(r.first_fix_ts), last_fix_at: gpsFormatStamp_(r.last_fix_ts),
      summary: summary.slice(0, 40000), trip_code: trip, session: gpsStr_(r.session)
    }
  };
}

/**
 * Merge worker rows into the tab's values (row 0 = headers). Pure: returns
 * {values, added, updated, missing} where values is the full new 2D array and
 * missing lists headers the tab lacks. Existing rows keep every column we do not own.
 */
function gpsUpsertDaily_(values, workerRows) {
  var headers = (values[0] || []).map(function (h) { return gpsStr_(h); });
  var col = {};
  headers.forEach(function (h, i) { if (h && col[h] === undefined) col[h] = i; });
  var need = ['day_key'].concat(GPS_DAILY_OWNED);
  var missing = need.filter(function (h) { return col[h] === undefined; });
  if (missing.length) return { values: values, added: 0, updated: 0, missing: missing };
  var out = values.map(function (r) { return r.slice(); });
  var index = {};
  for (var i = 1; i < out.length; i++) {
    var k = gpsStr_(out[i][col.day_key]);
    if (k && index[k] === undefined) index[k] = i;
  }
  var added = 0, updated = 0;
  workerRows.forEach(function (w) {
    var at = index[w.day_key];
    var row;
    if (at === undefined) {
      row = new Array(headers.length).fill('');
      row[col.day_key] = w.day_key;
      out.push(row);
      index[w.day_key] = out.length - 1;
      added++;
    } else { row = out[at]; updated++; }
    GPS_DAILY_OWNED.forEach(function (h) { row[col[h]] = w.fields[h]; });
  });
  return { values: out, added: added, updated: updated, missing: [] };
}

// ---- 2. Apps Script glue ---------------------------------------------------

/**
 * Pull one date. Returns {ok, date, rows, added, updated} or {ok:false, error}.
 * Callers have already decided the caller may do this (menu guard, trigger).
 */
function gpsDailyPullCore_(date) {
  var day = gpsStr_(date);
  if (!GPS_DATE_RE.test(day)) return { ok: false, error: 'That date is not valid (use yyyy-MM-dd).' };
  var res = gpsWorkerCall_('read', 'GET', '/v1/daily', { date: day });
  if (!res.ok) return { ok: false, error: res.error };
  var rows = res.json && Array.isArray(res.json.rows) ? res.json.rows : null;
  if (rows === null) return { ok: false, error: 'Worker answered without a rows list' };
  var wrows = rows.map(function (r) { return gpsDailyRowFromWorker_(day, r); }).filter(Boolean);
  if (!wrows.length) return { ok: true, date: day, rows: 0, added: 0, updated: 0 };
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(GPS_SHEETS.DAILY);
  if (!sh || sh.getLastColumn() < 1) return { ok: false, error: 'GPS_Daily tab is missing (run setup)' };
  var lr = Math.max(sh.getLastRow(), 1), lc = sh.getLastColumn();
  var values = sh.getRange(1, 1, lr, lc).getValues();
  var m = gpsUpsertDaily_(values, wrows);
  if (m.missing.length) return { ok: false, error: 'GPS_Daily is missing columns: ' + m.missing.join(', ') };
  var over = m.values.length - sh.getMaxRows();
  if (over > 0) sh.insertRowsAfter(sh.getMaxRows(), over);
  // Keep keys and times as typed text, not auto-parsed dates (formatting only).
  var hdr = values[0].map(function (h) { return gpsStr_(h); });
  ['day_key', 'service_date', 'first_fix_at', 'last_fix_at'].forEach(function (h) {
    var c = hdr.indexOf(h) + 1;
    if (c > 0 && m.values.length > 1) sh.getRange(2, c, m.values.length - 1, 1).setNumberFormat('@');
  });
  sh.getRange(1, 1, m.values.length, lc).setValues(m.values);
  return { ok: true, date: day, rows: wrows.length, added: m.added, updated: m.updated };
}

/** Public entry. Returns nothing (a page calling it learns nothing). */
function gpsDailyPull(date) {
  var d = gpsStr_(date) || gpsServiceDate_(Date.now() - 86400000);
  var r = gpsDailyPullCore_(d);
  if (!r.ok) throw new Error('GPS daily pull failed: ' + r.error);
}

/**
 * Called from rebuildAnalytics. Pulls yesterday and the day before (late
 * backfill), only when GPS is switched on. Never throws. A failure posts one
 * Ops Alert (when gps_alerts_enabled is Yes) and is logged.
 */
function gpsNightlyPull_() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var settings = gpsSettingsMap_(ss);
    if (!gpsYes_(settings.gps_enabled)) return;
    var errors = [];
    [1, 2].forEach(function (back) {
      var d = gpsServiceDate_(Date.now() - back * 86400000);
      var r = gpsDailyPullCore_(d);
      if (!r.ok) errors.push(d + ': ' + r.error);
    });
    if (errors.length) {
      try { Logger.log('gpsNightlyPull_: ' + errors.join(' | ')); } catch (e) {}
      if (gpsYes_(settings.gps_alerts_enabled)) {
        gpsOpsPost_('GPS daily summary pull failed (' + gpsNowText_() + '): ' + errors.join('; '), settings);
      }
    }
  } catch (e) {
    try { Logger.log('gpsNightlyPull_ crashed: ' + String(e && e.message || e).slice(0, 200)); } catch (x) {}
  }
}

/** Menu twin: Fleet > Pull GPS summary for a date. Manage only. */
function menuPullGpsDaily() {
  var ui = SpreadsheetApp.getUi();
  var auth = gpsMenuGuard_(ui);
  if (!auth.ok) return;
  var def = gpsServiceDate_(Date.now() - 86400000);
  var p = ui.prompt('Pull GPS summary', 'Service date (yyyy-MM-dd). Leave blank for yesterday (' + def + ').', ui.ButtonSet.OK_CANCEL);
  if (p.getSelectedButton() !== ui.Button.OK) return;
  var r = gpsDailyPullCore_(gpsStr_(p.getResponseText()) || def);
  ui.alert('Pull GPS summary', r.ok
    ? 'Done for ' + r.date + ': ' + r.rows + ' row(s) from the Worker, ' + r.added + ' added, ' + r.updated + ' updated.'
    : 'Not pulled. ' + r.error, ui.ButtonSet.OK);
}
