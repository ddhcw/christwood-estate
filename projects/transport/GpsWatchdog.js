/**
 * GpsWatchdog.js — G-C (PRD R12, RFC-GPS-2, RFC-GPS-3).
 *
 * gpsWatchdog() is the 15-minute trigger body. It checks the Worker's /v1/health
 * and, when the feeder exists, Parent_Notify_Log and the `feeder_heartbeat`
 * setting. A problem raises ONE alert per episode (state in Script Properties);
 * when the problem clears it raises ONE recovery. Alerts go to Ops Alerts via the
 * OPS_ALERTS_WEBHOOK Script Property; if Chat fails the same text is emailed to
 * the `alert_email` setting (owner if blank).
 *
 * Nothing here runs by itself: installGpsTriggers() (Fleet menu) creates the
 * trigger, and only when a person picks it. Flat GAS style: no imports. Loads
 * after GpsSetup.js / GpsWorker.js / GpsEndpoints.js (alphabetical order does
 * that), and uses their helpers only inside functions.
 *
 * Alert text carries counts, ages and condition names only: never coordinates,
 * names or admission numbers.
 */

// ---- 1. Constants ----------------------------------------------------------

const GPS_PROP_OPS_WEBHOOK = 'OPS_ALERTS_WEBHOOK';
const GPS_PROP_WATCHDOG_STATE = 'GPS_WATCHDOG_STATE'; // non-secret: {conditionKey: "since yyyy-MM-dd HH:mm"}

const GPS_WATCHDOG_MINUTES = 15;           // trigger cadence and every "older than" threshold
const GPS_CRON_SILENT_MS = 15 * 60000;
const GPS_OUTBOX_OLD_MS = 15 * 60000;
const GPS_FEED_STUCK_MS = 15 * 60000;
const GPS_HEARTBEAT_MAX_MS = 5 * 60000;
const GPS_FEED_PENDING_STATUSES = ['pending_feed', 'queued_gcm'];

const GPS_WATCHDOG_LABELS = {
  health_down: 'GPS Worker health check is failing',
  cron_silent: 'GPS Worker cron has been silent for more than 15 minutes',
  outbox_stuck: 'GPS Worker outbox has items older than 15 minutes',
  feed_stuck: 'Parent notifications are waiting in the log for more than 15 minutes',
  feeder_heartbeat: 'Feeder heartbeat is more than 5 minutes old'
};

// ---- 2. Pure logic ---------------------------------------------------------

/**
 * Cell or text -> epoch ms, or null. Accepts a Date, epoch ms (number or digit
 * string), "yyyy-MM-dd HH:mm[:ss]" (read as Asia/Kolkata) or an ISO string with
 * a zone.
 */
function gpsParseTs_(v) {
  if (v === null || v === undefined || v === '') return null;
  if (Object.prototype.toString.call(v) === '[object Date]') {
    var t = v.getTime();
    return isNaN(t) ? null : t;
  }
  if (typeof v === 'number') return isFinite(v) && v > 1e11 ? v : null;
  var s = String(v).trim();
  if (/^\d{12,}$/.test(s)) return Number(s);
  var m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(s);
  if (m) {
    return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)) - GPS_IST_OFFSET_MS;
  }
  if (/^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:?\d{2})$/.test(s)) {
    var p = Date.parse(s);
    return isNaN(p) ? null : p;
  }
  return null;
}

/** Is `nowMs` on a service day and inside a trip window (plus grace)? Pure. */
function gpsInServiceWindow_(trips, nowMs, serviceDaysText, graceMin) {
  var names = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  var today = names[new Date(Number(nowMs) + GPS_IST_OFFSET_MS).getUTCDay()];
  var days = gpsStr_(serviceDaysText).toLowerCase().split(/[\s,;]+/).filter(Boolean)
    .map(function (d) { return d.slice(0, 3); });
  if (days.indexOf(today) < 0) return false;
  var minute = gpsMinuteOfDay_(nowMs);
  var grace = isFinite(graceMin) ? Number(graceMin) : 15;
  return (trips || []).some(function (t) {
    return gpsPickTrip_([t], gpsStr_(t.vehicle_id), minute, grace) !== null;
  });
}

/**
 * Worker call result -> conditions. res is gpsWorkerCall_'s {ok, json, error}.
 * Returns {conditions:[{key,detail}], healthKnown}. A failed call is only
 * health_down: the other Worker checks are unknown, not cleared.
 */
function gpsEvaluateHealth_(res) {
  if (!res || !res.ok || !res.json || res.json.ok !== true) {
    return { conditions: [{ key: 'health_down', detail: gpsStr_(res && res.error) || 'no valid answer' }], healthKnown: false };
  }
  var h = res.json, out = [];
  var cronAge = h.cron_age_ms;
  if (typeof cronAge !== 'number' || !isFinite(cronAge)) out.push({ key: 'cron_silent', detail: 'it has never reported a run' });
  else if (cronAge > GPS_CRON_SILENT_MS) out.push({ key: 'cron_silent', detail: 'last run ' + Math.round(cronAge / 60000) + ' min ago' });
  var ob = h.outbox_oldest_age_ms;
  if (typeof ob === 'number' && isFinite(ob) && ob > GPS_OUTBOX_OLD_MS) {
    out.push({ key: 'outbox_stuck', detail: 'oldest item is ' + Math.round(ob / 60000) + ' min old' });
  }
  return { conditions: out, healthKnown: true };
}

/** Parent_Notify_Log objects -> condition or null. Rows without a readable created_at are ignored. */
function gpsEvaluateNotifyLog_(rows, nowMs) {
  var stuck = 0, oldest = 0;
  (rows || []).forEach(function (r) {
    var st = gpsStr_(r.status).toLowerCase();
    if (GPS_FEED_PENDING_STATUSES.indexOf(st) < 0) return;
    var ts = gpsParseTs_(r.created_at);
    if (ts === null || nowMs - ts <= GPS_FEED_STUCK_MS) return;
    stuck++;
    oldest = Math.max(oldest, nowMs - ts);
  });
  return stuck ? { key: 'feed_stuck', detail: stuck + ' row(s), oldest ' + Math.round(oldest / 60000) + ' min' } : null;
}

/** feeder_heartbeat setting value -> condition or null. Blank/absent/unparseable = feeder not built: no condition. */
function gpsEvaluateHeartbeat_(value, nowMs) {
  var ts = gpsParseTs_(value);
  if (ts === null) return null;
  var age = nowMs - ts;
  return age > GPS_HEARTBEAT_MAX_MS ? { key: 'feeder_heartbeat', detail: 'last beat ' + Math.round(age / 60000) + ' min ago' } : null;
}

/**
 * Episode bookkeeping. prev = {key: since}; conditions = [{key, detail}];
 * unknownKeys = keys that could not be evaluated this run (carry over unchanged).
 * Returns {raise:[conditions that are new], clear:[keys that ended]}.
 */
function gpsPlanEpisodes_(prev, conditions, unknownKeys) {
  var active = {};
  conditions.forEach(function (c) { active[c.key] = c; });
  var skip = unknownKeys || [];
  return {
    raise: conditions.filter(function (c) { return !Object.prototype.hasOwnProperty.call(prev, c.key); }),
    clear: Object.keys(prev).filter(function (k) { return !active[k] && skip.indexOf(k) < 0; })
  };
}

function gpsAlertText_(conds, nowText) {
  return 'GPS watchdog alert (' + nowText + '): ' + conds.map(function (c) {
    return (GPS_WATCHDOG_LABELS[c.key] || c.key) + (c.detail ? ' (' + c.detail + ')' : '');
  }).join('; ') + '.';
}

function gpsRecoveryText_(keys, nowText) {
  return 'GPS watchdog recovered (' + nowText + '): ' + keys.map(function (k) { return GPS_WATCHDOG_LABELS[k] || k; }).join('; ') + ' — now clear.';
}

// ---- 3. Apps Script glue ---------------------------------------------------

/** Settings tab -> {key: text}, by header name. Missing tab = {}. */
function gpsSettingsMap_(ss) {
  var map = {};
  if (!ss.getSheetByName(GPS_SETTINGS_TAB)) return map;
  gpsReadTab_(ss, GPS_SETTINGS_TAB).forEach(function (r) {
    var k = gpsStr_(r.setting);
    if (k) map[k] = r.value;
  });
  return map;
}

/**
 * Post one message to Ops Alerts, falling back to email. Returns
 * {ok, via:'chat'|'email'|''}. No secret or URL is logged.
 */
function gpsOpsPost_(text, settings) {
  var hook = gpsStr_(PropertiesService.getScriptProperties().getProperty(GPS_PROP_OPS_WEBHOOK));
  if (/^https:\/\/[^\s]+$/.test(hook)) {
    var res = gpsWithRetry_(function () {
      var r = UrlFetchApp.fetch(hook, { method: 'post', contentType: 'application/json',
        payload: JSON.stringify({ text: text }), muteHttpExceptions: true });
      return { status: r.getResponseCode(), text: r.getContentText() };
    }, GPS_HTTP_ATTEMPTS, GPS_HTTP_BACKOFF_MS, function (ms) { Utilities.sleep(ms); });
    if (res.ok) return { ok: true, via: 'chat' };
    try { Logger.log('GPS Ops Alerts post failed (HTTP ' + res.status + '); falling back to email'); } catch (e) {}
  } else {
    try { Logger.log('GPS Ops Alerts webhook is not configured; falling back to email'); } catch (e) {}
  }
  try {
    var to = gpsStr_(settings && settings.alert_email) || Session.getEffectiveUser().getEmail();
    if (!to) return { ok: false, via: '' };
    MailApp.sendEmail({ to: to, subject: 'Transport GPS alert', body: text });
    return { ok: true, via: 'email' };
  } catch (e) {
    try { Logger.log('GPS alert email failed'); } catch (x) {}
    return { ok: false, via: '' };
  }
}

function gpsLoadWatchdogState_() {
  try {
    var raw = PropertiesService.getScriptProperties().getProperty(GPS_PROP_WATCHDOG_STATE);
    var o = raw ? JSON.parse(raw) : {};
    return o && typeof o === 'object' && !Array.isArray(o) ? o : {};
  } catch (e) { return {}; }
}

function gpsSaveWatchdogState_(state) {
  PropertiesService.getScriptProperties().setProperty(GPS_PROP_WATCHDOG_STATE, JSON.stringify(state));
}

/**
 * One watchdog pass. opts.force = ignore the service-window check (menu twin).
 * Returns {ok, skipped, reason, conditions, raised, recovered, via, posting}.
 * State is advanced only for messages that were actually delivered, so a
 * failed post is retried on the next run (honest state, rule 9).
 */
function gpsWatchdogCore_(opts) {
  var force = !!(opts && opts.force);
  var nowMs = Date.now();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var settings = gpsSettingsMap_(ss);
  var posting = gpsYes_(settings.gps_alerts_enabled);

  if (!force && !posting) return { ok: true, skipped: true, reason: 'gps_alerts_enabled is No', conditions: [], raised: 0, recovered: 0, via: '', posting: false };
  if (!force) {
    var trips = ss.getSheetByName(GPS_SHEETS.TRIPS) ? gpsReadTab_(ss, GPS_SHEETS.TRIPS) : [];
    if (!gpsInServiceWindow_(trips, nowMs, settings.gps_service_days, Number(settings.gps_window_grace_min))) {
      return { ok: true, skipped: true, reason: 'outside service windows', conditions: [], raised: 0, recovered: 0, via: '', posting: posting };
    }
  }

  var health = gpsEvaluateHealth_(gpsWorkerCall_('read', 'GET', '/v1/health'));
  var conditions = health.conditions.slice();
  var unknown = health.healthKnown ? [] : ['cron_silent', 'outbox_stuck'];

  // Feeder checks tolerate absence: no tab, no column, no heartbeat = nothing to say.
  var logRows = [];
  try { if (ss.getSheetByName(GPS_SHEETS.NOTIFY_LOG)) logRows = gpsReadTab_(ss, GPS_SHEETS.NOTIFY_LOG); } catch (e) { logRows = []; }
  var feed = gpsEvaluateNotifyLog_(logRows, nowMs);
  if (feed) conditions.push(feed);
  var beat = gpsEvaluateHeartbeat_(settings.feeder_heartbeat, nowMs);
  if (beat) conditions.push(beat);

  var prev = gpsLoadWatchdogState_();
  var plan = gpsPlanEpisodes_(prev, conditions, unknown);
  var nowText = gpsNowText_();
  var next = {};
  Object.keys(prev).forEach(function (k) { next[k] = prev[k]; });
  var via = '', raised = 0, recovered = 0;

  if (posting) {
    if (plan.raise.length) {
      var a = gpsOpsPost_(gpsAlertText_(plan.raise, nowText), settings);
      if (a.ok) { plan.raise.forEach(function (c) { next[c.key] = nowText; }); raised = plan.raise.length; via = a.via; }
    }
    if (plan.clear.length) {
      var r = gpsOpsPost_(gpsRecoveryText_(plan.clear, nowText), settings);
      if (r.ok) { plan.clear.forEach(function (k) { delete next[k]; }); recovered = plan.clear.length; via = via || r.via; }
    }
    try { gpsSaveWatchdogState_(next); } catch (e) { try { Logger.log('GPS watchdog state not saved'); } catch (x) {} }
  }
  return { ok: true, skipped: false, reason: '', conditions: conditions, raised: raised, recovered: recovered, via: via, posting: posting };
}

/**
 * Trigger entry (every 15 min, installed by installGpsTriggers). Returns nothing
 * so a caller of google.script.run learns nothing. It is idempotent and
 * rate-bounded by the episode state, so a stray call cannot spam Ops Alerts.
 */
function gpsWatchdog() {
  try { gpsWatchdogCore_({ force: false }); }
  catch (e) {
    try { Logger.log('gpsWatchdog failed: ' + String(e && e.message || e).slice(0, 200)); } catch (x) {}
    throw e; // let Apps Script's own failure notification fire
  }
}

/** Menu twin: Fleet > Check GPS now. Manage only; ignores the window check. */
function menuCheckGpsNow() {
  var ui = SpreadsheetApp.getUi();
  var auth = gpsMenuGuard_(ui);
  if (!auth.ok) return;
  var r;
  try { r = gpsWatchdogCore_({ force: true }); }
  catch (e) { ui.alert('Check GPS now', 'The check could not run: ' + String(e && e.message || e).slice(0, 150), ui.ButtonSet.OK); return; }
  var lines = r.conditions.length
    ? r.conditions.map(function (c) { return '• ' + (GPS_WATCHDOG_LABELS[c.key] || c.key) + (c.detail ? ' (' + c.detail + ')' : ''); })
    : ['All clear: the Worker is healthy and nothing is waiting.'];
  if (r.conditions.length) {
    lines.push('');
    lines.push(r.posting
      ? (r.raised || r.recovered ? 'Posted to ' + (r.via === 'email' ? 'email (Chat failed)' : 'Ops Alerts') + '.' : 'Already reported earlier, so nothing new was posted.')
      : 'Alerts are off (gps_alerts_enabled = No), so nothing was posted.');
  }
  ui.alert('Check GPS now', lines.join('\n'), ui.ButtonSet.OK);
}

/**
 * Menu: install the 15-minute watchdog trigger. Idempotent: any existing
 * gpsWatchdog trigger is removed first, so a re-run leaves exactly one.
 * Returns the number of triggers now installed for the handler.
 */
function gpsInstallTriggersCore_() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'gpsWatchdog') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('gpsWatchdog').timeBased().everyMinutes(GPS_WATCHDOG_MINUTES).create();
  return 1;
}

function installGpsTriggers() {
  var ui = SpreadsheetApp.getUi();
  var auth = gpsMenuGuard_(ui);
  if (!auth.ok) return;
  gpsInstallTriggersCore_();
  ui.alert('GPS watchdog on',
    'The GPS watchdog now runs every ' + GPS_WATCHDOG_MINUTES + ' minutes, and only acts inside service windows.\n' +
    'It posts only while gps_alerts_enabled is Yes on the Settings tab.', ui.ButtonSet.OK);
}
