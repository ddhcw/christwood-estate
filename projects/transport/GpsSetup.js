/**
 * GpsSetup.js — sheet layer for live bus GPS (PRD rev 4 §7.2, R19, R26–R29).
 *
 * Adds the GPS tabs and Settings keys. Safe to run any number of times: it only
 * adds what is missing and never rewrites or deletes data a person has entered.
 * Existing tabs are not touched; the only existing tab it writes to is
 * Settings, and only to append keys that are not already there.
 *
 * Layout of this file:
 *   1. Constants (tab names, headers, choices, default settings)
 *   2. Pure logic (no Apps Script services) — unit-tested in test/
 *   3. Apps Script glue (setupGpsTabs, menuValidateGps)
 *
 * Top-level code here must not reference constants from Setup.js: GAS loads
 * files in project order and GpsSetup.js loads first. Use them only inside
 * functions.
 */

// ---- 1. Constants ----------------------------------------------------------

const GPS_SHEETS = {
  DEVICES:       'GPS_Devices',
  TRIPS:         'Transport_Trips',
  STOPS:         'Transport_Stops',
  TRIP_STOPS:    'Trip_Stops',
  STUDENT_STOPS: 'Student_Trip_Stops',
  NOTIFY_LOG:    'Parent_Notify_Log',
  STRINGS:       'Notify_Strings',
  DAILY:         'GPS_Daily',
  ACCESS_LOG:    'GPS_Access_Log',
  ACCESS:        'GPS_Access'
};

const GPS_SETTINGS_TAB = 'Settings';

// Exactly the PRD §7.2 columns. GPS_Daily and GPS_Access_Log say "Unchanged,
// plus ..." in the PRD; the base columns are not spelled out there, so they
// follow the Worker's trip_daily table (migrations/0001_init.sql) and the
// access-log needs of R18. Add new columns at the END only.
const GPS_HEADERS = {
  [GPS_SHEETS.DEVICES]: ['device_id', 'vehicle_id', 'kind', 'source_protocol', 'holder',
    'active_from', 'active_to', 'store_outside_window', 'token_last4', 'token_issued_at',
    'status', 'notes', 'edited_by', 'edited_at'],
  [GPS_SHEETS.TRIPS]: ['trip_code', 'session', 'route_no', 'vehicle_id', 'window_start',
    'window_end', 'active', 'edited_by', 'edited_at'],
  [GPS_SHEETS.STOPS]: ['stop_id', 'stop_name', 'landmark', 'lat', 'lon', 'radius_m', 'kind',
    'coord_source', 'verified_by', 'verified_on', 'active', 'edited_by', 'edited_at'],
  [GPS_SHEETS.TRIP_STOPS]: ['trip_code', 'sequence', 'stop_id', 'scheduled_time'],
  [GPS_SHEETS.STUDENT_STOPS]: ['admission_no', 'session', 'trip_code', 'stop_id', 'notify',
    'active', 'gcm_reachable', 'edited_by', 'edited_at'],
  [GPS_SHEETS.NOTIFY_LOG]: ['dedupe_key', 'event_id', 'created_at', 'service_date',
    'trip_run_id', 'session', 'event_type', 'admission_no', 'stop_id', 'eta_minutes', 'mode',
    'status', 'suppressed_reason', 'gcm_queued_at', 'gcm_status', 'gcm_result',
    'gcm_sent_at', 'latency_s', 'actual_crossing_at', 'eta_error_min', 'expires_at'],
  [GPS_SHEETS.STRINGS]: ['key', 'en', 'ta', 'ta-Latn', 'notes'],
  [GPS_SHEETS.DAILY]: ['day_key', 'service_date', 'vehicle_id', 'pings', 'late_pings',
    'first_fix_at', 'last_fix_at', 'summary',
    'trip_code', 'session', 'events_fired', 'events_suppressed', 'median_eta_error_min',
    'median_gcm_latency_s'],
  [GPS_SHEETS.ACCESS_LOG]: ['timestamp', 'view', 'viewer_email'],
  [GPS_SHEETS.ACCESS]: ['email', 'name', 'role', 'active', 'added_by', 'added_on', 'notes']
};

// Creation order (also the order tabs are added in).
const GPS_TAB_ORDER = [GPS_SHEETS.DEVICES, GPS_SHEETS.TRIPS, GPS_SHEETS.STOPS,
  GPS_SHEETS.TRIP_STOPS, GPS_SHEETS.STUDENT_STOPS, GPS_SHEETS.NOTIFY_LOG,
  GPS_SHEETS.STRINGS, GPS_SHEETS.DAILY, GPS_SHEETS.ACCESS_LOG, GPS_SHEETS.ACCESS];

const GPS_SESSIONS = ['MORNING_PICKUP', 'AFTERNOON_DROP', 'EVENING_DROP'];

const GPS_CHOICES = {
  session:         GPS_SESSIONS,
  device_kind:     ['phone', 'hardwired'],
  protocol:        ['osmand', 'traccar'],
  stop_kind:       ['stop', 'school'],
  coord_source:    ['driven', 'map_tap', 'geocoded_draft'],
  yesno:           ['Yes', 'No'],
  role:            ['view', 'manage']
};

// tab -> column -> choices. Applied by header name.
const GPS_LIST_RULES = [
  [GPS_SHEETS.DEVICES,       'kind',                 GPS_CHOICES.device_kind],
  [GPS_SHEETS.DEVICES,       'source_protocol',      GPS_CHOICES.protocol],
  [GPS_SHEETS.DEVICES,       'store_outside_window', GPS_CHOICES.yesno],
  [GPS_SHEETS.TRIPS,         'session',              GPS_CHOICES.session],
  [GPS_SHEETS.TRIPS,         'active',               GPS_CHOICES.yesno],
  [GPS_SHEETS.STOPS,         'kind',                 GPS_CHOICES.stop_kind],
  [GPS_SHEETS.STOPS,         'coord_source',         GPS_CHOICES.coord_source],
  [GPS_SHEETS.STOPS,         'active',               GPS_CHOICES.yesno],
  [GPS_SHEETS.STUDENT_STOPS, 'session',              GPS_CHOICES.session],
  [GPS_SHEETS.STUDENT_STOPS, 'notify',               GPS_CHOICES.yesno],
  [GPS_SHEETS.STUDENT_STOPS, 'active',               GPS_CHOICES.yesno],
  [GPS_SHEETS.NOTIFY_LOG,    'session',              GPS_CHOICES.session],
  [GPS_SHEETS.DAILY,         'session',              GPS_CHOICES.session],
  [GPS_SHEETS.ACCESS,        'role',                 GPS_CHOICES.role],
  [GPS_SHEETS.ACCESS,        'active',               GPS_CHOICES.yesno]
];

// Status colours: Pending amber, Done green, Error red, Stale grey. Always
// matched on the word in the cell, so the colour is paired with text.
const GPS_STATUS_COLOURS = [
  { text: 'Error',   bg: '#FAD9D9', fg: '#7A1F1F' },
  { text: 'Pending', bg: '#FCF0D6', fg: '#6B4A00' },
  { text: 'Stale',   bg: '#E4E7EA', fg: '#3D4650' },
  { text: 'Live',    bg: '#DDF3E4', fg: '#1D5A33' },
  { text: 'Done',    bg: '#DDF3E4', fg: '#1D5A33' }
];
const GPS_STATUS_COLUMNS = [
  [GPS_SHEETS.DEVICES, 'status'],
  [GPS_SHEETS.NOTIFY_LOG, 'status'],
  [GPS_SHEETS.NOTIFY_LOG, 'gcm_status']
];
const GPS_INACTIVE_COLUMNS = [
  [GPS_SHEETS.TRIPS, 'active'], [GPS_SHEETS.STOPS, 'active'],
  [GPS_SHEETS.STUDENT_STOPS, 'active'], [GPS_SHEETS.ACCESS, 'active']
];
const GPS_RED_BG = '#FAD9D9';
const GPS_GREY_BG = '#E4E7EA';
const GPS_HEADER_BG = '#E8E1F5';
const GPS_HEADER_FG = '#3F3A52';

const GPS_ACCESS_PROTECTION = 'GPS_Access: workbook owner only';

/** Rows pre-armed with dropdowns, as in Setup.js. */
const GPS_VALIDATION_ROWS = 2000;

/** R28: a stop further than this from the school is flagged. */
const GPS_MAX_STOP_KM = 30;

// [key, default, note]. Defaults named in PRD §7.2 are used as given. The
// others are cautious "off / empty" defaults (see RFC-GPS-1, open points).
const GPS_DEFAULT_SETTINGS = [
  ['gps_enabled', 'No', 'Master switch for the GPS views. No = the Live buses view stays closed'],
  ['gps_service_days', 'Mon,Tue,Wed,Thu,Fri,Sat', 'Days the buses run. Used to tell "no bus today" from "bus silent"'],
  ['gps_window_grace_min', '15', 'Minutes of grace either side of a trip window before a bus counts as late or silent'],
  ['gps_stale_minutes', '5', 'A bus with no fix for this many minutes shows as Stale'],
  ['gps_ping_interval_s', '30', 'How often the driver phone should report a fix, in seconds'],
  ['gps_retention_days', '90', 'Raw pings are kept this many days'],
  ['gps_alerts_enabled', 'No', 'Yes = post stale-bus and watchdog alerts to Ops Alerts'],
  ['gps_purge_enabled', 'No', 'Yes = the Worker may delete pings older than gps_retention_days'],
  ['parent_notify_mode', 'shadow_local', 'shadow_local = events measured, nothing sent. Other modes need RFC-GPS-6'],
  ['parent_notify_channel', 'gcm', 'Channel used to notify families'],
  ['parent_notify_types', 'bus_reached_school,bus_left_school', 'Event types that may notify families'],
  ['parent_notify_trips', '', 'Trip codes that may notify families (blank = none)'],
  ['gate_l_passed', 'No', 'Yes only after Gate L is signed off'],
  ['gcm_send_window', '07:00-19:00', 'GCM sends nothing outside this window (HH:mm-HH:mm, Asia/Kolkata). Events outside it are suppressed'],
  ['gcm_project_id', 'cw-bus-notify', 'GCM project that carries bus notifications'],
  ['notify_eta_minutes', '5', 'Fire the approaching event this many minutes before the stop'],
  ['notify_max_fix_age_s', '90', 'Ignore a fix older than this many seconds when deciding to notify'],
  ['notify_max_accuracy_m', '50', 'Ignore a fix less accurate than this many metres'],
  ['eta_road_factor', '1.3', 'Multiplier on straight-line distance to approximate road distance'],
  ['eta_speed_window_min', '5', 'Minutes of recent fixes used to estimate speed'],
  ['gps_backfill_bucket', '400', 'Worker burst allowance so a dead-zone backfill is not dropped'],
  ['gcm_feed_daily_cap', '300', 'Most rows the feeder may add to GCM OUTBOX in a day']
];

// ---- 2. Pure logic ---------------------------------------------------------

/** 1 -> A, 27 -> AA. For building A1-style ranges in formulas. */
function gpsColLetter_(n) {
  var s = '';
  while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

/**
 * Decide what to do to a header row. existingRow is the current row 1 (any
 * length). Returns { writeAll: true } when the row is blank, otherwise
 * { append: [...] } with wanted names that are missing, in wanted order. Existing
 * columns are never moved or renamed, so data stays under its header.
 */
function gpsPlanHeaders_(existingRow, wanted) {
  var have = (existingRow || []).map(function (v) { return String(v == null ? '' : v).trim(); });
  var any = have.some(function (v) { return v !== ''; });
  if (!any) return { writeAll: true, append: [] };
  var haveSet = {};
  have.forEach(function (v) { if (v) haveSet[v] = true; });
  return { writeAll: false, append: wanted.filter(function (w) { return !haveSet[w]; }) };
}

/** Settings rows from defaults whose key is not already in haveKeys. */
function gpsMissingSettings_(haveKeys, defaults) {
  var have = {};
  (haveKeys || []).forEach(function (k) { var s = String(k == null ? '' : k).trim(); if (s) have[s] = true; });
  return defaults.filter(function (d) { return !have[d[0]]; });
}

/** 2D sheet values (row 0 = headers) -> array of {header: value, _row: n}. */
function gpsRowsToObjects_(values) {
  if (!values || values.length < 2) return [];
  var headers = values[0].map(function (h) { return String(h == null ? '' : h).trim(); });
  var out = [];
  for (var i = 1; i < values.length; i++) {
    var o = { _row: i + 1 }, any = false;
    for (var c = 0; c < headers.length; c++) {
      if (!headers[c]) continue;
      var v = values[i][c];
      o[headers[c]] = v;
      if (String(v == null ? '' : v).trim() !== '') any = true;
    }
    if (any) out.push(o);
  }
  return out;
}

function gpsStr_(v) { return String(v == null ? '' : v).trim(); }

/** Distance in km between two lat/lon points (haversine). */
function gpsDistanceKm_(lat1, lon1, lat2, lon2) {
  var R = 6371, rad = Math.PI / 180;
  var dLat = (lat2 - lat1) * rad, dLon = (lon2 - lon1) * rad;
  var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
          Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

function gpsIsOff_(v) { return gpsStr_(v).toLowerCase() === 'no'; }

/**
 * Check the GPS tabs. tables = { trips, stops, tripStops, studentStops }, each
 * an array of row objects from gpsRowsToObjects_. Returns issues:
 *   { code, severity: 'error'|'warn', tab, row, message }
 * Codes: DUP_SEQUENCE, MISSING_SCHOOL, NO_SCHOOL_STOP, STOP_TOO_FAR,
 * UNKNOWN_STOP, STUDENT_STOP_NOT_IN_TRIP (R26–R29), UNVERIFIED_STOP (R27).
 * Inactive trips, stops and students (active = No) are skipped.
 */
function gpsValidateSetup_(tables, opts) {
  var maxKm = (opts && opts.maxKm) || GPS_MAX_STOP_KM;
  var trips = (tables && tables.trips) || [], stops = (tables && tables.stops) || [];
  var tripStops = (tables && tables.tripStops) || [], students = (tables && tables.studentStops) || [];
  var issues = [];
  function add(code, severity, tab, row, message) {
    issues.push({ code: code, severity: severity, tab: tab, row: row, message: message });
  }

  var stopById = {};
  stops.forEach(function (s) { var id = gpsStr_(s.stop_id); if (id) stopById[id] = s; });
  var activeTrip = {};
  trips.forEach(function (t) { var c = gpsStr_(t.trip_code); if (c && !gpsIsOff_(t.active)) activeTrip[c] = true; });

  // R27: unverified stops (active ones only).
  stops.forEach(function (s) {
    if (gpsIsOff_(s.active) || !gpsStr_(s.stop_id)) return;
    if (gpsStr_(s.verified_on) === '') {
      add('UNVERIFIED_STOP', 'warn', GPS_SHEETS.STOPS, s._row,
        'Stop ' + gpsStr_(s.stop_id) + ' has no verified_on, so no events fire there');
    }
  });

  // Group Trip_Stops by trip.
  var byTrip = {};
  tripStops.forEach(function (ts) {
    var c = gpsStr_(ts.trip_code);
    if (!c) return;
    (byTrip[c] = byTrip[c] || []).push(ts);
  });

  // R28: duplicate sequence, missing school row.
  Object.keys(byTrip).forEach(function (code) {
    if (!activeTrip[code]) return;
    var seen = {};
    byTrip[code].forEach(function (ts) {
      var seq = gpsStr_(ts.sequence);
      if (seq === '') return;
      if (seen[seq] !== undefined) {
        add('DUP_SEQUENCE', 'error', GPS_SHEETS.TRIP_STOPS, ts._row,
          'Trip ' + code + ' has sequence ' + seq + ' twice (rows ' + seen[seq] + ' and ' + ts._row + ')');
      } else seen[seq] = ts._row;
    });
    var hasSchool = byTrip[code].some(function (ts) {
      var s = stopById[gpsStr_(ts.stop_id)];
      return s && gpsStr_(s.kind) === 'school';
    });
    if (!hasSchool) {
      add('MISSING_SCHOOL', 'error', GPS_SHEETS.TRIP_STOPS, byTrip[code][0]._row,
        'Trip ' + code + ' has no school row in its stop list');
    }
    byTrip[code].forEach(function (ts) {
      var id = gpsStr_(ts.stop_id);
      if (id && !stopById[id]) {
        add('UNKNOWN_STOP', 'error', GPS_SHEETS.TRIP_STOPS, ts._row,
          'Trip ' + code + ' uses stop ' + id + ', which is not on Transport_Stops');
      }
    });
  });
  // An active trip with no Trip_Stops rows at all has no school either.
  Object.keys(activeTrip).forEach(function (code) {
    if (byTrip[code]) return;
    var t = trips.filter(function (x) { return gpsStr_(x.trip_code) === code; })[0];
    add('MISSING_SCHOOL', 'error', GPS_SHEETS.TRIPS, t ? t._row : 0,
      'Trip ' + code + ' has no stops, so no school row either');
  });

  // R28: stops more than maxKm from the school.
  var schools = stops.filter(function (s) {
    return gpsStr_(s.kind) === 'school' && !gpsIsOff_(s.active) &&
      isFinite(parseFloat(s.lat)) && isFinite(parseFloat(s.lon)) &&
      gpsStr_(s.lat) !== '' && gpsStr_(s.lon) !== '';
  });
  if (!schools.length) {
    if (stops.length) {
      add('NO_SCHOOL_STOP', 'error', GPS_SHEETS.STOPS, 0,
        'No active school stop with coordinates, so distances cannot be checked');
    }
  } else {
    var school = schools[0];
    var sLat = parseFloat(school.lat), sLon = parseFloat(school.lon);
    stops.forEach(function (s) {
      if (gpsIsOff_(s.active) || gpsStr_(s.kind) === 'school') return;
      if (gpsStr_(s.lat) === '' || gpsStr_(s.lon) === '') return;
      var la = parseFloat(s.lat), lo = parseFloat(s.lon);
      if (!isFinite(la) || !isFinite(lo)) return;
      var km = gpsDistanceKm_(sLat, sLon, la, lo);
      if (km > maxKm) {
        add('STOP_TOO_FAR', 'error', GPS_SHEETS.STOPS, s._row,
          'Stop ' + gpsStr_(s.stop_id) + ' is ' + km.toFixed(1) + ' km from school (limit ' + maxKm + ' km)');
      }
    });
  }

  // R29: student stop must be in that trip's Trip_Stops.
  var inTrip = {};
  tripStops.forEach(function (ts) { inTrip[gpsStr_(ts.trip_code) + '|' + gpsStr_(ts.stop_id)] = true; });
  students.forEach(function (st) {
    if (gpsIsOff_(st.active)) return;
    var code = gpsStr_(st.trip_code), stop = gpsStr_(st.stop_id);
    if (!code && !stop) return;
    if (!inTrip[code + '|' + stop]) {
      add('STUDENT_STOP_NOT_IN_TRIP', 'error', GPS_SHEETS.STUDENT_STOPS, st._row,
        'Student ' + gpsStr_(st.admission_no) + ': stop "' + stop + '" is not in trip "' + code + '"');
    }
  });

  return issues;
}

/** One-line-per-issue text for the menu alert; capped so the dialog stays readable. */
function gpsFormatIssues_(issues, cap) {
  cap = cap || 25;
  if (!issues.length) return 'No problems found.';
  var errors = issues.filter(function (i) { return i.severity === 'error'; }).length;
  var lines = issues.slice(0, cap).map(function (i) {
    return (i.severity === 'error' ? '[ERROR] ' : '[note] ') + i.tab + ' row ' + i.row + ': ' + i.message;
  });
  var head = errors + ' error(s), ' + (issues.length - errors) + ' note(s).\n\n';
  var tail = issues.length > cap ? '\n\n...and ' + (issues.length - cap) + ' more.' : '';
  return head + lines.join('\n') + tail;
}

// ---- 3. Apps Script glue ---------------------------------------------------

/**
 * Create / complete every GPS tab. Idempotent. Also called from setupWorkbook().
 * Callable from the editor or the sheet; returns a short summary string.
 */
function setupGpsTabs() {
  return setupGpsTabs_(SpreadsheetApp.getActiveSpreadsheet());
}

function setupGpsTabs_(ss) {
  GPS_TAB_ORDER.forEach(function (name) {
    var sh = ss.getSheetByName(name) || ss.insertSheet(name);
    gpsEnsureHeader_(sh, GPS_HEADERS[name]);
  });
  gpsSeedSettings_(ss);
  GPS_TAB_ORDER.forEach(function (name) {
    var sh = ss.getSheetByName(name);
    var cols = gpsHeaderMap_(sh);
    gpsApplyListRules_(sh, name, cols);
    gpsApplyFormatting_(ss, sh, name, cols);
  });
  gpsProtectAccess_(ss);
  return 'GPS tabs ready';
}

/** Header name -> 1-based column, read from the live row 1 (never by position). */
function gpsHeaderMap_(sh) {
  var map = {};
  var lastCol = sh.getLastColumn();
  if (lastCol < 1) return map;
  sh.getRange(1, 1, 1, lastCol).getValues()[0].forEach(function (h, i) {
    var k = gpsStr_(h);
    if (k && !map[k]) map[k] = i + 1;
  });
  return map;
}

function gpsEnsureHeader_(sh, wanted) {
  var lastCol = sh.getLastColumn();
  var existing = lastCol > 0 ? sh.getRange(1, 1, 1, lastCol).getValues()[0] : [];
  var plan = gpsPlanHeaders_(existing, wanted);
  var names, startCol;
  if (plan.writeAll) { names = wanted; startCol = 1; }
  else if (plan.append.length) { names = plan.append; startCol = lastCol + 1; }
  else { gpsStyleHeader_(sh, lastCol || wanted.length); return; }
  var need = startCol + names.length - 1 - sh.getMaxColumns();
  if (need > 0) sh.insertColumnsAfter(sh.getMaxColumns(), need);
  sh.getRange(1, startCol, 1, names.length).setValues([names]);
  gpsStyleHeader_(sh, Math.max(lastCol, startCol + names.length - 1));
}

function gpsStyleHeader_(sh, width) {
  sh.getRange(1, 1, 1, width).setFontWeight('bold').setFontColor(GPS_HEADER_FG)
    .setBackground(GPS_HEADER_BG).setVerticalAlignment('middle');
  sh.setFrozenRows(1);
}

function gpsSeedSettings_(ss) {
  var sh = ss.getSheetByName(GPS_SETTINGS_TAB);
  if (!sh) {
    sh = ss.insertSheet(GPS_SETTINGS_TAB);
    gpsEnsureHeader_(sh, ['setting', 'value', 'notes']);
  }
  var cols = gpsHeaderMap_(sh);
  var kc = cols['setting'], vc = cols['value'], nc = cols['notes'];
  if (!kc || !vc) throw new Error('Settings tab has no "setting"/"value" header');
  var last = sh.getLastRow();
  var haveKeys = last > 1 ? sh.getRange(2, kc, last - 1, 1).getValues().map(function (r) { return r[0]; }) : [];
  var missing = gpsMissingSettings_(haveKeys, GPS_DEFAULT_SETTINGS);
  if (!missing.length) return;
  var width = Math.max(kc, vc, nc || 0);
  var rows = missing.map(function (d) {
    var r = new Array(width).fill('');
    r[kc - 1] = d[0]; r[vc - 1] = d[1]; if (nc) r[nc - 1] = d[2];
    return r;
  });
  var start = last + 1;
  var over = start + rows.length - 1 - sh.getMaxRows();
  if (over > 0) sh.insertRowsAfter(sh.getMaxRows(), over);
  sh.getRange(start, 1, rows.length, width).setValues(rows);
  sh.getRange(start, kc, rows.length, 1).setFontWeight('bold');
}

function gpsApplyListRules_(sh, tabName, cols) {
  GPS_LIST_RULES.forEach(function (r) {
    if (r[0] !== tabName || !cols[r[1]]) return;
    var rule = SpreadsheetApp.newDataValidation()
      .requireValueInList(r[2], true).setAllowInvalid(false).build();
    sh.getRange(2, cols[r[1]], GPS_VALIDATION_ROWS, 1).setDataValidation(rule);
  });
}

/**
 * Status colours. The tab is owned by this code, so its whole rule list is
 * rebuilt each run; that is what keeps a second run from stacking duplicates.
 */
function gpsApplyFormatting_(ss, sh, tabName, cols) {
  var rules = [];
  function textRule(col, text, bg, fg) {
    return SpreadsheetApp.newConditionalFormatRule()
      .whenTextContains(text).setBackground(bg).setFontColor(fg)
      .setRanges([sh.getRange(2, col, GPS_VALIDATION_ROWS, 1)]).build();
  }
  GPS_STATUS_COLUMNS.forEach(function (sc) {
    if (sc[0] !== tabName || !cols[sc[1]]) return;
    GPS_STATUS_COLOURS.forEach(function (c) { rules.push(textRule(cols[sc[1]], c.text, c.bg, c.fg)); });
  });
  GPS_INACTIVE_COLUMNS.forEach(function (ic) {
    if (ic[0] !== tabName || !cols[ic[1]]) return;
    rules.push(SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo('No').setBackground(GPS_GREY_BG).setFontColor('#3D4650')
      .setRanges([sh.getRange(2, cols[ic[1]], GPS_VALIDATION_ROWS, 1)]).build());
  });
  // R29: a student's stop that is not in that trip's stop list goes red.
  if (tabName === GPS_SHEETS.STUDENT_STOPS && cols['trip_code'] && cols['stop_id']) {
    var ts = gpsHeaderMapFromNames_(GPS_HEADERS[GPS_SHEETS.TRIP_STOPS]);
    var tripL = gpsColLetter_(cols['trip_code']), stopL = gpsColLetter_(cols['stop_id']);
    var rng = 'INDIRECT("' + GPS_SHEETS.TRIP_STOPS + '!';
    var f = '=AND($' + stopL + '2<>"",COUNTIFS(' +
      rng + gpsColLetter_(ts.trip_code) + '2:' + gpsColLetter_(ts.trip_code) + '"),$' + tripL + '2,' +
      rng + gpsColLetter_(ts.stop_id) + '2:' + gpsColLetter_(ts.stop_id) + '"),$' + stopL + '2)=0)';
    rules.push(SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied(f).setBackground(GPS_RED_BG).setFontColor('#7A1F1F')
      .setRanges([sh.getRange(2, cols['stop_id'], GPS_VALIDATION_ROWS, 1)]).build());
  }
  // R27: an unverified stop is amber, so it is not mistaken for a live one.
  if (tabName === GPS_SHEETS.STOPS && cols['verified_on'] && cols['stop_id']) {
    var vL = gpsColLetter_(cols['verified_on']), iL = gpsColLetter_(cols['stop_id']);
    rules.push(SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=AND($' + iL + '2<>"",$' + vL + '2="")')
      .setBackground('#FCF0D6').setFontColor('#6B4A00')
      .setRanges([sh.getRange(2, cols['verified_on'], GPS_VALIDATION_ROWS, 1)]).build());
  }
  sh.setConditionalFormatRules(rules);
}

function gpsHeaderMapFromNames_(names) {
  var m = {};
  names.forEach(function (n, i) { m[n] = i + 1; });
  return m;
}

/**
 * GPS_Access is the allow-list for every GPS view, so only the workbook owner
 * may edit it. Reuses the existing protection on a re-run rather than stacking.
 */
function gpsProtectAccess_(ss) {
  var sh = ss.getSheetByName(GPS_SHEETS.ACCESS);
  var existing = sh.getProtections(SpreadsheetApp.ProtectionType.RANGE)
    .filter(function (p) { return p.getDescription() === GPS_ACCESS_PROTECTION; });
  var p = existing.length ? existing[0]
    : sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns()).protect().setDescription(GPS_ACCESS_PROTECTION);
  try {
    var owner = ss.getOwner();
    var ownerEmail = owner ? owner.getEmail() : '';
    var drop = p.getEditors().filter(function (u) { return u.getEmail() !== ownerEmail; });
    if (drop.length) p.removeEditors(drop);
    if (p.canDomainEdit()) p.setDomainEdit(false);
  } catch (e) {
    // Owner-only needs the owner to run setup; say so rather than failing quietly.
    Logger.log('GPS_Access protection could not be tightened: ' + e);
  }
}

/** Read one tab as row objects, by header name. Empty array if the tab is missing. */
function gpsReadTable_(ss, name) {
  var sh = ss.getSheetByName(name);
  if (!sh || sh.getLastRow() < 2) return [];
  return gpsRowsToObjects_(sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues());
}

/** Menu: Fleet > Validate GPS setup. Returns nothing: the result is only shown in the sheet UI. */
function menuValidateGps() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var issues = gpsValidateSetup_({
    trips:        gpsReadTable_(ss, GPS_SHEETS.TRIPS),
    stops:        gpsReadTable_(ss, GPS_SHEETS.STOPS),
    tripStops:    gpsReadTable_(ss, GPS_SHEETS.TRIP_STOPS),
    studentStops: gpsReadTable_(ss, GPS_SHEETS.STUDENT_STOPS)
  });
  SpreadsheetApp.getUi().alert('GPS setup check', gpsFormatIssues_(issues), SpreadsheetApp.getUi().ButtonSet.OK);
}
