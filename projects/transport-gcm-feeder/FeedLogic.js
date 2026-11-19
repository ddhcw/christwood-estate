/**
 * FeedLogic.js — pure logic of the transport GCM feeder (PRD rev 4 §6.2, R37, R39, R42, R43).
 *
 * No Apps Script service is used in this file. Everything here is values in,
 * values out, and unit-tested with `node --test test/`. Feed.js holds the glue.
 *
 * What the feeder does, in one paragraph: it reads Parent_Notify_Log rows that
 * the PUBLIC transport app wrote (status pending_feed), re-checks every one of
 * them (feed guard, R43), and appends OUTBOX rows to the GCM control sheet in
 * one batch. It trusts nothing it reads: values that reach a message template
 * come from allow-lists only, and a broken cap stops the whole feed until a
 * person resets it.
 *
 * Top-level code here must not reference constants from other files: GAS loads
 * files in project order. Use them only inside functions.
 */

// ---- 1. Constants ----------------------------------------------------------

/** The only GCM project this feeder ever writes for (R43). Never read from a sheet. */
const FD_PROJECT_ID = 'cw-bus-notify';

// GCM's own tab names. Matched EXACTLY, emoji and variation selector included
// (library 01_Constants.gs TABS). Written as escapes so an editor cannot
// silently normalise them: OUTBOX U+1F4E4, ROSTER U+1F393, MESSAGE LOG U+1F4E8,
// SETTINGS U+2699 U+FE0F.
const FD_GCM_TABS = {
  OUTBOX:   '📤 OUTBOX',
  ROSTER:   '🎓 ROSTER',
  LOG:      '📨 MESSAGE LOG',
  SETTINGS: '⚙️ SETTINGS'
};

// The real library header row of OUTBOX (01_Constants.gs TABS.OUTBOX.headers).
// The library locates columns by header name but WRITES by position
// (08_Outbox.gs enqueue), so we append in exactly this order and refuse to
// write if the live row 1 differs.
const FD_OUTBOX_HEADERS = ['Queued At', 'Project ID', 'Recipient', 'Template ID', 'Values (JSON)',
  'Send After', 'Status', 'Result', 'Hash'];

// Transport workbook tab names (same as the transport project's GPS_SHEETS).
const FD_WB_TABS = {
  LOG: 'Parent_Notify_Log', STUDENTS: 'Student_Trip_Stops', TRIPS: 'Transport_Trips',
  VEHICLES: 'Vehicle_Master', STOPS: 'Transport_Stops', SETTINGS: 'Settings'
};

// Columns of Parent_Notify_Log the feeder reads or writes (by header name).
const FD_LOG_COLUMNS = ['dedupe_key', 'event_id', 'created_at', 'service_date', 'trip_run_id', 'session',
  'event_type', 'admission_no', 'stop_id', 'mode', 'status', 'suppressed_reason', 'gcm_queued_at',
  'gcm_status', 'gcm_result', 'gcm_sent_at', 'latency_s', 'expires_at'];

/**
 * One entry per event type the feeder may feed. SCHOOL EVENTS ONLY: the two
 * stop-level types have no entry on purpose (Gate L, PRD 6.3c), so a row of
 * those types is always refused with `no_template`.
 */
const FD_TYPE_SPECS = {
  bus_reached_school: { templateId: 'cw-bus-reached-school', sessions: ['MORNING_PICKUP'] },
  bus_left_school:    { templateId: 'cw-bus-left-school', sessions: ['AFTERNOON_DROP', 'EVENING_DROP'] }
};

/** Session names the log may carry, and how each reads in a message. */
const FD_SESSION_LABELS = {
  MORNING_PICKUP: 'Morning pickup', AFTERNOON_DROP: 'Afternoon drop', EVENING_DROP: 'Evening drop'
};

const FD_MODES = ['off', 'shadow_local', 'shadow_gcm', 'live'];
const FD_DEFAULT_DAILY_CAP = 300;
const FD_MISSING_AFTER_MS = 10 * 60 * 1000;   // a queued row GCM cannot show after this is reported
const FD_IST_OFFSET_MS = 330 * 60000;
const FD_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const FD_RUN_RE = /^(\d{4}-\d{2}-\d{2})\|([A-Za-z0-9][A-Za-z0-9._-]{0,63})$/;
const FD_ADMISSION_RE = /^C0\d{3,6}$/i;
const FD_SPACE_RE = /^spaces\/[A-Za-z0-9_-]{1,64}$/;
const FD_BUS_RE = /^[A-Za-z0-9][A-Za-z0-9 ._\/-]{0,23}$/;
const FD_STOP_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 .,&'()\/-]{0,59}$/;
const FD_EVENT_ID_RE = /^\d{4}-\d{2}-\d{2}\|[A-Za-z0-9][A-Za-z0-9._-]{0,63}\|[A-Za-z0-9][A-Za-z0-9._-]{0,63}\|[a-z_]{3,40}$/;
const FD_SHADOW_REF_RE = /^shadow \d{1,9} [A-Za-z0-9|._-]{1,200}$/;

// ---- 2. Small helpers ------------------------------------------------------

function fdStr_(v) { return String(v == null ? '' : v).trim(); }
function fdYes_(v) { return fdStr_(v).toLowerCase() === 'yes'; }
function fdPad_(n, w) { var s = String(n); while (s.length < w) s = '0' + s; return s; }

/** Epoch ms from a number or a digit string, else null. */
function fdToMs_(v) {
  if (typeof v === 'number') return isFinite(v) && v > 1e11 ? v : null;
  var s = fdStr_(v);
  return /^\d{12,16}$/.test(s) ? Number(s) : null;
}

function fdParts_(ms) {
  var d = new Date(Number(ms) + FD_IST_OFFSET_MS);
  return { y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(),
    h: d.getUTCHours(), mi: d.getUTCMinutes(), s: d.getUTCSeconds() };
}
function fdDate_(ms) { var p = fdParts_(ms); return p.y + '-' + fdPad_(p.mo, 2) + '-' + fdPad_(p.d, 2); }
function fdStamp_(ms) {
  var p = fdParts_(ms);
  return fdDate_(ms) + ' ' + fdPad_(p.h, 2) + ':' + fdPad_(p.mi, 2) + ':' + fdPad_(p.s, 2);
}
/** ISO time with the +05:30 offset: the form the transport watchdog reads for feeder_heartbeat. */
function fdIso_(ms) { return fdStamp_(ms).replace(' ', 'T') + '+05:30'; }

/** A sheet cell (string, number or Date) -> epoch ms. Strings are "yyyy-MM-dd HH:mm[:ss]" in Asia/Kolkata. */
function fdCellMs_(v) {
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'number') return isFinite(v) && v > 1e11 ? v : null;
  var s = fdStr_(v);
  if (/^\d{12,16}$/.test(s)) return Number(s);
  var m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(s);
  if (!m) return null;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)) - FD_IST_OFFSET_MS;
}
/** Stamp text of a cell, "" if unreadable. Used only to compare dates. */
function fdCellStamp_(v) { var ms = fdCellMs_(v); return ms == null ? '' : fdStamp_(ms); }

/** "07:00-19:00" -> {start, end} in minutes, or null if it is not a usable window. */
function fdParseWindow_(text) {
  var m = /^\s*(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})\s*$/.exec(fdStr_(text));
  if (!m) return null;
  var s = +m[1] * 60 + +m[2], e = +m[3] * 60 + +m[4];
  if (+m[1] > 23 || +m[3] > 24 || +m[2] > 59 || +m[4] > 59 || s >= e) return null;
  return { start: s, end: e };
}

/**
 * Inside the window, in Asia/Kolkata. The library's own check is start-to-end
 * INCLUSIVE (07_Engine.gs withinSendWindow_); ours excludes the end minute so
 * a row is never queued in the last minute the sweeper may still run.
 */
function fdInWindow_(nowMs, win) {
  if (!win) return false;
  var p = fdParts_(nowMs), min = p.h * 60 + p.mi;
  return min >= win.start && min < win.end;
}

function fdList_(text) {
  return fdStr_(text).split(',').map(function (s) { return s.trim(); }).filter(function (s) { return s; });
}

/** Header names (trimmed) -> 0-based index. First one wins. */
function fdHeaderIndex_(headerRow) {
  var map = {};
  (headerRow || []).forEach(function (h, i) { var k = fdStr_(h); if (k && map[k] === undefined) map[k] = i; });
  return map;
}

/** 2D values (row 0 = headers) -> row objects with `_row` (1-based sheet row). Blank rows are skipped. */
function fdRows_(values) {
  if (!values || values.length < 2) return [];
  var idx = fdHeaderIndex_(values[0]), names = Object.keys(idx), out = [];
  for (var i = 1; i < values.length; i++) {
    var o = { _row: i + 1 }, any = false;
    names.forEach(function (n) {
      var v = values[i][idx[n]];
      o[n] = v === undefined ? '' : v;
      if (fdStr_(v) !== '') any = true;
    });
    if (any) out.push(o);
  }
  return out;
}

/** Cheap 53-bit string hash (cyrb53) as 14 hex digits. Used to tie a log row to its OUTBOX row. */
function fdHash_(str) {
  var h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (var i = 0; i < str.length; i++) {
    var ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  var n = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  var hex = n.toString(16);
  while (hex.length < 14) hex = '0' + hex;
  return hex;
}

// ---- 3. Settings -----------------------------------------------------------

/** Transport Settings map -> what the feeder needs. An unknown mode means shadow_local: nothing is fed. */
function fdReadSettings_(map) {
  map = map || {};
  var mode = fdStr_(map.parent_notify_mode).toLowerCase();
  if (FD_MODES.indexOf(mode) < 0) mode = 'shadow_local';
  var cap = Number(fdStr_(map.gcm_feed_daily_cap));
  return {
    mode: mode,
    types: fdList_(map.parent_notify_types),
    projectId: fdStr_(map.gcm_project_id),
    dailyCap: isFinite(cap) && cap >= 1 && Math.floor(cap) === cap ? cap : FD_DEFAULT_DAILY_CAP
  };
}

// ---- 4. Allow-listed values (R43: no free text can reach a template) -------

/** True if the text looks like a link or an address. Deliberately over-eager. */
function fdLooksLikeUrl_(text) {
  var s = String(text == null ? '' : text);
  return /(https?:|ftp:|file:|www\.|:\/\/|@)/i.test(s) || /\b[a-z0-9-]+\.[a-z]{2,}\b/i.test(s);
}

function fdDisplayDate_(ymd) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fdStr_(ymd));
  if (!m || +m[2] < 1 || +m[2] > 12) return null;
  return m[3] + ' ' + FD_MONTHS[+m[2] - 1] + ' ' + m[1];
}

/**
 * Check one placeholder value against its allow-list. kind is one of
 * bus, session, time, date, eta, stop. Returns {ok:true, value} or
 * {ok:false, reason}. A URL is refused for every kind, before anything else.
 */
function fdValidValue_(kind, raw) {
  var s = fdStr_(raw);
  if (kind !== 'time' && kind !== 'date' && fdLooksLikeUrl_(s)) return { ok: false, reason: 'url_in_' + kind };
  switch (kind) {
    case 'bus':
      return FD_BUS_RE.test(s) ? { ok: true, value: s } : { ok: false, reason: 'bad_bus' };
    case 'session':
      return FD_SESSION_LABELS[s] ? { ok: true, value: FD_SESSION_LABELS[s] } : { ok: false, reason: 'bad_session' };
    case 'time': {
      var ms = fdCellMs_(raw);
      return ms == null ? { ok: false, reason: 'bad_time' } : { ok: true, value: fdPad_(fdParts_(ms).h, 2) + ':' + fdPad_(fdParts_(ms).mi, 2) };
    }
    case 'date': {
      var d = fdDisplayDate_(s);
      return d ? { ok: true, value: d } : { ok: false, reason: 'bad_date' };
    }
    case 'eta': {
      var n = typeof raw === 'number' ? raw : (/^\d{1,2}$/.test(s) ? Number(s) : NaN);
      return isFinite(n) && Math.floor(n) === n && n >= 1 && n <= 60 ? { ok: true, value: String(n) } : { ok: false, reason: 'bad_eta' };
    }
    case 'stop':
      return FD_STOP_NAME_RE.test(s) ? { ok: true, value: s } : { ok: false, reason: 'bad_stop' };
  }
  return { ok: false, reason: 'unknown_kind' };
}

// ---- 5. The feed guard (R43), one row ---------------------------------------

/**
 * ctx = { nowMs, today, mode, types[], liveAllowed, shadowSpace, inWindow,
 *         trips{code:{active,session,vehicle_id}}, vehicles{vehicle_id:true},
 *         students{"adm|trip|session":{active,notify,gcm_reachable}} }
 *
 * Returns {ok:true, item} or {ok:false, outcome, reason}:
 *   outcome 'expire'   the row is past expires_at
 *   outcome 'suppress' the row can never pass (it will be marked suppressed with the reason)
 *   outcome 'wait'     the row may pass later (window, switches); it stays pending_feed
 * Permanent checks run first, the waiting ones last, so a row that can never
 * pass is not left sitting in the queue.
 */
function fdGuardRow_(row, ctx) {
  function no(outcome, reason) { return { ok: false, outcome: outcome, reason: reason }; }
  var type = fdStr_(row.event_type);
  var adm = fdStr_(row.admission_no);
  var run = fdStr_(row.trip_run_id);
  var session = fdStr_(row.session);

  var exp = fdToMs_(row.expires_at);
  if (exp == null) return no('suppress', 'no_expires_at');
  if (ctx.nowMs >= exp) return no('expire', 'expired_before_feed');

  // Project and template: the project is the constant, the type must be enabled and have a template.
  if (ctx.types.indexOf(type) < 0) return no('suppress', 'type_not_enabled');
  var spec = FD_TYPE_SPECS[type];
  if (!spec) return no('suppress', 'no_template');
  if (spec.sessions.indexOf(session) < 0) return no('suppress', 'session_not_for_type');

  // Row integrity: the keys must say what the columns say.
  if (!FD_ADMISSION_RE.test(adm)) return no('suppress', 'bad_admission_form');
  var rm = FD_RUN_RE.exec(run);
  if (!rm) return no('suppress', 'bad_trip_run_id');
  if (fdStr_(row.dedupe_key) !== run + '|' + adm + '|' + type) return no('suppress', 'bad_dedupe_key');
  var eid = fdStr_(row.event_id);
  if (!FD_EVENT_ID_RE.test(eid) || eid.indexOf(run + '|') !== 0 || eid.slice(-(type.length + 1)) !== '|' + type) {
    return no('suppress', 'bad_event_id');
  }

  // The run: today's, for a known active trip, with the trip's own session.
  if (rm[1] !== ctx.today || fdStr_(row.service_date) !== ctx.today) return no('suppress', 'run_not_today');
  var trip = ctx.trips[rm[2]];
  if (!trip) return no('suppress', 'trip_unknown');
  if (!trip.active) return no('suppress', 'trip_inactive');
  if (trip.session !== session) return no('suppress', 'session_mismatch');

  // The mode the row was created under must still be the mode.
  if (fdStr_(row.mode).toLowerCase() !== ctx.mode) return no('suppress', 'mode_changed');
  if (ctx.mode !== 'shadow_gcm' && ctx.mode !== 'live') return no('suppress', 'mode_not_feeding');

  // The student: an active, notify=Yes row for this trip and session (both feeding modes);
  // live also needs the nightly ROSTER check to have said Yes.
  var st = ctx.students[adm.toLowerCase() + '|' + rm[2] + '|' + session];
  if (!st || !st.active) return no('suppress', 'no_active_student_row');
  if (!st.notify) return no('suppress', 'notify_off');
  if (ctx.mode === 'live' && !st.gcm_reachable) return no('suppress', 'not_reachable_by_gcm');

  // Placeholder values, every one from an allow-list.
  if (!trip.vehicle_id || !ctx.vehicles[trip.vehicle_id]) return no('suppress', 'vehicle_unknown');
  var values = {}, order = [['Bus', 'bus', trip.vehicle_id], ['Session', 'session', session],
    ['Time', 'time', row.created_at], ['Date', 'date', rm[1]]];
  for (var i = 0; i < order.length; i++) {
    var v = fdValidValue_(order[i][1], order[i][2]);
    if (!v.ok) return no('suppress', v.reason);
    values[order[i][0]] = v.value;
  }

  // Things that may be true later: the send window and the two switches.
  if (!ctx.inWindow) return no('wait', 'outside_send_window');
  if (ctx.mode === 'shadow_gcm' && !FD_SPACE_RE.test(fdStr_(ctx.shadowSpace))) return no('wait', 'no_shadow_space');
  if (ctx.mode === 'live' && !ctx.liveAllowed) return no('wait', 'live_not_allowed');

  return { ok: true, item: {
    dedupe_key: fdStr_(row.dedupe_key), event_id: eid, trip_run_id: run, event_type: type,
    templateId: spec.templateId, admission: adm, values: values, _row: row._row
  } };
}

// ---- 6. Caps (R43) ----------------------------------------------------------

/**
 * Would this run break a cap? items = rows that passed the guard.
 *   queuedByRun   {trip_run_id: rows already queued for it}
 *   queuedToday   rows already queued today
 *   students      {"trip|session": active notify=Yes students}
 *   enabledTypes  number of enabled types that have a template
 *   dailyCap      gcm_feed_daily_cap
 * Cap 1 per trip run: students on the trip x enabled types. Cap 2: dailyCap a day.
 * Returns {tripped:false} or {tripped:true, reason} (reason holds counts only).
 */
function fdEvaluateCaps_(items, c) {
  var perRun = {};
  items.forEach(function (it) { perRun[it.trip_run_id] = (perRun[it.trip_run_id] || 0) + 1; });
  var runs = Object.keys(perRun);
  for (var i = 0; i < runs.length; i++) {
    var code = runs[i].split('|')[1];
    var students = 0;
    Object.keys(c.students || {}).forEach(function (k) { if (k.split('|')[0] === code) students += c.students[k]; });
    var cap = students * Math.max(0, c.enabledTypes);
    var total = perRun[runs[i]] + ((c.queuedByRun || {})[runs[i]] || 0);
    if (total > cap) {
      return { tripped: true, reason: 'trip run cap: ' + total + ' rows for trip ' + code + ' against a cap of ' + cap };
    }
  }
  var today = (c.queuedToday || 0) + items.length;
  if (today > c.dailyCap) {
    return { tripped: true, reason: 'daily cap: ' + today + ' rows today against gcm_feed_daily_cap ' + c.dailyCap };
  }
  return { tripped: false };
}

// ---- 7. OUTBOX rows ---------------------------------------------------------

/** What GCM resolves and hashes on, joined: ties a log row to its OUTBOX row (the OUTBOX has no row id). */
function fdOutboxKey_(recipient, templateId, valuesText) {
  return fdStr_(recipient) + '\n' + fdStr_(templateId) + '\n' + String(valuesText == null ? '' : valuesText);
}

/**
 * Items -> OUTBOX matrix in library header order. Shadow rows get a unique
 * `Shadow Ref` (counter + event id, no admission number); live rows have none,
 * so the optional template line disappears. Returns {rows, refs, seqNext}.
 * refs[i] is the match reference stored in gcm_result for item i.
 */
function fdBuildOutbox_(items, mode, shadowSpace, seq, nowMs) {
  var rows = [], refs = [], n = seq;
  items.forEach(function (it) {
    var values = {};
    Object.keys(it.values).forEach(function (k) { values[k] = it.values[k]; });
    var recipient;
    if (mode === 'shadow_gcm') {
      n++;
      recipient = shadowSpace;
      values['Shadow Ref'] = 'shadow ' + fdPad_(n, 5) + ' ' + it.event_id;
    } else {
      recipient = it.admission;
    }
    var json = JSON.stringify(values);
    rows.push([new Date(nowMs), FD_PROJECT_ID, recipient, it.templateId, json, '', 'READY', '', '']);
    refs.push(fdHash_(fdOutboxKey_(recipient, it.templateId, json)));
  });
  return { rows: rows, refs: refs, seqNext: n };
}

/**
 * Last look before the append (R37). shadow: every Recipient starts with
 * `spaces/` and all bodies' Shadow Refs differ. live: none starts with `spaces/`
 * and every one is an admission number. Throws, so nothing is written.
 */
function fdAssertOutbox_(rows, mode) {
  var seen = {};
  rows.forEach(function (r) {
    if (r[1] !== FD_PROJECT_ID) throw new Error('feed assertion: wrong project');
    if (r[6] !== 'READY' || r[5] !== '' || r[7] !== '' || r[8] !== '') throw new Error('feed assertion: row is not a fresh READY row');
    var rec = String(r[2]);
    if (mode === 'shadow_gcm') {
      if (!FD_SPACE_RE.test(rec)) throw new Error('feed assertion: shadow recipient is not a space');
      var ref = JSON.parse(r[4])['Shadow Ref'];
      if (!FD_SHADOW_REF_RE.test(String(ref)) || seen[ref]) throw new Error('feed assertion: shadow ref missing or repeated');
      seen[ref] = true;
    } else if (mode === 'live') {
      if (!FD_ADMISSION_RE.test(rec)) throw new Error('feed assertion: live recipient is not an admission number');
      if (JSON.parse(r[4])['Shadow Ref'] !== undefined) throw new Error('feed assertion: live row carries a shadow ref');
    } else {
      throw new Error('feed assertion: mode does not feed');
    }
  });
}

/** Does the live OUTBOX row 1 start with exactly the library headers? Returns {ok, message}. */
function fdCheckOutboxHeaders_(headerRow) {
  var have = (headerRow || []).map(function (h) { return String(h == null ? '' : h).trim(); });
  for (var i = 0; i < FD_OUTBOX_HEADERS.length; i++) {
    if (have[i] !== FD_OUTBOX_HEADERS[i]) {
      return { ok: false, message: 'OUTBOX header ' + (i + 1) + ' is "' + (have[i] || '') + '", expected "' + FD_OUTBOX_HEADERS[i] + '"' };
    }
  }
  return { ok: true, message: '' };
}

// ---- 8. Plan one feed run ---------------------------------------------------

function fdIndexStudents_(studentRows) {
  var idx = {}, counts = {};
  (studentRows || []).forEach(function (r) {
    var adm = fdStr_(r.admission_no).toLowerCase(), trip = fdStr_(r.trip_code), ses = fdStr_(r.session);
    if (!adm || !trip || !ses) return;
    var entry = { active: fdYes_(r.active), notify: fdYes_(r.notify), gcm_reachable: fdYes_(r.gcm_reachable) };
    idx[adm + '|' + trip + '|' + ses] = entry;
    if (entry.active && entry.notify) counts[trip + '|' + ses] = (counts[trip + '|' + ses] || 0) + 1;
  });
  return { index: idx, counts: counts };
}

/**
 * Everything the feeder decides in one run, from data already read.
 * input = { logRows, studentRows, tripRows, vehicleRows, settings (map), nowMs,
 *           shadowSpace, liveAllowed (Script Property text), windowText (GCM SEND_WINDOW),
 *           tripped (bool), feedBlock (reason text if the GCM side cannot be written), seq }
 * Returns { updates, outbox, refs, seqNext, trippedReason, decisions, counts, feeding, mode }.
 * updates = [{rowNum, set:{header:value}}]. decisions = [{row, reason}] for the log line.
 */
function fdPlanFeed_(input) {
  var s = fdReadSettings_(input.settings), nowMs = input.nowMs, today = fdDate_(nowMs);
  var plan = { updates: [], outbox: [], refs: [], seqNext: input.seq || 0, trippedReason: '', decisions: [],
    counts: { pending: 0, expired: 0, suppressed: 0, waiting: 0, queued: 0 }, feeding: false, mode: s.mode, notFeeding: '' };
  var pending = (input.logRows || []).filter(function (r) { return fdStr_(r.status) === 'pending_feed'; });
  plan.counts.pending = pending.length;

  // 1. Expiry first: a row past expires_at is never queued, whatever the mode or switches say (R39).
  var live = [];
  pending.forEach(function (r) {
    var exp = fdToMs_(r.expires_at);
    if (exp != null && nowMs >= exp) {
      plan.updates.push({ rowNum: r._row, set: { status: 'expired', suppressed_reason: 'expired_before_feed' } });
      plan.counts.expired++;
    } else live.push(r);
  });

  // 2. Is the feed allowed to run at all this minute?
  var block = '';
  if (s.mode !== 'shadow_gcm' && s.mode !== 'live') block = 'mode_' + s.mode;
  else if (input.tripped) block = 'guard_tripped';
  else if (s.projectId !== FD_PROJECT_ID) block = 'gcm_project_id_is_not_' + FD_PROJECT_ID;
  else if (input.feedBlock) block = input.feedBlock;
  if (block) { plan.notFeeding = block; return plan; }
  plan.feeding = true;

  // 3. The guard, row by row.
  var studs = fdIndexStudents_(input.studentRows);
  var trips = {};
  (input.tripRows || []).forEach(function (t) {
    var code = fdStr_(t.trip_code);
    if (code) trips[code] = { active: fdStr_(t.active).toLowerCase() !== 'no', session: fdStr_(t.session), vehicle_id: fdStr_(t.vehicle_id) };
  });
  var vehicles = {};
  (input.vehicleRows || []).forEach(function (v) { var id = fdStr_(v.vehicle_id); if (id) vehicles[id] = true; });
  var win = fdParseWindow_(input.windowText);
  var ctx = { nowMs: nowMs, today: today, mode: s.mode, types: s.types, liveAllowed: fdYes_(input.liveAllowed),
    shadowSpace: fdStr_(input.shadowSpace), inWindow: fdInWindow_(nowMs, win), trips: trips, vehicles: vehicles,
    students: studs.index };

  var taken = {}, queuedByRun = {}, queuedToday = 0;
  (input.logRows || []).forEach(function (r) {
    var key = fdStr_(r.dedupe_key);
    if (fdStr_(r.status) !== 'pending_feed' && key) taken[key] = true;
    if (fdStr_(r.gcm_queued_at) !== '') {
      var run = fdStr_(r.trip_run_id);
      queuedByRun[run] = (queuedByRun[run] || 0) + 1;
      if (fdCellStamp_(r.gcm_queued_at).slice(0, 10) === today) queuedToday++;
    }
  });

  var eligible = [];
  live.forEach(function (r) {
    var key = fdStr_(r.dedupe_key);
    var res;
    if (key && taken[key]) res = { ok: false, outcome: 'suppress', reason: 'duplicate_dedupe_key' };
    else res = fdGuardRow_(r, ctx);
    if (res.ok) { taken[key] = true; eligible.push(res.item); return; }
    plan.decisions.push({ row: r._row, reason: res.reason });
    if (res.outcome === 'wait') { plan.counts.waiting++; return; }
    plan.updates.push({ rowNum: r._row, set: { status: 'suppressed', suppressed_reason: 'feed_guard:' + res.reason } });
    plan.counts.suppressed++;
  });

  // 4. Caps. A broken cap queues nothing at all.
  var enabled = s.types.filter(function (t) { return !!FD_TYPE_SPECS[t]; }).length;
  var cap = fdEvaluateCaps_(eligible, { queuedByRun: queuedByRun, queuedToday: queuedToday,
    students: studs.counts, enabledTypes: enabled, dailyCap: s.dailyCap });
  if (cap.tripped) { plan.trippedReason = cap.reason; return plan; }
  if (!eligible.length) return plan;

  // 5. Build and check the OUTBOX rows, then the log marks.
  var built = fdBuildOutbox_(eligible, s.mode, ctx.shadowSpace, input.seq || 0, nowMs);
  fdAssertOutbox_(built.rows, s.mode);
  plan.outbox = built.rows; plan.refs = built.refs; plan.seqNext = built.seqNext;
  eligible.forEach(function (it, i) {
    plan.updates.push({ rowNum: it._row, set: { status: 'queued_gcm', gcm_queued_at: fdStamp_(nowMs),
      gcm_status: 'READY', gcm_result: 'ref:' + built.refs[i] } });
  });
  plan.counts.queued = eligible.length;
  return plan;
}

// ---- 9. Reconcile -----------------------------------------------------------

/** gcm_result -> {ref, hash}. */
function fdParseResult_(text) {
  var s = String(text == null ? '' : text), r = /ref:([0-9a-f]{14})/.exec(s), h = /hash:([0-9a-f]{32})/.exec(s);
  return { ref: r ? r[1] : '', hash: h ? h[1] : '' };
}

function fdResultText_(ref, hash, note) {
  return 'ref:' + ref + (hash ? ';hash:' + hash : '') + ';' + String(note || '').replace(/[\r\n;]+/g, ' ').slice(0, 200);
}

/** OUTBOX rows (objects keyed by header) -> {ref: row}. The first row with a ref wins. */
function fdIndexOutbox_(outboxRows) {
  var idx = {};
  (outboxRows || []).forEach(function (r) {
    if (fdStr_(r['Project ID']) !== FD_PROJECT_ID) return;
    var ref = fdHash_(fdOutboxKey_(r['Recipient'], r['Template ID'], r['Values (JSON)']));
    if (!idx[ref]) idx[ref] = r;
  });
  return idx;
}

/** GCM OUTBOX status -> log status. READY and unknown values mean "still queued" (null). */
function fdMapOutboxStatus_(st) {
  switch (fdStr_(st).toUpperCase()) {
    case 'SENT': return 'sent';
    case 'SKIPPED': return 'skipped';
    case 'CANCELLED': return 'skipped';
    case 'ERROR': return 'failed';
    case 'FAILED': return 'failed';
  }
  return null;
}

/**
 * Copy back the status of rows queued earlier. queuedRows = log rows with
 * status queued_gcm. Rows only move forward: READY stays queued_gcm.
 * Returns {updates, terminal:[{row, trip_run_id, status}]}.
 * A queued row GCM cannot show after FD_MISSING_AFTER_MS becomes failed (MISSING).
 */
function fdReconcileOutbox_(queuedRows, outboxIndex, nowMs) {
  var updates = [], terminal = [];
  (queuedRows || []).forEach(function (r) {
    var parsed = fdParseResult_(r.gcm_result);
    var ob = parsed.ref ? outboxIndex[parsed.ref] : null;
    var queuedMs = fdCellMs_(r.gcm_queued_at);
    if (!ob) {
      if (queuedMs != null && nowMs - queuedMs > FD_MISSING_AFTER_MS) {
        updates.push({ rowNum: r._row, set: { status: 'failed', gcm_status: 'MISSING',
          gcm_result: fdResultText_(parsed.ref, '', 'not found in OUTBOX after ' + Math.round((nowMs - queuedMs) / 60000) + ' min') } });
        terminal.push({ row: r._row, trip_run_id: fdStr_(r.trip_run_id), status: 'failed' });
      }
      return;
    }
    var gst = fdStr_(ob['Status']).toUpperCase();
    var mapped = fdMapOutboxStatus_(gst);
    var hash = fdStr_(ob['Hash']);
    if (!mapped) {
      if (fdStr_(r.gcm_status) !== gst && gst) updates.push({ rowNum: r._row, set: { gcm_status: gst } });
      return;
    }
    var set = { status: mapped, gcm_status: gst,
      gcm_result: fdResultText_(parsed.ref, /^[0-9a-f]{32}$/.test(hash) ? hash : '',
        mapped === 'sent' ? 'sent (seen in OUTBOX; time refined from MESSAGE LOG nightly)' : fdStr_(ob['Result'])) };
    if (mapped === 'sent') {
      set.gcm_sent_at = fdStamp_(nowMs);
      if (queuedMs != null) set.latency_s = Math.max(0, Math.round((nowMs - queuedMs) / 1000));
    }
    updates.push({ rowNum: r._row, set: set });
    if (mapped !== 'sent') terminal.push({ row: r._row, trip_run_id: fdStr_(r.trip_run_id), status: mapped });
  });
  return { updates: updates, terminal: terminal };
}

/**
 * Nightly: tighten the time and status from MESSAGE LOG. rows = log rows that are
 * `sent` with a hash and the "seen in OUTBOX" note. logEntries = MESSAGE LOG
 * rows as objects keyed by header ('Timestamp','Status','Hash'). GCM's own log
 * time is the true send time, and the status there is authoritative.
 */
function fdReconcileMessageLog_(rows, logEntries) {
  var byHash = {};
  (logEntries || []).forEach(function (e) {
    var h = fdStr_(e['Hash']); if (!h) return;
    (byHash[h] = byHash[h] || []).push({ ms: fdCellMs_(e['Timestamp']), status: fdStr_(e['Status']).toUpperCase() });
  });
  var updates = [], terminal = [];
  (rows || []).forEach(function (r) {
    var parsed = fdParseResult_(r.gcm_result);
    if (!parsed.hash || !byHash[parsed.hash]) return;
    var queuedMs = fdCellMs_(r.gcm_queued_at);
    var cands = byHash[parsed.hash].filter(function (e) { return e.ms != null && (queuedMs == null || e.ms >= queuedMs - 60000); })
      .sort(function (a, b) { return a.ms - b.ms; });
    if (!cands.length) return;
    var e = cands[0];
    var mapped = e.status === 'SENT' ? 'sent' : e.status === 'SKIPPED' ? 'skipped' : e.status === 'FAILED' ? 'failed' : null;
    if (!mapped) return;
    var set = { status: mapped, gcm_status: e.status, gcm_sent_at: fdStamp_(e.ms),
      gcm_result: fdResultText_(parsed.ref, parsed.hash, 'confirmed in MESSAGE LOG') };
    if (queuedMs != null) set.latency_s = Math.max(0, Math.round((e.ms - queuedMs) / 1000));
    if (mapped !== 'sent') delete set.latency_s;
    updates.push({ rowNum: r._row, set: set });
    if (mapped !== 'sent') terminal.push({ row: r._row, trip_run_id: fdStr_(r.trip_run_id), status: mapped });
  });
  return { updates: updates, terminal: terminal };
}

/** Terminal rows -> one alert per trip run not alerted before. alerted = {run: true}. Counts only, no student data. */
function fdPlanFailureAlerts_(terminal, alerted) {
  var byRun = {};
  (terminal || []).forEach(function (t) {
    if (!t.trip_run_id || (alerted || {})[t.trip_run_id]) return;
    var o = byRun[t.trip_run_id] = byRun[t.trip_run_id] || { skipped: 0, failed: 0 };
    o[t.status === 'failed' ? 'failed' : 'skipped']++;
  });
  return Object.keys(byRun).sort().map(function (run) {
    var o = byRun[run];
    return { run: run, text: 'GCM did not deliver every bus message for trip run ' + run + ': ' +
      o.skipped + ' skipped, ' + o.failed + ' failed. See Parent_Notify_Log (gcm_status, gcm_result) and the GCM OUTBOX.' };
  });
}

// ---- 10. ROSTER pre-check ---------------------------------------------------

/**
 * Student_Trip_Stops rows x ROSTER rows -> updates for gcm_reachable.
 * Reachable = the admission number is on ROSTER and is not marked LEFT: the
 * same test the library's strict ADMISSION_NO mode applies (05_Resolve.gs).
 * SUPPRESSION is not read (the feeder does not open that tab), so a suppressed
 * student still shows Yes here and is skipped by GCM with a stated reason.
 * rosterRows are objects keyed by lower-cased header ('admission no', 'status').
 */
function fdPlanReachability_(studentRows, rosterRows) {
  var roster = {};
  (rosterRows || []).forEach(function (r) {
    var a = fdStr_(r['admission no']).toLowerCase();
    if (a) roster[a] = fdStr_(r['status']).toUpperCase();
  });
  var updates = [], yes = 0, no = 0;
  (studentRows || []).forEach(function (r) {
    var a = fdStr_(r.admission_no).toLowerCase();
    if (!a) return;
    var ok = Object.prototype.hasOwnProperty.call(roster, a) && roster[a] !== 'LEFT';
    ok ? yes++ : no++;
    var want = ok ? 'Yes' : 'No';
    if (fdStr_(r.gcm_reachable) !== want) updates.push({ rowNum: r._row, set: { gcm_reachable: want } });
  });
  return { updates: updates, yes: yes, no: no };
}

// ---- 11. Applying updates to a sheet's values -------------------------------

/**
 * Turn row updates into the fewest writes: one block per touched column,
 * covering only the rows between the first and last touched cell of that
 * column, with the other cells in the block carrying their current values.
 * values = 2D sheet values (row 0 = headers). Returns [{col (1-based), row, values}].
 * Throws if a header is missing, so a renamed column fails loudly.
 */
function fdColumnWrites_(values, updates) {
  var idx = fdHeaderIndex_(values[0]);
  var touched = {};
  updates.forEach(function (u) {
    Object.keys(u.set).forEach(function (h) {
      if (idx[h] === undefined) throw new Error('sheet header missing: ' + h);
      var t = touched[h] = touched[h] || { min: u.rowNum, max: u.rowNum, cells: {} };
      t.min = Math.min(t.min, u.rowNum); t.max = Math.max(t.max, u.rowNum);
      t.cells[u.rowNum] = u.set[h];
    });
  });
  return Object.keys(touched).map(function (h) {
    var t = touched[h], col = idx[h], block = [];
    for (var r = t.min; r <= t.max; r++) {
      block.push([Object.prototype.hasOwnProperty.call(t.cells, r) ? t.cells[r] : (values[r - 1] && values[r - 1][col] !== undefined ? values[r - 1][col] : '')]);
    }
    return { col: col + 1, row: t.min, values: block };
  });
}
