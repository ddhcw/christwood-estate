'use strict';
// G-C tests: R12 watchdog (one alert per episode, one recovery, email fallback,
// tolerance of a missing feeder), R22 daily upsert (twice = one row), trigger
// idempotence. Everything is stubbed: no real Worker, Chat, mail or Sheet.
const test = require('node:test');
const assert = require('node:assert');
const { loadGas, makeSpreadsheet } = require('./gas-stubs');

const FILES = ['GpsSetup.js', 'GpsAuth.js', 'GpsWorker.js', 'GpsEndpoints.js', 'GpsWatchdog.js', 'GpsDaily.js'];
const HOOK = 'https://chat.example.test/hook-placeholder';
const PROPS = { GPS_WORKER_URL: 'https://worker.example.test', GPS_READ_SECRET: 'r-placeholder', OPS_ALERTS_WEBHOOK: HOOK };
const J = (x) => JSON.parse(JSON.stringify(x));

function setting(ss, key, value) {
  const sh = ss.getSheetByName('Settings');
  const hdr = sh.data[0];
  const kc = hdr.indexOf('setting'), vc = hdr.indexOf('value');
  const row = sh.data.find((r, i) => i > 0 && r[kc] === key);
  if (row) row[vc] = value; else { const r = hdr.map(() => ''); r[kc] = key; r[vc] = value; sh.data.push(r); }
}

/** A sandbox with GPS tabs set up, alerts on, and a controllable Worker. */
function rig(over) {
  const ss = makeSpreadsheet();
  const h = { health: { status: 200, body: healthy() }, daily: { status: 200, body: { rows: [] } }, hook: { status: 200, body: 'ok' }, hookCalls: [] };
  const g = loadGas(FILES, {
    ss, props: Object.assign({}, PROPS, over && over.props),
    fetch: (url, o) => {
      if (url === HOOK) { h.hookCalls.push(JSON.parse(o.payload).text); return h.hook; }
      const u = new URL(url);
      if (u.pathname === '/v1/health') return h.health;
      if (u.pathname === '/v1/daily') return typeof h.daily === 'function' ? h.daily(u) : h.daily;
      return { status: 404, body: {} };
    }
  });
  g.sandbox.J = J;
  g.run('setupGpsTabs_(SpreadsheetApp.getActiveSpreadsheet())');
  setting(ss, 'gps_alerts_enabled', 'Yes');
  setting(ss, 'gps_enabled', 'Yes');
  return { g, ss, h };
}
function healthy() { return { ok: true, now: Date.now(), last_cron_ts: Date.now() - 60000, cron_age_ms: 60000, outbox_oldest_age_ms: null, last_alert_failure: null }; }
const FORCE = 'J(gpsWatchdogCore_({ force: true }))';
const core = (g) => { g.sandbox.J = J; return g.run(FORCE); };

test('health down: exactly one alert for the whole episode, then exactly one recovery', () => {
  const { g, h } = rig();
  h.health = { status: 503, body: 'down' };
  core(g); core(g); core(g);
  assert.strictEqual(h.hookCalls.length, 1, 'one alert, not one per run');
  assert.match(h.hookCalls[0], /health check is failing/);
  h.health = { status: 200, body: healthy() };
  const r = core(g);
  assert.strictEqual(r.recovered, 1);
  core(g); core(g);
  assert.strictEqual(h.hookCalls.length, 2, 'one recovery only');
  assert.match(h.hookCalls[1], /recovered/);
  // a new episode alerts again
  h.health = { status: 500, body: '' };
  core(g);
  assert.strictEqual(h.hookCalls.length, 3);
});

test('stale cron and old outbox are alerted; a healthy Worker alerts nothing', () => {
  const { g, h } = rig();
  core(g);
  assert.strictEqual(h.hookCalls.length, 0);
  h.health = { status: 200, body: Object.assign(healthy(), { cron_age_ms: 16 * 60000, outbox_oldest_age_ms: 20 * 60000 }) };
  const r = core(g);
  assert.deepStrictEqual(r.conditions.map((c) => c.key).sort(), ['cron_silent', 'outbox_stuck']);
  assert.strictEqual(h.hookCalls.length, 1);
  // 14 min is not yet stale
  const x = rig();
  x.h.health = { status: 200, body: Object.assign(healthy(), { cron_age_ms: 14 * 60000, outbox_oldest_age_ms: 14 * 60000 }) };
  assert.strictEqual(core(x.g).conditions.length, 0);
});

test('Worker down does not falsely recover a cron episode that was open', () => {
  const { g, h } = rig();
  h.health = { status: 200, body: Object.assign(healthy(), { cron_age_ms: 30 * 60000 }) };
  core(g);
  h.health = { status: 503, body: '' };
  core(g);
  assert.strictEqual(h.hookCalls.filter((t) => /recovered/.test(t)).length, 0, 'unknown is not recovered');
  h.health = { status: 200, body: healthy() };
  core(g);
  const texts = h.hookCalls.join(' || ');
  assert.strictEqual(h.hookCalls.filter((t) => /alert/.test(t)).length, 2, texts); // cron, then health_down
  const rec = h.hookCalls.filter((t) => /recovered/.test(t));
  assert.strictEqual(rec.length, 1, texts);
  assert.match(rec[0], /cron/); assert.match(rec[0], /health check/);
});

test('Chat failure falls back to email; a total failure is retried next run, not swallowed', () => {
  const { g, h } = rig();
  setting(g.ss, 'alert_email', 'ops@x.test');
  h.health = { status: 503, body: '' };
  h.hook = { status: 400, body: 'no' };
  const r = core(g);
  assert.strictEqual(r.via, 'email');
  assert.strictEqual(g.state.mails.length, 1);
  assert.strictEqual(g.state.mails[0].to, 'ops@x.test');
  core(g);
  assert.strictEqual(g.state.mails.length, 1, 'still one alert per episode');
  // both channels down: state is not advanced, so the next run tries again
  const y = rig();
  y.h.health = { status: 503, body: '' };
  y.h.hook = { status: 400, body: '' };
  y.g.state.mailFails = true;
  assert.strictEqual(core(y.g).raised, 0);
  y.g.state.mailFails = false;
  assert.strictEqual(core(y.g).raised, 1);
  assert.strictEqual(y.g.state.mails.length, 1);
});

test('alert_email blank falls back to the owner; no webhook configured goes straight to email', () => {
  const { g, h } = rig({ props: { OPS_ALERTS_WEBHOOK: '' } });
  h.health = { status: 503, body: '' };
  core(g);
  assert.strictEqual(g.state.mails[0].to, 'owner@x.test');
  assert.strictEqual(h.hookCalls.length, 0);
});

test('gps_alerts_enabled = No: the scheduled run does nothing; the manual check reports but posts nothing', () => {
  const { g, h, ss } = rig();
  setting(ss, 'gps_alerts_enabled', 'No');
  h.health = { status: 503, body: '' };
  g.sandbox.J = J;
  const sched = g.run('J(gpsWatchdogCore_({ force: false }))');
  assert.strictEqual(sched.skipped, true);
  const manual = core(g);
  assert.strictEqual(manual.conditions.length, 1);
  assert.strictEqual(manual.posting, false);
  assert.strictEqual(h.hookCalls.length + g.state.mails.length, 0);
});

test('feeder checks: stuck rows and a stale heartbeat alert; absence of both is silent', () => {
  const { g, h, ss } = rig();
  assert.strictEqual(core(g).conditions.length, 0, 'no feeder yet: tolerated');
  const log = ss.getSheetByName('Parent_Notify_Log');
  const hdr = log.data[0];
  const mk = (o) => hdr.map((c) => (o[c] === undefined ? '' : o[c]));
  const fmt = (ms) => new Date(ms + 330 * 60000).toISOString().slice(0, 19).replace('T', ' ');
  log.data.push(mk({ dedupe_key: 'a', status: 'pending_feed', created_at: fmt(Date.now() - 20 * 60000) }));
  log.data.push(mk({ dedupe_key: 'b', status: 'queued_gcm', created_at: new Date(Date.now() - 30 * 60000) }));
  log.data.push(mk({ dedupe_key: 'c', status: 'pending_feed', created_at: fmt(Date.now() - 5 * 60000) }));
  log.data.push(mk({ dedupe_key: 'd', status: 'sent', created_at: fmt(Date.now() - 90 * 60000) }));
  setting(ss, 'feeder_heartbeat', fmt(Date.now() - 9 * 60000));
  const r = core(g);
  assert.deepStrictEqual(r.conditions.map((c) => c.key).sort(), ['feed_stuck', 'feeder_heartbeat']);
  assert.match(r.conditions.find((c) => c.key === 'feed_stuck').detail, /^2 row/);
  assert.strictEqual(h.hookCalls.length, 1);
  // a missing Parent_Notify_Log column or tab never throws
  const z = rig();
  delete z.ss.sheets.Parent_Notify_Log;
  assert.strictEqual(core(z.g).conditions.length, 0);
});

test('service window: needs a service day and a trip window; the scheduled run is silent outside it', () => {
  const { g } = rig();
  const t = (s, e) => [{ trip_code: 'T', vehicle_id: 'V1', window_start: s, window_end: e, active: 'Yes' }];
  const IST = (iso) => Date.parse(iso + '+05:30');
  const f = (trips, iso, days, grace) => { g.sandbox.__t = trips; return g.run(`gpsInServiceWindow_(__t, ${IST(iso)}, ${JSON.stringify(days)}, ${grace})`); };
  // 2026-11-19 is a Thursday
  assert.strictEqual(f(t('07:00', '08:30'), '2026-11-19T07:10:00', 'Mon,Tue,Wed,Thu,Fri,Sat', 15), true);
  assert.strictEqual(f(t('07:00', '08:30'), '2026-11-19T06:50:00', 'Mon,Tue,Wed,Thu,Fri,Sat', 15), true, 'grace before');
  assert.strictEqual(f(t('07:00', '08:30'), '2026-11-19T06:40:00', 'Mon,Tue,Wed,Thu,Fri,Sat', 15), false);
  assert.strictEqual(f(t('07:00', '08:30'), '2026-11-19T07:10:00', 'Mon,Tue', 15), false, 'not a service day');
  assert.strictEqual(f([{ trip_code: 'T', vehicle_id: 'V1', window_start: '07:00', window_end: '08:30', active: 'No' }], '2026-11-19T07:10:00', 'Thu', 15), false);
  const out = rig();
  out.h.health = { status: 503, body: '' };
  setting(out.ss, 'gps_service_days', 'Mon,Tue,Wed,Thu,Fri,Sat,Sun');
  out.g.sandbox.J = J;
  const r = out.g.run('J(gpsWatchdogCore_({ force: false }))'); // no trips: outside every window
  assert.strictEqual(r.skipped, true);
  assert.strictEqual(out.h.hookCalls.length, 0);
});

test('scheduled run inside a window alerts once; gpsWatchdog() returns nothing to its caller', () => {
  const { g, h, ss } = rig();
  const sh = ss.getSheetByName('Transport_Trips');
  const hdr = sh.data[0];
  const ist = new Date(Date.now() + 330 * 60000);
  const mod = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  const hm = (m) => { m = (m + 1440) % 1440; return ('0' + Math.floor(m / 60)).slice(-2) + ':' + ('0' + (m % 60)).slice(-2); };
  const row = hdr.map(() => ''); 
  row[hdr.indexOf('trip_code')] = 'T1'; row[hdr.indexOf('vehicle_id')] = 'V1'; row[hdr.indexOf('active')] = 'Yes';
  row[hdr.indexOf('window_start')] = hm(mod - 10); row[hdr.indexOf('window_end')] = hm(mod + 10);
  sh.data.push(row);
  setting(ss, 'gps_service_days', 'Mon,Tue,Wed,Thu,Fri,Sat,Sun');
  h.health = { status: 503, body: '' };
  assert.strictEqual(g.run('gpsWatchdog()'), undefined);
  g.run('gpsWatchdog()');
  assert.strictEqual(h.hookCalls.length, 1);
});

test('alert text carries no coordinates, names or admission numbers', () => {
  const { g } = rig();
  g.sandbox.J = J;
  const t = g.run('gpsAlertText_([{key:"feed_stuck",detail:"2 row(s), oldest 20 min"},{key:"health_down",detail:"Worker answered HTTP 503"}], "x")');
  assert.ok(!/lat|lon|admission|@/i.test(t));
});

test('installGpsTriggers is idempotent: one 15-minute gpsWatchdog trigger however often it runs', () => {
  const { g } = rig();
  g.state.triggers.push({ fn: 'other', getHandlerFunction: () => 'other' });
  g.run('gpsInstallTriggersCore_()'); g.run('gpsInstallTriggersCore_()'); g.run('gpsInstallTriggersCore_()');
  const mine = g.state.triggers.filter((t) => t.fn === 'gpsWatchdog');
  assert.strictEqual(mine.length, 1);
  assert.strictEqual(mine[0].minutes, 15);
  assert.strictEqual(g.state.triggers.filter((t) => t.fn === 'other').length, 1, 'other triggers untouched');
});

// ---- R22 daily pull ----

const WROW = { vehicle_id: 'V1', trip_code: 'T1', session: 'MORNING_PICKUP', pings: 100, late_pings: 2, first_fix_ts: Date.parse('2026-11-18T07:00:00+05:30'), last_fix_ts: Date.parse('2026-11-18T08:15:00+05:30'), summary: { a: 1 } };

test('daily pull twice leaves one row; a changed rollup updates it and keeps columns we do not own', () => {
  const { g, h, ss } = rig();
  h.daily = { status: 200, body: { rows: [WROW, Object.assign({}, WROW, { vehicle_id: 'V2' })] } };
  const first = g.run('J(gpsDailyPullCore_("2026-11-18"))');
  const second = g.run('J(gpsDailyPullCore_("2026-11-18"))');
  assert.strictEqual(first.ok, true);
  assert.strictEqual(first.added, 2);
  assert.strictEqual(second.added, 0);
  assert.strictEqual(second.updated, 2);
  const sh = ss.getSheetByName('GPS_Daily');
  const hdr = sh.data[0];
  assert.strictEqual(sh.data.length, 3, 'header + 2 rows, not 4');
  const r1 = sh.data[1];
  assert.strictEqual(r1[hdr.indexOf('day_key')], '2026-11-18|V1|T1');
  assert.strictEqual(r1[hdr.indexOf('first_fix_at')], '2026-11-18 07:00');
  assert.strictEqual(r1[hdr.indexOf('last_fix_at')], '2026-11-18 08:15');
  assert.strictEqual(r1[hdr.indexOf('summary')], '{"a":1}');
  // someone/something else filled a column we do not own, then the Worker revises pings
  r1[hdr.indexOf('events_fired')] = 7;
  h.daily = { status: 200, body: { rows: [Object.assign({}, WROW, { pings: 150 })] } };
  g.run('gpsDailyPullCore_("2026-11-18")');
  assert.strictEqual(sh.data.length, 3);
  assert.strictEqual(sh.data[1][hdr.indexOf('pings')], 150);
  assert.strictEqual(sh.data[1][hdr.indexOf('events_fired')], 7);
});

test('daily pull finds columns by header name even if the tab is reordered', () => {
  const { g, h, ss } = rig();
  const sh = ss.getSheetByName('GPS_Daily');
  sh.data[0].reverse();
  h.daily = { status: 200, body: { rows: [WROW] } };
  g.run('gpsDailyPullCore_("2026-11-18")');
  const hdr = sh.data[0];
  assert.strictEqual(sh.data[1][hdr.indexOf('vehicle_id')], 'V1');
  assert.strictEqual(sh.data[1][hdr.indexOf('day_key')], '2026-11-18|V1|T1');
});

test('daily pull refuses a bad date, a Worker error, and a tab missing columns, without writing', () => {
  const { g, h, ss } = rig();
  assert.strictEqual(g.run('J(gpsDailyPullCore_("18/11/2026"))').ok, false);
  h.daily = { status: 503, body: '' };
  assert.strictEqual(g.run('J(gpsDailyPullCore_("2026-11-18"))').ok, false);
  h.daily = { status: 200, body: { rows: [WROW] } };
  ss.getSheetByName('GPS_Daily').data[0][1] = 'renamed';
  const r = g.run('J(gpsDailyPullCore_("2026-11-18"))');
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /service_date/);
  assert.strictEqual(ss.getSheetByName('GPS_Daily').data.length, 1);
});

test('nightly pull never throws, is off when gps_enabled is No, and alerts once on failure', () => {
  const { g, h, ss } = rig();
  h.daily = { status: 503, body: '' };
  setting(ss, 'gps_enabled', 'No');
  g.run('gpsNightlyPull_()');
  assert.strictEqual(h.hookCalls.length, 0);
  assert.strictEqual(g.state.fetchCalls.filter((c) => /daily/.test(c.url)).length, 0);
  setting(ss, 'gps_enabled', 'Yes');
  g.run('gpsNightlyPull_()'); // must not throw
  assert.strictEqual(h.hookCalls.length, 1);
  assert.match(h.hookCalls[0], /daily summary pull failed/);
  // a thrown error inside is swallowed
  g.sandbox.SpreadsheetApp.getActiveSpreadsheet = () => { throw new Error('boom'); };
  g.run('gpsNightlyPull_()');
});

test('rebuildAnalytics hook is wrapped so a GPS failure cannot break it', () => {
  const fs = require('fs'), path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'Analytics.js'), 'utf8');
  assert.match(src, /try \{ gpsNightlyPull_\(\); \} catch/);
});

// ---- R23: no secret value beside a Script Property name, anywhere in the repo ----

test('no Script Property name is paired with a literal value in source, docs or tickets', () => {
  const fs = require('fs'), path = require('path');
  const names = ['GPS_WORKER_URL', 'GPS_READ_SECRET', 'GPS_CONFIG_SECRET', 'GPS_EVENT_HMAC_KEY', 'OPS_ALERTS_WEBHOOK',
    'TRANSPORT_WORKBOOK_ID', 'GCM_CONTROL_SHEET_ID', 'GCM_SHADOW_SPACE', 'FEED_LIVE_ALLOWED', 'READ_SECRET', 'CONFIG_SECRET'];
  const root = path.join(__dirname, '..', '..', '..');
  const roots = [path.join(root, 'projects', 'transport'), path.join(root, 'docs')];
  const files = [];
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
    if (e.name === 'node_modules' || e.name === '.git') return;
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p); else if (/\.(js|mjs|json|md|html|txt|toml|env)$/.test(e.name)) files.push(p);
  });
  roots.forEach((r) => { if (fs.existsSync(r)) walk(r); });
  assert.ok(!files.some((f) => /SCRIPT-PROPERTIES\.txt$/.test(f)), 'no SCRIPT-PROPERTIES.txt holding values');
  const self = path.join(__dirname, 'gps-watchdog.test.js');
  // NAME followed by = or : and then a quoted or bare literal of 8+ non-space chars (placeholders must be TODO(human)/<...>).
  const re = new RegExp('\\b(' + names.join('|') + ')\\b[\'"`]?\\s*[:=]\\s*[\'"`]?([^\\s\'"`,;)}<\\]]{8,})', 'g');
  const bad = [];
  files.forEach((f) => {
    if (f === self || /[\\/]test[\\/]/.test(f)) return;
    const text = fs.readFileSync(f, 'utf8');
    let m;
    while ((m = re.exec(text))) {
      const v = m[2];
      if (/^(TODO\(human\)|NAME|name|value|string|process|props|secret|undefined|null|require|function)/i.test(v)) continue;
      bad.push(path.relative(root, f) + ': ' + m[1] + ' = ' + v.slice(0, 6) + '...');
    }
  });
  assert.deepStrictEqual(bad, []);
  // the scan itself works: it catches a planted value
  re.lastIndex = 0;
  assert.ok(re.test('GPS_READ_SECRET = abcdef123456'));
});
