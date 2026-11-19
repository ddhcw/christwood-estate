/**
 * GpsEvents.js — stop-event intake for live bus GPS (PRD rev 4 R34, R35, R37, R39).
 *
 * The Worker POSTs signed batches of stop events here. The web app is deployed
 * ANYONE_ANONYMOUS, so doPost is a PUBLIC endpoint: nothing is trusted until the
 * HMAC-SHA256 signature checks out. Contract: the Worker repo's
 * docs/DELIVERY-CONTRACT.md (ts and sig travel as query parameters because
 * doPost cannot read headers; the signed string is `${ts}.${body}`).
 *
 * Layout of this file:
 *   1. Constants
 *   2. Pure logic (no Apps Script services) — unit-tested in test/
 *   3. Apps Script glue (doPost and the lock/sheet write)
 *
 * Rules kept here: header-name column lookup, one setValues per batch under
 * LockService, idempotent on dedupe_key, Asia/Kolkata, no secret in source (the
 * key is Script Property GPS_EVENT_HMAC_KEY), no admission number ever leaves
 * this script (events carry none; rows here are the only place they meet), and
 * the response says {ok:false} with no detail on any failure. The body and the
 * signature are never logged.
 *
 * Top-level code here must not reference constants from other files: GAS loads
 * files in project order. Use them only inside functions.
 */

// ---- 1. Constants ----------------------------------------------------------

const GPS_EV_PROP_KEY = 'GPS_EVENT_HMAC_KEY';
const GPS_EV_REPLAY_WINDOW_MS = 5 * 60 * 1000;
const GPS_EV_MAX_BODY_CHARS = 100000;   // 50 events are about 25 KB
const GPS_EV_MAX_EVENTS = 50;
const GPS_EV_LOCK_WAIT_MS = 20000;
const GPS_EV_SEEN_TTL_S = 600;
const GPS_EV_MAX_EXPIRY_MS = 60 * 60 * 1000;  // longest TTL the Worker uses is 20 min
const GPS_EV_DEFAULT_WINDOW = '07:00-19:00';

const GPS_EV_STOP_LEVEL = ['bus_approaching', 'bus_at_previous_stop'];
const GPS_EV_SCHOOL_EVENTS = ['bus_reached_school', 'bus_left_school'];
const GPS_EV_TYPES = GPS_EV_STOP_LEVEL.concat(GPS_EV_SCHOOL_EVENTS);
const GPS_EV_SESSIONS = ['MORNING_PICKUP', 'AFTERNOON_DROP', 'EVENING_DROP'];
const GPS_EV_MODES = ['off', 'shadow_local', 'shadow_gcm', 'live'];

// The field allow-list: any other key, at any level, rejects the batch.
const GPS_EV_BATCH_KEYS = ['v', 'sent_at', 'events'];
const GPS_EV_EVENT_KEYS = ['event_key', 'trip_run_id', 'service_date', 'trip_code', 'session',
  'route_no', 'vehicle_id', 'stop_id', 'stop_name', 'sequence', 'event_type', 'event_ts',
  'eta_minutes', 'expires_at'];

const GPS_EV_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const GPS_EV_RUN_RE = /^\d{4}-\d{2}-\d{2}\|[A-Za-z0-9][A-Za-z0-9._|-]{0,95}$/;
const GPS_EV_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const GPS_EV_TS_RE = /^\d{10,16}$/;
const GPS_EV_SIG_RE = /^[0-9a-f]{64}$/;

// ---- 2. Pure logic ---------------------------------------------------------

/** Constant-time string compare (runs over the longer length, no early exit). */
function gpsEvSafeEqual_(a, b) {
  a = String(a == null ? '' : a); b = String(b == null ? '' : b);
  var diff = a.length ^ b.length;
  var n = Math.max(a.length, b.length);
  for (var i = 0; i < n; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

/**
 * Check ts, sig and body against the shared key. hmacHexFn(message, key) must
 * return the lower-case hex HMAC-SHA256. Returns {ok:true} or {ok:false, reason};
 * the reason is for tests and a short log line only and never goes to the caller.
 */
function gpsEvVerify_(key, ts, sig, body, nowMs, hmacHexFn) {
  if (!key) return { ok: false, reason: 'no_key' };
  if (typeof body !== 'string' || !body) return { ok: false, reason: 'no_body' };
  if (body.length > GPS_EV_MAX_BODY_CHARS) return { ok: false, reason: 'too_big' };
  ts = ts == null ? '' : String(ts);
  if (!GPS_EV_TS_RE.test(ts)) return { ok: false, reason: 'bad_ts' };
  if (Math.abs(Number(nowMs) - Number(ts)) > GPS_EV_REPLAY_WINDOW_MS) return { ok: false, reason: 'stale_ts' };
  var got = String(sig == null ? '' : sig).toLowerCase();
  if (!GPS_EV_SIG_RE.test(got)) return { ok: false, reason: 'bad_sig' };
  var want = hmacHexFn(ts + '.' + body, key);
  return gpsEvSafeEqual_(want, got) ? { ok: true } : { ok: false, reason: 'bad_sig' };
}

function gpsEvIsStr_(v, max) { return typeof v === 'string' && v.length > 0 && v.length <= max; }
function gpsEvIsNum_(v) { return typeof v === 'number' && isFinite(v); }

/** Reasons only; no value from the body is ever echoed. Returns '' if the event is valid. */
function gpsEvCheckEvent_(ev) {
  if (!ev || typeof ev !== 'object' || Array.isArray(ev)) return 'event_not_object';
  var keys = Object.keys(ev);
  for (var i = 0; i < keys.length; i++) {
    if (/admission/i.test(keys[i])) return 'admission_key';
    if (GPS_EV_EVENT_KEYS.indexOf(keys[i]) < 0) return 'unknown_field';
  }
  var idFields = ['trip_code', 'vehicle_id', 'stop_id'];
  for (var j = 0; j < idFields.length; j++) {
    if (typeof ev[idFields[j]] !== 'string' || !GPS_EV_ID_RE.test(ev[idFields[j]])) return 'bad_' + idFields[j];
  }
  if (typeof ev.trip_run_id !== 'string' || !GPS_EV_RUN_RE.test(ev.trip_run_id)) return 'bad_trip_run_id';
  if (typeof ev.service_date !== 'string' || !GPS_EV_DATE_RE.test(ev.service_date)) return 'bad_service_date';
  if (ev.trip_run_id.slice(0, 10) !== ev.service_date) return 'date_mismatch';
  if (GPS_EV_SESSIONS.indexOf(ev.session) < 0) return 'bad_session';
  if (GPS_EV_TYPES.indexOf(ev.event_type) < 0) return 'bad_event_type';
  if (ev.event_key !== ev.trip_run_id + '|' + ev.stop_id + '|' + ev.event_type) return 'bad_event_key';
  if (ev.route_no != null && !(typeof ev.route_no === 'number' && isFinite(ev.route_no)) &&
      !gpsEvIsStr_(ev.route_no, 64)) return 'bad_route_no';
  if (ev.stop_name != null && !gpsEvIsStr_(ev.stop_name, 200)) return 'bad_stop_name';
  if (!gpsEvIsNum_(ev.sequence) || ev.sequence < 0 || ev.sequence > 10000) return 'bad_sequence';
  if (!gpsEvIsNum_(ev.event_ts) || ev.event_ts < 1e11) return 'bad_event_ts';
  if (ev.eta_minutes != null && (!gpsEvIsNum_(ev.eta_minutes) || ev.eta_minutes < 0 || ev.eta_minutes > 600)) return 'bad_eta';
  if (!gpsEvIsNum_(ev.expires_at) || ev.expires_at <= ev.event_ts ||
      ev.expires_at > ev.event_ts + GPS_EV_MAX_EXPIRY_MS) return 'bad_expires_at';
  return '';
}

/**
 * Parse and schema-check a batch body. Returns {ok:true, events} or
 * {ok:false, reason}. Strict: one bad event rejects the whole batch (the
 * Worker retries a rejected batch until it expires).
 */
function gpsEvParseBatch_(body) {
  var b;
  try { b = JSON.parse(body); } catch (e) { return { ok: false, reason: 'bad_json' }; }
  if (!b || typeof b !== 'object' || Array.isArray(b)) return { ok: false, reason: 'not_object' };
  var keys = Object.keys(b);
  for (var i = 0; i < keys.length; i++) {
    if (/admission/i.test(keys[i])) return { ok: false, reason: 'admission_key' };
    if (GPS_EV_BATCH_KEYS.indexOf(keys[i]) < 0) return { ok: false, reason: 'unknown_field' };
  }
  if (b.v !== 1) return { ok: false, reason: 'bad_version' };
  if (!gpsEvIsNum_(b.sent_at)) return { ok: false, reason: 'bad_sent_at' };
  if (!Array.isArray(b.events) || b.events.length < 1 || b.events.length > GPS_EV_MAX_EVENTS) {
    return { ok: false, reason: 'bad_events' };
  }
  for (var k = 0; k < b.events.length; k++) {
    var why = gpsEvCheckEvent_(b.events[k]);
    if (why) return { ok: false, reason: why };
  }
  return { ok: true, events: b.events };
}

/** "07:00-19:00" -> {start, end} in minutes; anything else gives the default window. */
function gpsEvParseWindow_(text) {
  var m = /^\s*(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})\s*$/.exec(String(text == null ? '' : text));
  var d = { start: 7 * 60, end: 19 * 60 };
  if (!m) return d;
  var s = +m[1] * 60 + +m[2], e = +m[3] * 60 + +m[4];
  if (+m[1] > 23 || +m[3] > 24 || +m[2] > 59 || +m[4] > 59 || s >= e) return d;
  return { start: s, end: e };
}

/** Is epoch `nowMs` inside the window (start inclusive, end exclusive), in Asia/Kolkata? */
function gpsEvInWindow_(nowMs, win) {
  var d = new Date(Number(nowMs) + 330 * 60000);
  var min = d.getUTCHours() * 60 + d.getUTCMinutes();
  return min >= win.start && min < win.end;
}

/** "yyyy-MM-dd HH:mm:ss" in Asia/Kolkata (fixed +05:30, no DST). */
function gpsEvStamp_(ms) {
  var d = new Date(Number(ms) + 330 * 60000);
  function p(n) { return ('0' + n).slice(-2); }
  return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate()) + ' ' +
    p(d.getUTCHours()) + ':' + p(d.getUTCMinutes()) + ':' + p(d.getUTCSeconds());
}

function gpsEvList_(text) {
  return String(text == null ? '' : text).split(',').map(function (s) { return s.trim(); })
    .filter(function (s) { return s; });
}

function gpsEvYes_(v) { return String(v == null ? '' : v).trim().toLowerCase() === 'yes'; }

/** Settings map -> the values this file needs, normalised. Unknown mode means shadow_local (nothing is sent). */
function gpsEvReadSettings_(map) {
  map = map || {};
  var mode = String(map.parent_notify_mode == null ? '' : map.parent_notify_mode).trim().toLowerCase();
  if (GPS_EV_MODES.indexOf(mode) < 0) mode = 'shadow_local';
  return {
    mode: mode,
    types: gpsEvList_(map.parent_notify_types),
    trips: gpsEvList_(map.parent_notify_trips),
    gateL: gpsEvYes_(map.gate_l_passed),
    window: gpsEvParseWindow_(map.gcm_send_window || GPS_EV_DEFAULT_WINDOW)
  };
}

/**
 * Status for one would-be row, before the window and expiry checks.
 * Returns {status, reason}. Never reaches GCM unless it is 'pending_feed'.
 */
function gpsEvDecide_(ev, s) {
  if (s.mode === 'shadow_local') return { status: 'local_only', reason: '' };
  if (s.types.indexOf(ev.event_type) < 0) return { status: 'local_only', reason: 'type_not_enabled' };
  if (GPS_EV_STOP_LEVEL.indexOf(ev.event_type) >= 0 && !s.gateL) return { status: 'local_only', reason: 'gate_l_not_passed' };
  if (s.mode === 'live' && s.trips.indexOf(ev.trip_code) < 0) return { status: 'local_only', reason: 'trip_not_enabled' };
  return { status: 'pending_feed', reason: '' };
}

/** Does this event type apply to this session? (Per PRD 5.3.) */
function gpsEvSessionFits_(ev) {
  if (ev.event_type === 'bus_reached_school') return ev.session === 'MORNING_PICKUP';
  if (ev.event_type === 'bus_left_school') return ev.session !== 'MORNING_PICKUP';
  return true;
}

/**
 * Expand events into new Parent_Notify_Log rows (R35).
 *   events        validated events
 *   students      Student_Trip_Stops row objects (by header name)
 *   existingKeys  {dedupe_key: true} already in the log
 *   settingsMap   Settings tab as {key: value}
 * Returns {rows, counts}. rows are objects keyed by log header. Pure: replaying
 * the same events with the returned keys added gives rows = [].
 * Assumption (PRD Q13, open): bus_reached_school goes to ALL notify=Yes students
 * on the trip and session, not only those whose pickup stop was crossed.
 */
function gpsEvFanOut_(events, students, existingKeys, settingsMap, nowMs) {
  var s = gpsEvReadSettings_(settingsMap);
  var counts = { events: events.length, dropped_off: 0, session_mismatch: 0, no_targets: 0,
    existing: 0, new_rows: 0, pending_feed: 0, local_only: 0, suppressed: 0 };
  var rows = [];
  if (s.mode === 'off') { counts.dropped_off = events.length; return { rows: rows, counts: counts }; }
  var seen = {};
  Object.keys(existingKeys || {}).forEach(function (k) { seen[k] = true; });
  var createdAt = gpsEvStamp_(nowMs);
  var inWindow = gpsEvInWindow_(nowMs, s.window);

  events.forEach(function (ev) {
    if (!gpsEvSessionFits_(ev)) { counts.session_mismatch++; return; }
    var schoolEvent = GPS_EV_SCHOOL_EVENTS.indexOf(ev.event_type) >= 0;
    var targets = (students || []).filter(function (r) {
      var adm = r.admission_no == null ? '' : String(r.admission_no).trim();
      return adm &&
        String(r.trip_code == null ? '' : r.trip_code).trim() === ev.trip_code &&
        String(r.session == null ? '' : r.session).trim() === ev.session &&
        gpsEvYes_(r.active) && gpsEvYes_(r.notify) &&
        (schoolEvent || String(r.stop_id == null ? '' : r.stop_id).trim() === ev.stop_id);
    });
    if (!targets.length) { counts.no_targets++; return; }

    var d = gpsEvDecide_(ev, s);
    if (nowMs >= ev.expires_at) d = { status: 'suppressed', reason: 'after_expires_at' };
    else if (d.status === 'pending_feed' && !inWindow) d = { status: 'suppressed', reason: 'outside_gcm_window' };

    targets.forEach(function (r) {
      var adm = String(r.admission_no).trim();
      var key = ev.trip_run_id + '|' + adm + '|' + ev.event_type;
      if (seen[key]) { counts.existing++; return; }
      seen[key] = true;
      rows.push({
        dedupe_key: key, event_id: ev.event_key, created_at: createdAt,
        service_date: ev.service_date, trip_run_id: ev.trip_run_id, session: ev.session,
        event_type: ev.event_type, admission_no: adm, stop_id: ev.stop_id,
        eta_minutes: ev.eta_minutes == null ? '' : ev.eta_minutes, mode: s.mode,
        status: d.status, suppressed_reason: d.reason, expires_at: ev.expires_at
      });
      counts.new_rows++;
      counts[d.status]++;
    });
  });
  return { rows: rows, counts: counts };
}

/** Row objects -> 2D array in live header order. A needed header that is missing is an error. */
function gpsEvBuildMatrix_(rows, headers) {
  var names = headers.map(function (h) { return String(h == null ? '' : h).trim(); });
  if (rows.length) {
    Object.keys(rows[0]).forEach(function (k) {
      if (names.indexOf(k) < 0) throw new Error('Parent_Notify_Log header missing: ' + k);
    });
  }
  return rows.map(function (r) {
    return names.map(function (h) { return h && Object.prototype.hasOwnProperty.call(r, h) ? r[h] : ''; });
  });
}

// ---- 3. Apps Script glue ---------------------------------------------------

function gpsEvJson_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function gpsEvHmacHex_(message, key) {
  return gpsHexFromBytes_(Utilities.computeHmacSha256Signature(message, key));
}

/**
 * Write new rows after the last row: one setValues, then flush so the batch is
 * durable before the caller answers ok. Must be called holding the script lock.
 */
function gpsEvWriteRows_(sh, rows) {
  if (!rows.length) return;
  var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var matrix = gpsEvBuildMatrix_(rows, headers);
  var start = sh.getLastRow() + 1;
  var over = start + matrix.length - 1 - sh.getMaxRows();
  if (over > 0) sh.insertRowsAfter(sh.getMaxRows(), over);
  sh.getRange(start, 1, matrix.length, headers.length).setValues(matrix);
  SpreadsheetApp.flush();
}

/** dedupe_key column of the log as {key: true}, read by header name in one call. */
function gpsEvExistingKeys_(sh) {
  var map = gpsHeaderMap_(sh);
  var col = map['dedupe_key'];
  if (!col) throw new Error('Parent_Notify_Log has no dedupe_key header');
  var out = {};
  var last = sh.getLastRow();
  if (last < 2) return out;
  sh.getRange(2, col, last - 1, 1).getValues().forEach(function (r) {
    var k = String(r[0] == null ? '' : r[0]).trim();
    if (k) out[k] = true;
  });
  return out;
}

/**
 * Handle one request. Returns {ok:true, ...counts} or {ok:false}. Exposed
 * separately from doPost so tests can pass `nowMs`. May throw; doPost catches.
 */
function gpsEvHandle_(e, nowMs) {
  var props = PropertiesService.getScriptProperties();
  var key = props.getProperty(GPS_EV_PROP_KEY);
  var params = (e && e.parameter) || {};
  var body = e && e.postData && e.postData.contents;

  var v = gpsEvVerify_(key, params.ts, params.sig, body, nowMs, gpsEvHmacHex_);
  if (!v.ok) { Logger.log('doPost rejected: ' + v.reason); return { ok: false }; }

  // A batch whose first delivery already completed is a no-op. Cached only after a durable write.
  var cache = CacheService.getScriptCache();
  var seenKey = 'gps_ev_seen_' + String(params.sig).toLowerCase();
  if (cache.get(seenKey)) return { ok: true, replay: true };

  var parsed = gpsEvParseBatch_(body);
  if (!parsed.ok) { Logger.log('doPost rejected: ' + parsed.reason); return { ok: false }; }

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var settings = gpsSettingsMap_(ss);
  if (gpsEvReadSettings_(settings).mode === 'off') {
    cache.put(seenKey, '1', GPS_EV_SEEN_TTL_S);
    return { ok: true, dropped: parsed.events.length };
  }

  var students = gpsReadTable_(ss, GPS_SHEETS.STUDENT_STOPS);
  var sh = ss.getSheetByName(GPS_SHEETS.NOTIFY_LOG);
  if (!sh) throw new Error('Parent_Notify_Log tab missing');

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(GPS_EV_LOCK_WAIT_MS)) throw new Error('lock busy');
  var plan;
  try {
    plan = gpsEvFanOut_(parsed.events, students, gpsEvExistingKeys_(sh), settings, nowMs);
    gpsEvWriteRows_(sh, plan.rows);
  } finally {
    try { lock.releaseLock(); } catch (x) { /* nothing to do */ }
  }
  cache.put(seenKey, '1', GPS_EV_SEEN_TTL_S);
  return { ok: true, written: plan.counts.new_rows, existing: plan.counts.existing };
}

/**
 * PUBLIC endpoint (the app is ANYONE_ANONYMOUS). Never throws and never says why
 * it refused: any failure, including a sheet or lock error, answers {ok:false}
 * so the Worker keeps the batch and retries until it expires. Internal failures
 * are logged as a short error message only (ours or Google's; never the body, signature or key). The
 * Worker's outbox-age alert (R12) is what raises the Ops Alert for a batch
 * that keeps failing.
 */
function doPost(e) {
  try {
    var r = gpsEvHandle_(e, Date.now());
    return gpsEvJson_(r && r.ok === true ? r : { ok: false });
  } catch (err) {
    try { Logger.log('doPost failed: ' + String(err && err.message ? err.message : 'error').slice(0, 120)); } catch (x) { /* ignore */ }
    try { return gpsEvJson_({ ok: false }); } catch (y) { return null; }
  }
}
