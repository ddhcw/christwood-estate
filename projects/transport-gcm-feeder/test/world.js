'use strict';
// Fixture builder: a transport workbook and a GCM control sheet as plain arrays.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { loadFeeder, makeSpreadsheet } = require('./stubs');

// The real column layouts come from the transport project, so a rename there fails here.
const transportSetup = fs.readFileSync(path.join(__dirname, '..', '..', 'transport', 'GpsSetup.js'), 'utf8');
const tctx = vm.createContext({});
vm.runInContext(transportSetup + '\nthis.__H = [GPS_HEADERS, GPS_SHEETS];', tctx);
const [GPS_HEADERS, GPS_SHEETS] = tctx.__H;

const NOW = Date.UTC(2026, 10, 19, 5, 30, 0);   // 2026-11-19 11:00:00 in Asia/Kolkata
const OUTBOX_HEADERS = ['Queued At', 'Project ID', 'Recipient', 'Template ID', 'Values (JSON)', 'Send After', 'Status', 'Result', 'Hash'];
const TAB = { OUTBOX: '📤 OUTBOX', ROSTER: '🎓 ROSTER', LOG: '📨 MESSAGE LOG', SETTINGS: '⚙️ SETTINGS' };

function pad(n, w) { return String(n).padStart(w, '0'); }

function logRow(headers, o) {
  return headers.map((h) => (o[h] === undefined ? '' : o[h]));
}

/**
 * opts: trips (default 1), perTrip (default 40), mode, types, props, extraSettings.
 * Trip Tn has vehicle Vnn, session MORNING_PICKUP, school stop SCH. Students Cnnnnn.
 */
function buildWorld(opts) {
  opts = opts || {};
  const trips = opts.trips || 1, perTrip = opts.perTrip == null ? 40 : opts.perTrip;
  const wb = makeSpreadsheet(), ctl = makeSpreadsheet();
  const settings = [['setting', 'value', 'notes'],
    ['parent_notify_mode', opts.mode || 'shadow_gcm', ''],
    ['parent_notify_types', opts.types || 'bus_reached_school,bus_left_school', ''],
    ['gcm_project_id', 'cw-bus-notify', ''],
    ['gcm_feed_daily_cap', String(opts.dailyCap || 300), '']];
  wb.addSheet('Settings', settings);
  const tripRows = [GPS_HEADERS[GPS_SHEETS.TRIPS]], vehRows = [['vehicle_id', 'reg_no']];
  const stuHead = GPS_HEADERS[GPS_SHEETS.STUDENT_STOPS], logHead = GPS_HEADERS[GPS_SHEETS.NOTIFY_LOG];
  const stuRows = [stuHead], logRows = [logHead], roster = [['Admission No', 'Student Name', 'Class', 'Section', 'Email', 'Status', 'Notes']];
  const today = '2026-11-19';
  let n = 0;
  for (let t = 1; t <= trips; t++) {
    const code = 'T' + t, veh = 'V' + pad(t, 2);
    tripRows.push(['T' + t, 'MORNING_PICKUP', '', veh, '06:30', '09:00', 'Yes', '', '']);
    vehRows.push([veh, 'TN00X' + t]);
    for (let i = 0; i < perTrip; i++) {
      n++;
      const adm = 'C0' + pad(n, 4);
      stuRows.push(logRow(stuHead, { admission_no: adm, session: 'MORNING_PICKUP', trip_code: code, stop_id: 'S1', notify: 'Yes', active: 'Yes', gcm_reachable: 'Yes' }));
      roster.push([adm, 'Student ' + n, '1', 'A', adm.toLowerCase() + '@x.test', 'ACTIVE', '']);
      const run = today + '|' + code;
      logRows.push(logRow(logHead, {
        dedupe_key: run + '|' + adm + '|bus_reached_school', event_id: run + '|SCH|bus_reached_school',
        created_at: today + ' 10:59:30', service_date: today, trip_run_id: run, session: 'MORNING_PICKUP',
        event_type: 'bus_reached_school', admission_no: adm, stop_id: 'SCH', eta_minutes: '', mode: opts.mode || 'shadow_gcm',
        status: 'pending_feed', suppressed_reason: '', expires_at: NOW + 15 * 60000 }));
    }
  }
  wb.addSheet('Transport_Trips', tripRows);
  wb.addSheet('Vehicle_Master', vehRows);
  wb.addSheet('Student_Trip_Stops', stuRows);
  wb.addSheet('Parent_Notify_Log', logRows);
  ctl.addSheet(TAB.SETTINGS, [['Key', 'Value', 'Notes'], ['SEND_WINDOW', '07:00-19:00', '']]);
  ctl.addSheet(TAB.OUTBOX, [OUTBOX_HEADERS]);
  ctl.addSheet(TAB.ROSTER, roster);
  ctl.addSheet(TAB.LOG, [['Timestamp', 'Project ID', 'Mode', 'Recipient', 'Target', 'Status', 'Detail', 'Hash', 'Actor']]);
  const props = Object.assign({ TRANSPORT_WORKBOOK_ID: 'WB', GCM_CONTROL_SHEET_ID: 'CTL', GCM_SHADOW_SPACE: 'spaces/AAAA_shadow',
    OPS_ALERTS_WEBHOOK: 'https://chat.example.test/hook', FEED_LIVE_ALLOWED: 'No' }, opts.props || {});
  const g = loadFeeder({ books: { WB: wb, CTL: ctl }, props, fetch: opts.fetch });
  const w = { wb, ctl, g, props: g.props, NOW, TAB,
    log: wb.sheets['Parent_Notify_Log'], outbox: ctl.sheets[TAB.OUTBOX], settings: wb.sheets['Settings'],
    students: wb.sheets['Student_Trip_Stops'], trips: wb.sheets['Transport_Trips'], vehicles: wb.sheets['Vehicle_Master'],
    run: (now) => g.run('fdRunCore_(' + (now == null ? NOW : now) + ')'),
    nightly: (now) => g.run('fdNightlyCore_(' + (now == null ? NOW : now) + ')'),
    logObjs: () => Array.from(g.sandbox.fdRows_(w.log.data)).map((o) => Object.assign({}, o)),
    outboxObjs: () => Array.from(g.sandbox.fdRows_(w.outbox.data)).map((o) => Object.assign({}, o)),
    outboxCount: () => w.outbox.data.length - 1,
    setLog(i, patch) { const h = w.log.data[0]; Object.keys(patch).forEach((k) => { w.log.data[i + 1][h.indexOf(k)] = patch[k]; }); },
    setSetting(key, val) { const row = w.settings.data.find((r) => r[0] === key); if (row) row[1] = val; else w.settings.data.push([key, val, '']); }
  };
  return w;
}

module.exports = { buildWorld, NOW, TAB, OUTBOX_HEADERS, GPS_HEADERS, GPS_SHEETS };
