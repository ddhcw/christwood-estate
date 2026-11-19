'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { loadGas, makeSpreadsheet, snapshot } = require('./gas-stubs');

const J = (x) => JSON.parse(JSON.stringify(x));
const G = () => loadGas(['GpsSetup.js']);

test('PRD 7.2 headers are exactly as specified', () => {
  const g = G();
  const h = J(g.run('GPS_HEADERS'));
  assert.deepStrictEqual(h.GPS_Devices, ['device_id', 'vehicle_id', 'kind', 'source_protocol', 'holder', 'active_from', 'active_to', 'store_outside_window', 'token_last4', 'token_issued_at', 'status', 'notes', 'edited_by', 'edited_at']);
  assert.deepStrictEqual(h.Transport_Trips, ['trip_code', 'session', 'route_no', 'vehicle_id', 'window_start', 'window_end', 'active', 'edited_by', 'edited_at']);
  assert.deepStrictEqual(h.Transport_Stops, ['stop_id', 'stop_name', 'landmark', 'lat', 'lon', 'radius_m', 'kind', 'coord_source', 'verified_by', 'verified_on', 'active', 'edited_by', 'edited_at']);
  assert.deepStrictEqual(h.Trip_Stops, ['trip_code', 'sequence', 'stop_id', 'scheduled_time']);
  assert.deepStrictEqual(h.Student_Trip_Stops, ['admission_no', 'session', 'trip_code', 'stop_id', 'notify', 'active', 'gcm_reachable', 'edited_by', 'edited_at']);
  assert.deepStrictEqual(h.Parent_Notify_Log, ['dedupe_key', 'event_id', 'created_at', 'service_date', 'trip_run_id', 'session', 'event_type', 'admission_no', 'stop_id', 'eta_minutes', 'mode', 'status', 'suppressed_reason', 'gcm_queued_at', 'gcm_status', 'gcm_result', 'gcm_sent_at', 'latency_s', 'actual_crossing_at', 'eta_error_min']);
  assert.deepStrictEqual(h.Notify_Strings, ['key', 'en', 'ta', 'ta-Latn', 'notes']);
  assert.deepStrictEqual(h.GPS_Access, ['email', 'name', 'role', 'active', 'added_by', 'added_on', 'notes']);
  assert.ok(h.GPS_Daily.slice(-6).join() === 'trip_code,session,events_fired,events_suppressed,median_eta_error_min,median_gcm_latency_s');
  assert.ok(h.GPS_Access_Log.includes('viewer_email'));
  assert.strictEqual(Object.keys(h).length, 10);
});

test('settings defaults: every PRD key present, named defaults honoured, keys unique', () => {
  const g = G();
  const d = J(g.run('GPS_DEFAULT_SETTINGS'));
  const m = {}; d.forEach((x) => { m[x[0]] = x[1]; });
  assert.strictEqual(d.length, 21);
  assert.strictEqual(Object.keys(m).length, 21);
  assert.deepStrictEqual(
    ['gps_window_grace_min', 'gps_stale_minutes', 'gps_ping_interval_s', 'gps_retention_days', 'gps_purge_enabled', 'parent_notify_mode', 'parent_notify_channel', 'parent_notify_types', 'gate_l_passed', 'gcm_project_id', 'notify_eta_minutes', 'notify_max_fix_age_s', 'notify_max_accuracy_m', 'eta_road_factor', 'eta_speed_window_min', 'gps_backfill_bucket', 'gcm_feed_daily_cap'].map((k) => m[k]),
    ['15', '5', '30', '90', 'No', 'shadow_local', 'gcm', 'bus_reached_school,bus_left_school', 'No', 'cw-bus-notify', '5', '90', '50', '1.3', '5', '400', '300']);
  assert.strictEqual(m.gps_enabled, 'No');
  assert.strictEqual(m.gps_alerts_enabled, 'No');
});

test('gpsPlanHeaders_: blank row writes all; partial row appends only the missing, never reorders', () => {
  const g = G();
  assert.deepStrictEqual(J(g.sandbox.gpsPlanHeaders_([], ['a', 'b'])), { writeAll: true, append: [] });
  assert.deepStrictEqual(J(g.sandbox.gpsPlanHeaders_(['b', 'x'], ['a', 'b', 'c'])), { writeAll: false, append: ['a', 'c'] });
  assert.deepStrictEqual(J(g.sandbox.gpsPlanHeaders_(['a', 'b'], ['a', 'b'])), { writeAll: false, append: [] });
});

function seed(ss) {
  // Pre-existing Settings as setupWorkbook leaves it, with one owner-edited GPS value.
  const s = ss.insertSheet('Settings');
  s.data = [['setting', 'value', 'notes'], ['app_title', 'X', ''], ['gps_stale_minutes', '9', 'edited by hand']];
  const v = ss.insertSheet('Vehicle_Master');
  v.data = [['vehicle_id', 'reg_no'], ['V1', 'TN01']];
}

test('setupGpsTabs_ creates all ten tabs with headers, frozen row, rules, protection', () => {
  const ss = makeSpreadsheet(); seed(ss);
  const g = loadGas(['GpsSetup.js'], { ss });
  g.run('setupGpsTabs_(SpreadsheetApp.getActiveSpreadsheet())');
  const want = J(g.run('GPS_HEADERS'));
  Object.keys(want).forEach((n) => {
    const sh = ss.sheets[n];
    assert.ok(sh, n + ' exists');
    assert.deepStrictEqual(sh.data[0].slice(0, want[n].length), want[n], n + ' header');
    assert.strictEqual(sh.frozen, 1, n + ' frozen');
  });
  // validation lands on the right column by header name
  const trips = ss.sheets.Transport_Trips;
  const sessionCol = want.Transport_Trips.indexOf('session') + 1;
  assert.ok(trips.meta.validation['2,' + sessionCol + ',2000,1'], 'session dropdown');
  const access = ss.sheets.GPS_Access;
  assert.ok(access.meta.validation['2,' + (want.GPS_Access.indexOf('role') + 1) + ',2000,1'], 'role dropdown');
  assert.strictEqual(ss.sheets.Student_Trip_Stops.meta.validation['2,' + (want.Student_Trip_Stops.indexOf('notify') + 1) + ',2000,1'].requireValueInList[0].join(), 'Yes,No');
  // status colours
  assert.ok(ss.sheets.GPS_Devices.meta.rules.length >= 5);
  assert.ok(ss.sheets.Student_Trip_Stops.meta.rules.some((r) => r.whenFormulaSatisfied && /Trip_Stops/.test(r.whenFormulaSatisfied[0])));
  // protected, owner-only
  assert.strictEqual(access.meta.protections.length, 1);
  assert.deepStrictEqual(access.meta.protections[0]._editors, ['owner@x.test']);
  assert.strictEqual(access.meta.protections[0]._domain, false);
  // existing tab untouched, settings: edited value kept, new keys appended once
  assert.deepStrictEqual(ss.sheets.Vehicle_Master.data, [['vehicle_id', 'reg_no'], ['V1', 'TN01']]);
  const st = ss.sheets.Settings.data;
  assert.strictEqual(st[2][1], '9');
  assert.strictEqual(st.filter((r) => r[0] === 'gps_stale_minutes').length, 1);
  assert.strictEqual(st.length, 3 + 20);
});

test('running setup twice changes nothing, including entered data', () => {
  const ss = makeSpreadsheet(); seed(ss);
  const g = loadGas(['GpsSetup.js'], { ss });
  g.run('setupGpsTabs_(SpreadsheetApp.getActiveSpreadsheet())');
  // a person enters data between runs
  ss.sheets.Transport_Stops.data.push(['S1', 'Gate', '', 11.0, 77.0, 75, 'school', 'driven', 'me', '2026-11-01', 'Yes', '', '']);
  ss.sheets.GPS_Access.data.push(['boss@school.test', 'Boss', 'manage', 'Yes', '', '', '']);
  const before = snapshot(ss);
  g.run('setupGpsTabs_(SpreadsheetApp.getActiveSpreadsheet())');
  assert.strictEqual(snapshot(ss), before);
  assert.strictEqual(ss.sheets.GPS_Access.meta.protections.length, 1, 'no stacked protections');
});

test('a tab that already has a column keeps its order; missing ones are appended', () => {
  const ss = makeSpreadsheet(); seed(ss);
  const t = ss.insertSheet('Trip_Stops');
  t.data = [['stop_id', 'trip_code'], ['S1', 'T1']];
  const g = loadGas(['GpsSetup.js'], { ss });
  g.run('setupGpsTabs_(SpreadsheetApp.getActiveSpreadsheet())');
  assert.deepStrictEqual(t.data[0], ['stop_id', 'trip_code', 'sequence', 'scheduled_time']);
  assert.deepStrictEqual(t.data[1].slice(0, 2), ['S1', 'T1']);
});

test('setup works when there is no Settings tab yet', () => {
  const ss = makeSpreadsheet();
  const g = loadGas(['GpsSetup.js'], { ss });
  g.run('setupGpsTabs_(SpreadsheetApp.getActiveSpreadsheet())');
  assert.strictEqual(ss.sheets.Settings.data.length, 1 + 21);
});

// ---- validation (R26-R29) --------------------------------------------------
const stop = (id, kind, lat, lon, verified, row) => ({ _row: row, stop_id: id, kind, lat, lon, verified_on: verified, active: 'Yes' });
function good() {
  return {
    trips: [{ _row: 2, trip_code: 'T1', session: 'MORNING_PICKUP', active: 'Yes' }],
    stops: [stop('SCH', 'school', 11.0, 77.0, '2026-11-01', 2), stop('S1', 'stop', 11.05, 77.02, '2026-11-01', 3)],
    tripStops: [{ _row: 2, trip_code: 'T1', sequence: 1, stop_id: 'S1' }, { _row: 3, trip_code: 'T1', sequence: 2, stop_id: 'SCH' }],
    studentStops: [{ _row: 2, admission_no: 'C00001', session: 'MORNING_PICKUP', trip_code: 'T1', stop_id: 'S1', active: 'Yes' }]
  };
}
const codes = (g, t) => J(g.sandbox.gpsValidateSetup_(t)).map((i) => i.code);

test('validation: clean fixture has no issues', () => {
  assert.deepStrictEqual(codes(G(), good()), []);
});
test('validation: duplicate sequence', () => {
  const t = good(); t.tripStops[1].sequence = 1;
  assert.deepStrictEqual(codes(G(), t), ['DUP_SEQUENCE']);
});
test('validation: missing school row (and trip with no stops)', () => {
  const t = good(); t.tripStops = [t.tripStops[0]];
  assert.deepStrictEqual(codes(G(), t), ['MISSING_SCHOOL']);
  const e = good(); e.tripStops = []; e.studentStops = [];
  assert.deepStrictEqual(codes(G(), e), ['MISSING_SCHOOL']);
});
test('validation: stop more than 30 km from school', () => {
  const t = good(); t.stops[1].lat = 11.5; // ~55 km
  assert.deepStrictEqual(codes(G(), t), ['STOP_TOO_FAR']);
  const near = good(); near.stops[1].lat = 11.2; // ~22 km
  assert.deepStrictEqual(codes(G(), near), []);
});
test('validation: student stop not in that trip', () => {
  const t = good(); t.stops.push(stop('S2', 'stop', 11.01, 77.01, '2026-11-01', 4)); t.studentStops[0].stop_id = 'S2';
  assert.deepStrictEqual(codes(G(), t), ['STUDENT_STOP_NOT_IN_TRIP']);
  const wrongTrip = good(); wrongTrip.studentStops[0].trip_code = 'T9';
  assert.deepStrictEqual(codes(G(), wrongTrip), ['STUDENT_STOP_NOT_IN_TRIP']);
});
test('validation: unverified stop is a note; unknown stop is an error; inactive rows skipped', () => {
  const t = good(); t.stops[1].verified_on = '';
  const r = J(G().sandbox.gpsValidateSetup_(t));
  assert.deepStrictEqual(r.map((i) => [i.code, i.severity]), [['UNVERIFIED_STOP', 'warn']]);
  const u = good(); u.tripStops[0].stop_id = 'NOPE'; u.studentStops = [];
  assert.deepStrictEqual(codes(G(), u), ['UNKNOWN_STOP']);
  const off = good(); off.trips[0].active = 'No'; off.tripStops = []; off.studentStops[0].active = 'No';
  assert.deepStrictEqual(codes(G(), off), []);
});
test('validation: no school stop at all is reported once', () => {
  const t = good(); t.stops = [t.stops[1]]; t.tripStops = [t.tripStops[0]]; t.studentStops = [];
  assert.ok(codes(G(), t).includes('NO_SCHOOL_STOP'));
});
test('gpsRowsToObjects_ reads by header name, skips blank rows, numbers rows from the sheet', () => {
  const g = G();
  const out = g.sandbox.gpsRowsToObjects_([['b', 'a'], ['', ''], ['x', 'y']]);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(out)), [{ _row: 3, b: 'x', a: 'y' }]);
});
test('gpsDistanceKm_ sanity: one degree of latitude is about 111 km', () => {
  const d = G().sandbox.gpsDistanceKm_(11, 77, 12, 77);
  assert.ok(Math.abs(d - 111.2) < 0.5, String(d));
});
test('gpsFormatIssues_ caps output', () => {
  const g = G();
  const issues = Array.from({ length: 30 }, (_, i) => ({ code: 'X', severity: 'error', tab: 'T', row: i, message: 'm' }));
  assert.ok(/and 5 more/.test(g.sandbox.gpsFormatIssues_(issues, 25)));
  assert.strictEqual(g.sandbox.gpsFormatIssues_([]), 'No problems found.');
});
