/**
 * GpsWorker.js — thin client for the Cloudflare GPS Worker, the config push and
 * the device-token menu (PRD rev 4 R13, R17, R20, R21, T8).
 *
 * Secrets (Script Properties only, never in a file, a Sheet or a log):
 *   GPS_WORKER_URL      https origin of the Worker, no path
 *   GPS_READ_SECRET     sent as X-Transport-Read-Secret  (GET /v1/latest|track|daily)
 *   GPS_CONFIG_SECRET   sent as X-Transport-Config-Secret (POST /v1/admin/...)
 *
 * Payload shapes match the Worker repo (christwood-transport-gps):
 *   src/readapi.mjs  validateConfig / adminConfig  (POST /v1/admin/config)
 *   src/index.mjs    handleAdmin                   (POST /v1/admin/tokens/issue|revoke)
 *
 * Layout: 1. constants  2. pure logic (unit-tested)  3. Apps Script glue.
 * Functions ending in "_" cannot be called from google.script.run.
 */

// ---- 1. Constants ----------------------------------------------------------

const GPS_PROP_URL = 'GPS_WORKER_URL';
const GPS_PROP_READ_SECRET = 'GPS_READ_SECRET';
const GPS_PROP_CONFIG_SECRET = 'GPS_CONFIG_SECRET';
const GPS_PROP_LAST_PUSH = 'GPS_CONFIG_LAST_PUSH'; // non-secret: "hash|version|yyyy-MM-dd HH:mm"

/** Total tries per Worker call, and the pauses between them (ms). */
const GPS_HTTP_ATTEMPTS = 3;
const GPS_HTTP_BACKOFF_MS = [500, 1500];

const GPS_DEVICE_ID_RE = /^[A-Za-z0-9._-]{1,64}$/;

/** Settings keys pushed to the Worker. Code-owned list; the values live in the Settings tab. */
const GPS_PUSHED_SETTING_KEYS = [
  'gps_service_days', 'gps_window_grace_min', 'gps_stale_minutes', 'gps_ping_interval_s',
  'gps_retention_days', 'gps_alerts_enabled', 'gps_purge_enabled', 'gps_backfill_bucket',
  'notify_eta_minutes', 'notify_max_fix_age_s', 'notify_max_accuracy_m',
  'eta_road_factor', 'eta_speed_window_min'
];

// ---- 2. Pure logic ---------------------------------------------------------

/** 5xx, 429 and a thrown fetch (status 0) are worth another try; other 4xx are not. */
function gpsIsRetryable_(status) {
  return status === 0 || status === 429 || status >= 500;
}

/**
 * Call attemptFn() up to `attempts` times. attemptFn returns {status, text} or
 * throws. Pauses via sleepFn(ms) between tries. Returns
 * {ok, status, text, attempts, error}; error is a short fixed phrase, never the
 * exception text (which could echo a URL).
 */
function gpsWithRetry_(attemptFn, attempts, backoffMs, sleepFn) {
  var last = { ok: false, status: 0, text: '', attempts: 0, error: 'no attempt made' };
  for (var i = 0; i < attempts; i++) {
    var r;
    try {
      var x = attemptFn();
      var st = Number(x && x.status) || 0;
      r = { ok: st >= 200 && st < 300, status: st, text: String((x && x.text) || ''), attempts: i + 1,
            error: (st >= 200 && st < 300) ? '' : 'Worker answered HTTP ' + st };
    } catch (e) {
      r = { ok: false, status: 0, text: '', attempts: i + 1, error: 'Worker could not be reached' };
    }
    last = r;
    if (r.ok || !gpsIsRetryable_(r.status)) return r;
    if (i < attempts - 1 && sleepFn) sleepFn(backoffMs[Math.min(i, backoffMs.length - 1)] || 0);
  }
  return last;
}

/** Same canonical JSON as the Worker's canonicalJson (keys sorted, undefined -> null). */
function gpsCanonicalJson_(v) {
  if (Array.isArray(v)) return '[' + v.map(gpsCanonicalJson_).join(',') + ']';
  if (v && typeof v === 'object') {
    return '{' + Object.keys(v).sort().map(function (k) {
      return JSON.stringify(k) + ':' + gpsCanonicalJson_(v[k]);
    }).join(',') + '}';
  }
  var s = JSON.stringify(v === undefined ? null : v);
  return s === undefined ? 'null' : s;
}

/** Signed byte array (Utilities.computeDigest) -> lower-case hex. */
function gpsHexFromBytes_(bytes) {
  return bytes.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

/** True if any object key, at any depth, contains "admission" (the Worker refuses these too). */
function gpsHasAdmissionKey_(v) {
  if (Array.isArray(v)) return v.some(gpsHasAdmissionKey_);
  if (v && typeof v === 'object') {
    return Object.keys(v).some(function (k) {
      return /admission/i.test(k) || gpsHasAdmissionKey_(v[k]);
    });
  }
  return false;
}

function gpsNumOrNull_(v) {
  if (v === '' || v === null || v === undefined) return null;
  var n = Number(v);
  return isFinite(n) ? n : null;
}

function gpsYes_(v) { return /^(1|y|yes|true)$/i.test(gpsStr_(v)); }

/** 1 unless the cell says No (blank counts as active, as in gpsValidateSetup_). */
function gpsActiveFlag_(v) { return gpsIsOff_(v) || /^(0|n|false)$/i.test(gpsStr_(v)) ? 0 : 1; }

/**
 * Device row -> Worker device. Only whitelisted fields leave the Sheet.
 * `active` is 0 for a revoked device or one outside active_from/active_to
 * (yyyy-MM-dd strings; today is yyyy-MM-dd). Returns null for a row with no id.
 */
function gpsDeviceForWorker_(r, today) {
  var id = gpsStr_(r.device_id);
  if (!id) return null;
  var from = gpsStr_(r.active_from), to = gpsStr_(r.active_to);
  var active = 1;
  if (/^revoked$/i.test(gpsStr_(r.status))) active = 0;
  if (from && today < from) active = 0;
  if (to && today > to) active = 0;
  var d = { device_id: id, store_outside_window: gpsYes_(r.store_outside_window) ? 1 : 0, active: active };
  var veh = gpsStr_(r.vehicle_id), kind = gpsStr_(r.kind);
  if (veh) d.vehicle_id = veh;
  if (kind) d.kind = kind;
  return d;
}

/**
 * Build the /v1/admin/config body (without content_hash).
 * tables = {devices, trips, stops, tripStops, settings}: row objects from
 * gpsRowsToObjects_. Student_Trip_Stops is never an input. Rows without their
 * required id are dropped, as the Worker would reject the whole push otherwise.
 */
function gpsBuildConfigData_(tables, today) {
  var devices = [], trips = [], stops = [], tripStops = [], settings = {};
  (tables.devices || []).forEach(function (r) {
    var d = gpsDeviceForWorker_(r, today);
    if (d) devices.push(d);
  });
  (tables.trips || []).forEach(function (r) {
    var code = gpsStr_(r.trip_code);
    if (!code) return;
    trips.push({
      trip_code: code, session: gpsStr_(r.session), route_no: gpsStr_(r.route_no),
      vehicle_id: gpsStr_(r.vehicle_id), window_start: gpsStr_(r.window_start),
      window_end: gpsStr_(r.window_end), active: gpsActiveFlag_(r.active)
    });
  });
  (tables.stops || []).forEach(function (r) {
    var id = gpsStr_(r.stop_id);
    if (!id) return;
    stops.push({
      stop_id: id, stop_name: gpsStr_(r.stop_name), landmark: gpsStr_(r.landmark),
      lat: gpsNumOrNull_(r.lat), lon: gpsNumOrNull_(r.lon), radius_m: gpsNumOrNull_(r.radius_m),
      kind: gpsStr_(r.kind), active: gpsActiveFlag_(r.active)
    });
  });
  (tables.tripStops || []).forEach(function (r) {
    var code = gpsStr_(r.trip_code), id = gpsStr_(r.stop_id);
    if (!code || !id) return;
    tripStops.push({
      trip_code: code, stop_id: id, sequence: gpsNumOrNull_(r.sequence),
      scheduled_time: gpsStr_(r.scheduled_time)
    });
  });
  var have = {};
  (tables.settings || []).forEach(function (r) { have[gpsStr_(r.setting)] = gpsStr_(r.value); });
  GPS_PUSHED_SETTING_KEYS.forEach(function (k) {
    if (have[k] !== undefined && have[k] !== '') settings[k] = have[k].slice(0, 500);
  });
  return { devices: devices, trips: trips, stops: stops, trip_stops: tripStops, settings: settings };
}

/**
 * Full body: the data plus content_hash = sha256(canonical(data)). Refuses (throws)
 * if an admission key is anywhere in it. sha256HexFn(text) -> hex string.
 */
function gpsBuildConfigBody_(tables, today, sha256HexFn) {
  var data = gpsBuildConfigData_(tables, today);
  if (gpsHasAdmissionKey_(data)) throw new Error('Config payload must not carry admission data');
  var body = {
    devices: data.devices, trips: data.trips, stops: data.stops,
    trip_stops: data.trip_stops, settings: data.settings,
    content_hash: sha256HexFn(gpsCanonicalJson_(data))
  };
  return body;
}

/** Fields of a GPS_Devices row to write after an issue: only last4 and the time. Never the token. */
function gpsIssueSheetUpdate_(tokenLast4, issuedAt, editor) {
  return { token_last4: String(tokenLast4 || ''), token_issued_at: issuedAt, status: 'Pending',
           edited_by: editor, edited_at: issuedAt };
}

// ---- 3. Apps Script glue ---------------------------------------------------

function gpsSha256Hex_(text) {
  return gpsHexFromBytes_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8));
}

/** Now as yyyy-MM-dd HH:mm in Asia/Kolkata. */
function gpsNowText_() {
  return Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd HH:mm');
}

/**
 * One Worker call with retry. kind is 'read' or 'config' and picks the header and
 * secret. Returns {ok, status, json, error}. Nothing sensitive is logged: only the
 * path-free outcome. A missing Script Property is a clean error, not a throw.
 */
function gpsWorkerCall_(kind, method, path, query, bodyObj) {
  var props = PropertiesService.getScriptProperties();
  var base = gpsStr_(props.getProperty(GPS_PROP_URL)).replace(/\/+$/, '');
  var secret = gpsStr_(props.getProperty(kind === 'config' ? GPS_PROP_CONFIG_SECRET : GPS_PROP_READ_SECRET));
  if (!/^https:\/\/[^\s/]+$/.test(base) || !secret) {
    return { ok: false, status: 0, json: null, error: 'GPS Worker is not configured (Script Properties)' };
  }
  var url = base + path;
  if (query) {
    var parts = Object.keys(query).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(query[k]); });
    if (parts.length) url += '?' + parts.join('&');
  }
  var headers = {};
  headers[kind === 'config' ? 'X-Transport-Config-Secret' : 'X-Transport-Read-Secret'] = secret;
  var opts = { method: method, headers: headers, muteHttpExceptions: true, followRedirects: true };
  if (bodyObj !== undefined && bodyObj !== null) {
    opts.contentType = 'application/json';
    opts.payload = JSON.stringify(bodyObj);
  }
  var res = gpsWithRetry_(function () {
    var r = UrlFetchApp.fetch(url, opts);
    return { status: r.getResponseCode(), text: r.getContentText() };
  }, GPS_HTTP_ATTEMPTS, GPS_HTTP_BACKOFF_MS, function (ms) { Utilities.sleep(ms); });
  var json = null;
  if (res.ok) {
    try { json = JSON.parse(res.text); } catch (e) { json = null; }
    if (json === null || typeof json !== 'object') {
      return { ok: false, status: res.status, json: null, error: 'Worker answered with something that is not JSON' };
    }
  }
  if (!res.ok) { try { Logger.log('GPS Worker ' + method + ' failed: ' + res.error); } catch (x) {} }
  return { ok: res.ok, status: res.status, json: json, error: res.error };
}

/** Cell -> text. Dates become yyyy-MM-dd; time-only cells (1899/1900 serials) become HH:mm. */
function gpsCellText_(v) {
  if (Object.prototype.toString.call(v) === '[object Date]') {
    if (isNaN(v.getTime())) return '';
    return v.getFullYear() < 1950
      ? Utilities.formatDate(v, 'Asia/Kolkata', 'HH:mm')
      : Utilities.formatDate(v, 'Asia/Kolkata', 'yyyy-MM-dd');
  }
  return v;
}

/** Whole tab -> row objects keyed by header name (never by position). Throws if the tab is missing. */
function gpsReadTab_(ss, name) {
  var sh = ss.getSheetByName(name);
  if (!sh) throw new Error(name + ' tab missing');
  var lr = sh.getLastRow(), lc = sh.getLastColumn();
  if (lr < 2 || lc < 1) return [];
  var values = sh.getRange(1, 1, lr, lc).getValues().map(function (row) { return row.map(gpsCellText_); });
  return gpsRowsToObjects_(values);
}

/** Read the five config sources and build the push body. Student_Trip_Stops is never opened. */
function gpsBuildConfigFromSheets_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var tables = {
    devices: gpsReadTab_(ss, GPS_SHEETS.DEVICES),
    trips: gpsReadTab_(ss, GPS_SHEETS.TRIPS),
    stops: gpsReadTab_(ss, GPS_SHEETS.STOPS),
    tripStops: gpsReadTab_(ss, GPS_SHEETS.TRIP_STOPS),
    settings: gpsReadTab_(ss, GPS_SETTINGS_TAB)
  };
  var today = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd');
  return gpsBuildConfigBody_(tables, today, gpsSha256Hex_);
}

/**
 * R20: push config. Returns {ok, changed, version, hash} or {ok:false, error}.
 * The Worker answers changed:false for an unchanged hash, so no new version.
 * Callers have already passed gpsRequire_('manage').
 */
function gpsPushConfigCore_() {
  var body;
  try { body = gpsBuildConfigFromSheets_(); }
  catch (e) { return { ok: false, error: 'Could not read the GPS tabs: ' + String(e && e.message || e).slice(0, 120) }; }
  var res = gpsWorkerCall_('config', 'POST', '/v1/admin/config', null, body);
  if (!res.ok) return { ok: false, error: res.error };
  var j = res.json || {};
  var out = { ok: true, changed: j.changed === true, version: j.version === undefined ? null : j.version,
              hash: String(j.content_hash || body.content_hash).slice(0, 12),
              counts: { devices: body.devices.length, trips: body.trips.length, stops: body.stops.length,
                        trip_stops: body.trip_stops.length, settings: Object.keys(body.settings).length } };
  try {
    PropertiesService.getScriptProperties().setProperty(GPS_PROP_LAST_PUSH,
      out.hash + '|' + out.version + '|' + gpsNowText_());
    CacheService.getScriptCache().remove(GPS_LATEST_FRESH_KEY); // next load sees the new config
    CacheService.getScriptCache().remove(GPS_FLEET_CFG_KEY);
  } catch (e) { /* bookkeeping only */ }
  return out;
}

/** Row number (1-based) and header map of a device in GPS_Devices, or null. */
function gpsFindDevice_(ss, deviceId) {
  var sh = ss.getSheetByName(GPS_SHEETS.DEVICES);
  if (!sh) throw new Error('GPS_Devices tab missing');
  var cols = gpsHeaderMap_(sh);
  if (!cols.device_id) throw new Error('GPS_Devices has no device_id header');
  var lr = sh.getLastRow();
  if (lr < 2) return null;
  var ids = sh.getRange(2, cols.device_id, lr - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (gpsStr_(ids[i][0]) === deviceId) return { sh: sh, cols: cols, row: i + 2 };
  }
  return null;
}

/** Write {header: value} into one GPS_Devices row with a single setValues. Missing headers are skipped. */
function gpsWriteDeviceFields_(found, fields) {
  var lc = found.sh.getLastColumn();
  var cur = found.sh.getRange(found.row, 1, 1, lc).getValues();
  Object.keys(fields).forEach(function (h) {
    var c = found.cols[h];
    if (c) cur[0][c - 1] = fields[h];
  });
  found.sh.getRange(found.row, 1, 1, lc).setValues(cur);
}

/**
 * R21: issue or reissue. Returns {ok, device_id, token_last4, url, warning?}. The
 * URL carries the token and is returned to the caller exactly once; only last4 and
 * the issue time are stored. Callers have already passed gpsRequire_('manage').
 */
function gpsIssueTokenCore_(deviceId, editor) {
  deviceId = gpsStr_(deviceId);
  if (!GPS_DEVICE_ID_RE.test(deviceId)) return { ok: false, error: 'Device id is not valid.' };
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var found;
  try { found = gpsFindDevice_(ss, deviceId); }
  catch (e) { return { ok: false, error: 'Could not read GPS_Devices.' }; }
  if (!found) return { ok: false, error: 'Add this device to GPS_Devices first.' };
  var cur = found.sh.getRange(found.row, 1, 1, found.sh.getLastColumn()).getValues()[0];
  var cell = function (h) { return found.cols[h] ? cur[found.cols[h] - 1] : ''; };
  var payload = {
    device_id: deviceId,
    vehicle_id: gpsStr_(cell('vehicle_id')) || null,
    kind: gpsStr_(cell('kind')) || null,
    store_outside_window: gpsYes_(cell('store_outside_window'))
  };
  var res = gpsWorkerCall_('config', 'POST', '/v1/admin/tokens/issue', null, payload);
  if (!res.ok) return { ok: false, error: res.error };
  var j = res.json || {};
  var token = typeof j.token === 'string' ? j.token : '';
  var url = typeof j.url === 'string' ? j.url : '';
  if (!token || !url) return { ok: false, error: 'Worker did not return a token.' };
  var last4 = String(j.token_last4 || token.slice(-4));
  var out = { ok: true, device_id: deviceId, token_last4: last4, url: url };
  try {
    gpsWriteDeviceFields_(found, gpsIssueSheetUpdate_(last4, gpsNowText_(), editor));
  } catch (e) {
    out.warning = 'The token was issued but GPS_Devices could not be updated. Type the last 4 characters (' + last4 + ') into token_last4.';
  }
  return out;
}

/** Revoke a device token at the Worker and mark the row Revoked. */
function gpsRevokeTokenCore_(deviceId, editor) {
  deviceId = gpsStr_(deviceId);
  if (!GPS_DEVICE_ID_RE.test(deviceId)) return { ok: false, error: 'Device id is not valid.' };
  var res = gpsWorkerCall_('config', 'POST', '/v1/admin/tokens/revoke', null, { device_id: deviceId });
  if (!res.ok) {
    return { ok: false, error: res.status === 404 ? 'The Worker does not know this device.' : res.error };
  }
  var out = { ok: true, device_id: deviceId };
  try {
    var found = gpsFindDevice_(SpreadsheetApp.getActiveSpreadsheet(), deviceId);
    if (found) gpsWriteDeviceFields_(found, { status: 'Revoked', edited_by: editor, edited_at: gpsNowText_() });
  } catch (e) {
    out.warning = 'Revoked at the Worker, but GPS_Devices could not be updated.';
  }
  return out;
}

// ---- Sheet menu (manual twins; wired in Code.js onOpen) --------------------

/** Menu guard: same R14 check as the web functions. Returns the auth object. */
function gpsMenuGuard_(ui) {
  var auth = gpsRequire_('manage');
  if (!auth.ok) ui.alert('GPS', auth.error, ui.ButtonSet.OK);
  return auth;
}

function menuPushGpsConfig() {
  var ui = SpreadsheetApp.getUi();
  var auth = gpsMenuGuard_(ui);
  if (!auth.ok) return;
  var r = gpsPushConfigCore_();
  if (!r.ok) { ui.alert('Push GPS config', 'Not pushed. ' + r.error, ui.ButtonSet.OK); return; }
  ui.alert('Push GPS config',
    (r.changed ? 'Pushed. The Worker is now on config version ' + r.version + '.' : 'Nothing changed, so no new version (still ' + r.version + ').') +
    '\n\nSent ' + r.counts.devices + ' devices, ' + r.counts.trips + ' trips, ' + r.counts.stops + ' stops, ' +
    r.counts.trip_stops + ' trip stops and ' + r.counts.settings + ' settings. Student data is never sent.',
    ui.ButtonSet.OK);
}

function menuIssueGpsToken() {
  var ui = SpreadsheetApp.getUi();
  var auth = gpsMenuGuard_(ui);
  if (!auth.ok) return;
  var p = ui.prompt('Issue / reissue device token', 'Device id (as in GPS_Devices). Reissuing stops the old token working at once.', ui.ButtonSet.OK_CANCEL);
  if (p.getSelectedButton() !== ui.Button.OK) return;
  var r = gpsIssueTokenCore_(p.getResponseText(), auth.email);
  if (!r.ok) { ui.alert('Issue token', 'Not issued. ' + r.error, ui.ButtonSet.OK); return; }
  gpsShowTokenDialog_(r.url, r.device_id, r.token_last4, r.warning || '');
}

function menuRevokeGpsToken() {
  var ui = SpreadsheetApp.getUi();
  var auth = gpsMenuGuard_(ui);
  if (!auth.ok) return;
  var p = ui.prompt('Revoke device token', 'Device id to revoke. Its phone will stop reporting.', ui.ButtonSet.OK_CANCEL);
  if (p.getSelectedButton() !== ui.Button.OK) return;
  var r = gpsRevokeTokenCore_(p.getResponseText(), auth.email);
  ui.alert('Revoke token', r.ok ? 'Revoked ' + r.device_id + '.' + (r.warning ? '\n' + r.warning : '') : 'Not revoked. ' + r.error, ui.ButtonSet.OK);
}

/**
 * Show the URL and QR once. The URL goes into the page template and nowhere else:
 * it is not cached, stored or logged, and closing the dialog loses it.
 */
function gpsShowTokenDialog_(url, deviceId, last4, warning) {
  var t = HtmlService.createTemplateFromFile('GpsTokenDialog');
  t.url = url; t.deviceId = deviceId; t.last4 = last4; t.warning = warning;
  SpreadsheetApp.getUi().showModalDialog(t.evaluate().setWidth(380).setHeight(560), 'Device token (shown once)');
}
