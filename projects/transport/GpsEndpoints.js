/**
 * GpsEndpoints.js — server functions behind the Live buses view
 * (PRD rev 4 R13–R18, R20, R21; tickets T8, T9, T10).
 *
 * Every public function starts with gpsRequire_('view' | 'manage') (R14). On a
 * refusal it returns exactly {ok:false, error} and has read no Worker data, no
 * coordinates and no student data. Identity is the signed-in address only (R41);
 * the admin PIN never satisfies these checks.
 *
 *   getGpsLive()                 view    buses, status, next stop, "Data as of"
 *   getGpsTrack(vehicle, date)   view    path with >2 min gaps as dashed segments + stop geofences
 *   getGpsDaily(date)            view    per-vehicle/trip daily rollup from the Worker
 *   getNotifyLog(date)           manage  Parent_Notify_Log rows, admission numbers left out
 *   gpsPushConfig()              manage  R20
 *   gpsIssueToken(deviceId)      manage  R21 (returns the link once)
 *   gpsRevokeToken(deviceId)     manage
 *
 * Layout: 1. constants  2. pure logic (unit-tested)  3. Apps Script glue.
 * Functions ending in "_" cannot be called from google.script.run.
 */

// ---- 1. Constants ----------------------------------------------------------

const GPS_LATEST_FRESH_KEY = 'gps_latest_fresh_v1';
const GPS_LATEST_LAST_KEY = 'gps_latest_last_v1';
const GPS_FLEET_CFG_KEY = 'gps_fleet_cfg_v1';
/** R17: /v1/latest is cached this long. */
const GPS_LATEST_TTL_S = 20;
/** Last good copy kept for the Worker-down fallback (R13). Script cache maximum is 6 h. */
const GPS_LAST_GOOD_TTL_S = 21600;
const GPS_FLEET_CFG_TTL_S = 300;
/** After a failed Worker call, serve the last-good copy for this long before trying again. */
const GPS_DOWN_BACKOFF_S = 10;
/** One access-log row per viewer per view per this many seconds (auto-refresh is not a new view). */
const GPS_ACCESS_LOG_THROTTLE_S = 300;
/** R16: a gap longer than this is drawn dashed. */
const GPS_TRACK_GAP_MS = 2 * 60 * 1000;
const GPS_CACHE_MAX_CHARS = 90000;
const GPS_NOTIFY_LOG_LIMIT = 200;
const GPS_IST_OFFSET_MS = 330 * 60000;

const GPS_STATE_ORDER = { 'Error': 0, 'Stale': 1, 'Pending': 2, 'Live': 3, 'Off duty': 4 };

const GPS_VEHICLE_ID_RE = /^[A-Za-z0-9._-]{1,64}$/;
const GPS_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ---- 2. Pure logic ---------------------------------------------------------

function gpsPad2_(n) { return ('0' + n).slice(-2); }

/** Epoch ms -> "HH:mm" in Asia/Kolkata (fixed +05:30, no DST). '' if not a number. */
function gpsFormatHm_(ms) {
  if (!isFinite(ms) || ms === null || ms === '') return '';
  var d = new Date(Number(ms) + GPS_IST_OFFSET_MS);
  return gpsPad2_(d.getUTCHours()) + ':' + gpsPad2_(d.getUTCMinutes());
}

/** Epoch ms -> "yyyy-MM-dd" in Asia/Kolkata. */
function gpsServiceDate_(ms) {
  var d = new Date(Number(ms) + GPS_IST_OFFSET_MS);
  return d.getUTCFullYear() + '-' + gpsPad2_(d.getUTCMonth() + 1) + '-' + gpsPad2_(d.getUTCDate());
}

function gpsMinuteOfDay_(ms) {
  var d = new Date(Number(ms) + GPS_IST_OFFSET_MS);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

/** "07:30" or "7:30:00" -> minutes, else null. */
function gpsParseHm_(s) {
  var m = /^\s*(\d{1,2}):(\d{2})(?::\d{2})?\s*$/.exec(String(s == null ? '' : s));
  if (!m) return null;
  var h = Number(m[1]), mi = Number(m[2]);
  return h < 24 && mi < 60 ? h * 60 + mi : null;
}

/** The vehicle's active trip whose window (plus grace minutes) holds minuteOfDay; earliest start wins. */
function gpsPickTrip_(trips, vehicleId, minuteOfDay, graceMin) {
  var best = null, bestStart = 0;
  (trips || []).forEach(function (t) {
    if (gpsStr_(t.vehicle_id) !== vehicleId || gpsIsOff_(t.active)) return;
    var s = gpsParseHm_(t.window_start), e = gpsParseHm_(t.window_end);
    if (s === null || e === null) return;
    var span = ((e - s + 1440) % 1440) + 2 * graceMin;
    var offset = (minuteOfDay - (s - graceMin) + 2880) % 1440;
    if (span >= 1440 || offset <= span) {
      if (best === null || s < bestStart) { best = t; bestStart = s; }
    }
  });
  return best;
}

/** Ordered stops of a trip joined to their coordinates: [{stop_id, stop_name, lat, lon, radius_m, sequence}]. */
function gpsTripStopList_(tripCode, tripStops, stopsById) {
  var rows = (tripStops || []).filter(function (r) { return gpsStr_(r.trip_code) === tripCode; });
  rows.sort(function (a, b) { return (Number(a.sequence) || 0) - (Number(b.sequence) || 0); });
  var out = [];
  rows.forEach(function (r) {
    var s = stopsById[gpsStr_(r.stop_id)];
    if (!s) return;
    var lat = parseFloat(s.lat), lon = parseFloat(s.lon);
    if (!isFinite(lat) || !isFinite(lon) || gpsStr_(s.lat) === '' || gpsStr_(s.lon) === '') return;
    out.push({ stop_id: gpsStr_(s.stop_id), stop_name: gpsStr_(s.stop_name) || gpsStr_(s.stop_id),
               lat: lat, lon: lon, radius_m: gpsNumOrNull_(s.radius_m), sequence: Number(r.sequence) || 0 });
  });
  return out;
}

/**
 * Approximate next stop: the nearest stop of the trip, or the one after it when the
 * bus is already inside that stop's radius. This is a position heuristic, not the
 * Worker's engine (which does not expose it), so the page labels it "about".
 * ETA is straight-line distance x road factor at the bus's speed, floored at 20 km/h
 * so a stopped bus does not show hours. Returns null with no stops or no position.
 */
function gpsNextStop_(stopList, lat, lon, speedKmh, roadFactor) {
  if (!stopList || !stopList.length || !isFinite(lat) || !isFinite(lon) || lat === null || lon === null) return null;
  var bi = 0, bd = Infinity;
  stopList.forEach(function (s, i) {
    var d = gpsDistanceKm_(lat, lon, s.lat, s.lon);
    if (d < bd) { bd = d; bi = i; }
  });
  var radiusKm = ((stopList[bi].radius_m || 100)) / 1000;
  var idx = (bd <= radiusKm && bi + 1 < stopList.length) ? bi + 1 : bi;
  var target = stopList[idx];
  var dist = gpsDistanceKm_(lat, lon, target.lat, target.lon);
  var rf = isFinite(roadFactor) && roadFactor > 0 ? roadFactor : 1.3;
  var v = Math.max(20, Number(speedKmh) || 0);
  var eta = Math.max(1, Math.round(dist * rf / v * 60));
  return { stop_id: target.stop_id, stop_name: target.stop_name, eta_min: eta };
}

/** Sort buses Error, Stale, Pending, Live, Off duty, then by vehicle id. */
function gpsSortBuses_(buses) {
  function rank(b) { var r = GPS_STATE_ORDER[b.state]; return r === undefined ? 2 : r; }
  return buses.slice().sort(function (a, b) {
    return (rank(a) - rank(b)) || String(a.vehicle_id).localeCompare(String(b.vehicle_id));
  });
}

/**
 * Track points -> drawable segments. points = [{t, la, lo}] in time order. A gap
 * longer than gapMs between two fixes becomes ONE dashed segment joining them;
 * the runs either side are solid. Points with no usable position are skipped.
 */
function gpsBuildSegments_(points, gapMs) {
  var segs = [], run = [], prev = null;
  function closeRun() { if (run.length >= 2) segs.push({ dashed: false, pts: run }); run = []; }
  (points || []).forEach(function (p) {
    var la = Number(p.la), lo = Number(p.lo), t = Number(p.t);
    if (!isFinite(la) || !isFinite(lo) || p.la === null || p.lo === null) return;
    var pt = [la, lo];
    if (prev && isFinite(t) && isFinite(prev.t) && t - prev.t > gapMs) {
      closeRun();
      segs.push({ dashed: true, pts: [prev.pt, pt] });
      run = [pt];
    } else {
      run.push(pt);
    }
    prev = { t: t, pt: pt };
  });
  closeRun();
  return segs;
}

/**
 * Banner for the live view, or null. Worker down is red; any Error/Stale bus is amber;
 * data older than staleMin is grey. Text always says what and when, never colour alone.
 */
function gpsLiveBanner_(down, dataAsOfMs, buses, nowMs, staleMin) {
  var asOf = dataAsOfMs ? gpsFormatHm_(dataAsOfMs) : '';
  if (down) {
    return { level: 'red', text: 'Cannot reach the tracking service. ' + (asOf ? 'Showing the last data, as of ' + asOf + '.' : 'No earlier data is available.') };
  }
  var bad = buses.filter(function (b) { return b.state === 'Error' || b.state === 'Stale'; }).length;
  if (bad) return { level: 'amber', text: bad + (bad === 1 ? ' bus needs' : ' buses need') + ' attention (Error or Stale).' };
  if (dataAsOfMs && nowMs - dataAsOfMs > staleMin * 60000) {
    return { level: 'grey', text: 'No new locations since ' + asOf + '.' };
  }
  return null;
}

function gpsClampStr_(v, n) { return gpsStr_(v).slice(0, n); }

/** Notify-log row for the screen: no admission number, no student data. */
function gpsNotifyRowForView_(r) {
  return {
    created_at: gpsClampStr_(r.created_at, 32), service_date: gpsClampStr_(r.service_date, 10),
    trip_run_id: gpsClampStr_(r.trip_run_id, 64), session: gpsClampStr_(r.session, 32),
    event_type: gpsClampStr_(r.event_type, 48), stop_id: gpsClampStr_(r.stop_id, 64),
    eta_minutes: r.eta_minutes === '' ? '' : r.eta_minutes, mode: gpsClampStr_(r.mode, 24),
    status: gpsClampStr_(r.status, 24), suppressed_reason: gpsClampStr_(r.suppressed_reason, 120)
  };
}

// ---- 3. Apps Script glue ---------------------------------------------------

function gpsRefusal_(auth) { return { ok: false, error: String(auth.error || 'You do not have access to this.') }; }

/** Cache helpers that never throw: a failed cache write must not break a view. */
function gpsCacheGet_(key) {
  try { var v = CacheService.getScriptCache().get(key); return v ? JSON.parse(v) : null; } catch (e) { return null; }
}
function gpsCachePut_(key, obj, ttl) {
  try {
    var s = JSON.stringify(obj);
    if (s.length > GPS_CACHE_MAX_CHARS) return false;
    CacheService.getScriptCache().put(key, s, ttl);
    return true;
  } catch (e) { return false; }
}

/**
 * Read from the Worker with a short fresh cache and a long last-good copy.
 * Returns {body, down, fromCache}. body is null only when the Worker is down and
 * nothing was ever cached. `shrink(body)` may reduce a body before it is cached.
 */
function gpsWorkerRead_(path, query, keyBase, shrink) {
  var fresh = gpsCacheGet_(keyBase + '_f');
  if (fresh) return { body: fresh, down: false, fromCache: true };
  if (gpsCacheGet_(keyBase + '_d')) return { body: gpsCacheGet_(keyBase + '_l'), down: true, fromCache: true };
  var res = gpsWorkerCall_('read', 'GET', path, query);
  if (res.ok) {
    var body = shrink ? shrink(res.json) : res.json;
    gpsCachePut_(keyBase + '_f', body, GPS_LATEST_TTL_S);
    gpsCachePut_(keyBase + '_l', body, GPS_LAST_GOOD_TTL_S);
    return { body: body, down: false, fromCache: false };
  }
  gpsCachePut_(keyBase + '_d', 1, GPS_DOWN_BACKOFF_S); // do not hammer a Worker that just failed
  return { body: gpsCacheGet_(keyBase + '_l'), down: true, fromCache: true };
}

/** Settings + trips + stops + trip stops, read by header name once and cached 5 min. */
function gpsLoadFleetConfig_() {
  var hit = gpsCacheGet_(GPS_FLEET_CFG_KEY);
  if (hit) return hit;
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var cfg = { settings: {}, trips: [], stops: [], tripStops: [] };
  gpsReadTab_(ss, GPS_SETTINGS_TAB).forEach(function (r) {
    var k = gpsStr_(r.setting);
    if (k.indexOf('gps_') === 0 || k === 'eta_road_factor') cfg.settings[k] = gpsStr_(r.value);
  });
  cfg.trips = gpsReadTab_(ss, GPS_SHEETS.TRIPS).map(function (r) {
    return { trip_code: gpsStr_(r.trip_code), session: gpsStr_(r.session), vehicle_id: gpsStr_(r.vehicle_id),
             window_start: gpsStr_(r.window_start), window_end: gpsStr_(r.window_end), active: gpsStr_(r.active) };
  });
  cfg.stops = gpsReadTab_(ss, GPS_SHEETS.STOPS).map(function (r) {
    return { stop_id: gpsStr_(r.stop_id), stop_name: gpsStr_(r.stop_name), lat: gpsStr_(r.lat), lon: gpsStr_(r.lon),
             radius_m: gpsStr_(r.radius_m), kind: gpsStr_(r.kind), active: gpsStr_(r.active) };
  });
  cfg.tripStops = gpsReadTab_(ss, GPS_SHEETS.TRIP_STOPS).map(function (r) {
    return { trip_code: gpsStr_(r.trip_code), sequence: gpsStr_(r.sequence), stop_id: gpsStr_(r.stop_id) };
  });
  gpsCachePut_(GPS_FLEET_CFG_KEY, cfg, GPS_FLEET_CFG_TTL_S);
  return cfg;
}

function gpsStopsById_(cfg) {
  var m = {};
  cfg.stops.forEach(function (s) { if (s.stop_id && !gpsIsOff_(s.active)) m[s.stop_id] = s; });
  return m;
}

/**
 * R18: one GPS_Access_Log row for this view, throttled to one per viewer per view per
 * 5 min so the 30 s auto-refresh is not logged as a new view each time. Returns false
 * if the row could not be written; callers then refuse, so no view goes unrecorded.
 */
function gpsAudit_(email, view) {
  var key = 'gps_alog_' + gpsNormEmail_(email) + '|' + view;
  try { if (CacheService.getScriptCache().get(key)) return true; } catch (e) { /* log anyway */ }
  if (!gpsLogAccess_(email, view)) return false;
  try { CacheService.getScriptCache().put(key, '1', GPS_ACCESS_LOG_THROTTLE_S); } catch (e) { /* fine */ }
  return true;
}

/**
 * Gate shared by the three viewing functions and the log: R14 role check, then the
 * gps_enabled switch, then the audit row. Returns {ok:true, email, cfg} or a refusal.
 */
function gpsOpenView_(role, view) {
  var auth = gpsRequire_(role);
  if (!auth.ok) return gpsRefusal_(auth);
  var cfg;
  try { cfg = gpsLoadFleetConfig_(); }
  catch (e) { return { ok: false, error: 'The GPS tabs are not set up yet.' }; }
  if (gpsIsOff_(cfg.settings.gps_enabled) || gpsStr_(cfg.settings.gps_enabled) === '') {
    return { ok: false, error: 'Live buses is switched off.' };
  }
  if (!gpsAudit_(auth.email, view)) return { ok: false, error: 'Could not record this view. Please try again.' };
  return { ok: true, email: auth.email, role: auth.role, cfg: cfg };
}

/** R13, R15, R17, R18. */
function getGpsLive() {
  var g = gpsOpenView_('view', 'live');
  if (!g.ok) return g;
  var cfg = g.cfg;
  var nowMs = Date.now();
  var r = gpsWorkerRead_('/v1/latest', null, 'gps_latest', null);
  var body = r.body || { buses: [], data_as_of: null };
  var stopsById = gpsStopsById_(cfg);
  var grace = Number(cfg.settings.gps_window_grace_min);
  if (!isFinite(grace) || grace < 0) grace = 15;
  var staleMin = Number(cfg.settings.gps_stale_minutes);
  if (!isFinite(staleMin) || staleMin <= 0) staleMin = 5;
  var roadFactor = parseFloat(cfg.settings.eta_road_factor);
  var minute = gpsMinuteOfDay_(nowMs);

  var buses = (body.buses || []).map(function (b) {
    var st = b.status || {};
    var trip = gpsPickTrip_(cfg.trips, gpsStr_(b.vehicle_id), minute, grace);
    var next = null;
    if (trip) {
      next = gpsNextStop_(gpsTripStopList_(trip.trip_code, cfg.tripStops, stopsById),
        b.lat === null ? NaN : Number(b.lat), b.lon === null ? NaN : Number(b.lon), b.speed_kmh, roadFactor);
    }
    return {
      vehicle_id: gpsStr_(b.vehicle_id),
      state: GPS_STATE_ORDER[st.state] === undefined ? 'Pending' : st.state,
      icon: st.icon || '', status_text: st.text || '',
      fix_ts: b.fix_ts === undefined ? null : b.fix_ts,
      last_seen: gpsFormatHm_(b.fix_ts), late: b.late === true,
      speed_kmh: b.speed_kmh === undefined ? null : b.speed_kmh,
      battery_pct: b.battery_pct === undefined ? null : b.battery_pct,
      lat: b.lat === undefined ? null : b.lat, lon: b.lon === undefined ? null : b.lon,
      trip_code: trip ? trip.trip_code : '', session: trip ? trip.session : '',
      next_stop: next
    };
  });
  buses = gpsSortBuses_(buses);
  return {
    ok: true, role: g.role, down: r.down,
    data_as_of: body.data_as_of === undefined ? null : body.data_as_of,
    data_as_of_text: body.data_as_of ? gpsFormatHm_(body.data_as_of) : '',
    banner: gpsLiveBanner_(r.down, body.data_as_of, buses, nowMs, staleMin),
    buses: buses
  };
}

/** R16: today's (or a chosen day's) path with dashed gaps, plus the vehicle's stop geofences. */
function getGpsTrack(vehicleId, date) {
  var vid = gpsStr_(vehicleId);
  var day = gpsStr_(date) || gpsServiceDate_(Date.now());
  var g = gpsOpenView_('view', 'track:' + (GPS_VEHICLE_ID_RE.test(vid) ? vid : '?') + ':' + (GPS_DATE_RE.test(day) ? day : '?'));
  if (!g.ok) return g;
  if (!GPS_VEHICLE_ID_RE.test(vid) || !GPS_DATE_RE.test(day)) return { ok: false, error: 'That vehicle or date is not valid.' };
  var r = gpsWorkerRead_('/v1/track', { vehicle_id: vid, date: day }, 'gps_trk_' + vid + '_' + day, function (b) {
    // Keep only what the map needs so a full day stays under the cache limit.
    return { data_as_of: b.data_as_of === undefined ? null : b.data_as_of,
             points: (b.points || []).map(function (p) { return { t: p.fix_ts, la: p.lat, lo: p.lon }; }) };
  });
  var body = r.body || { points: [], data_as_of: null };
  var cfg = g.cfg, stopsById = gpsStopsById_(cfg);
  var seen = {}, stops = [];
  cfg.trips.forEach(function (t) {
    if (t.vehicle_id !== vid || gpsIsOff_(t.active)) return;
    gpsTripStopList_(t.trip_code, cfg.tripStops, stopsById).forEach(function (s) {
      if (seen[s.stop_id]) return;
      seen[s.stop_id] = true;
      stops.push({ stop_id: s.stop_id, stop_name: s.stop_name, lat: s.lat, lon: s.lon, radius_m: s.radius_m });
    });
  });
  var nowMs = Date.now();
  return {
    ok: true, down: r.down, vehicle_id: vid, date: day,
    data_as_of: body.data_as_of === undefined ? null : body.data_as_of,
    data_as_of_text: body.data_as_of ? gpsFormatHm_(body.data_as_of) : '',
    banner: r.down ? gpsLiveBanner_(true, body.data_as_of, [], nowMs, 5) : null,
    segments: gpsBuildSegments_(body.points || [], GPS_TRACK_GAP_MS),
    stops: stops
  };
}

/** Daily rollup from the Worker for one service date. */
function getGpsDaily(date) {
  var day = gpsStr_(date) || gpsServiceDate_(Date.now());
  var g = gpsOpenView_('view', 'daily:' + (GPS_DATE_RE.test(day) ? day : '?'));
  if (!g.ok) return g;
  if (!GPS_DATE_RE.test(day)) return { ok: false, error: 'That date is not valid.' };
  var r = gpsWorkerRead_('/v1/daily', { date: day }, 'gps_dly_' + day, null);
  var body = r.body || { rows: [], data_as_of: null };
  return {
    ok: true, down: r.down, date: day,
    data_as_of: body.data_as_of === undefined ? null : body.data_as_of,
    data_as_of_text: body.data_as_of ? gpsFormatHm_(body.data_as_of) : '',
    banner: r.down ? gpsLiveBanner_(true, body.data_as_of, [], Date.now(), 5) : null,
    rows: (body.rows || []).map(function (x) {
      return { vehicle_id: x.vehicle_id, trip_code: x.trip_code, session: x.session, pings: x.pings,
               late_pings: x.late_pings, first_fix_at: gpsFormatHm_(x.first_fix_ts), last_fix_at: gpsFormatHm_(x.last_fix_ts),
               summary: x.summary === undefined ? null : x.summary };
    })
  };
}

/**
 * Parent_Notify_Log rows for a date, newest first. Manage only: it is a log of what
 * was sent about named children. admission_no is never returned.
 */
function getNotifyLog(date) {
  var day = gpsStr_(date) || gpsServiceDate_(Date.now());
  var g = gpsOpenView_('manage', 'notify_log:' + (GPS_DATE_RE.test(day) ? day : '?'));
  if (!g.ok) return g;
  if (!GPS_DATE_RE.test(day)) return { ok: false, error: 'That date is not valid.' };
  var rows;
  try { rows = gpsReadTab_(SpreadsheetApp.getActiveSpreadsheet(), GPS_SHEETS.NOTIFY_LOG); }
  catch (e) { return { ok: false, error: 'The notification log is not set up yet.' }; }
  rows = rows.filter(function (r) { return gpsStr_(r.service_date) === day; })
    .sort(function (a, b) { return gpsStr_(b.created_at) < gpsStr_(a.created_at) ? -1 : gpsStr_(b.created_at) > gpsStr_(a.created_at) ? 1 : 0; });
  var total = rows.length;
  return { ok: true, date: day, total: total, shown: Math.min(total, GPS_NOTIFY_LOG_LIMIT),
           rows: rows.slice(0, GPS_NOTIFY_LOG_LIMIT).map(gpsNotifyRowForView_) };
}

// ---- Manage-only functions (R14, R20, R21) ---------------------------------

function gpsPushConfig() {
  var auth = gpsRequire_('manage');
  if (!auth.ok) return gpsRefusal_(auth);
  return gpsPushConfigCore_();
}

/** Returns the device link ONCE in the response. It is not cached, stored or logged. */
function gpsIssueToken(deviceId) {
  var auth = gpsRequire_('manage');
  if (!auth.ok) return gpsRefusal_(auth);
  return gpsIssueTokenCore_(deviceId, auth.email);
}

function gpsRevokeToken(deviceId) {
  var auth = gpsRequire_('manage');
  if (!auth.ok) return gpsRefusal_(auth);
  return gpsRevokeTokenCore_(deviceId, auth.email);
}
