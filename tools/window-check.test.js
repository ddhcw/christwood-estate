'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { isOpen, validate } = require('./window-check');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const CLI = path.join(__dirname, 'window-check.js');

// keep in sync with the tracker's tools/test.js
const VECTORS = [
  { now: '2026-10-20T14:29:00Z', config: 'v2', open: false },
  { now: '2026-10-20T14:30:00Z', config: 'v2', open: true, window: 'tue-thu' },
  { now: '2026-10-20T21:30:00Z', config: 'v2', open: true, window: 'tue-thu' },
  { now: '2026-10-21T02:23:00Z', config: 'v2', open: true, window: 'tue-thu' },
  { now: '2026-10-21T02:30:00Z', config: 'v2', open: true, window: 'tue-thu' },
  { now: '2026-10-21T15:23:00Z', config: 'v2', open: true, window: 'tue-thu' },
  { now: '2026-10-22T02:29:00Z', config: 'v2', open: true, window: 'tue-thu' },
  { now: '2026-10-22T02:30:00Z', config: 'v2', open: false, nextStart: '2026-10-22T20:00+05:30', nextWindow: 'thu-sat' },
  { now: '2026-10-22T08:30:00Z', config: 'v2', open: false },
  { now: '2026-10-22T14:29:00Z', config: 'v2', open: false },
  { now: '2026-10-22T14:30:00Z', config: 'v2', open: true, window: 'thu-sat' },
  { now: '2026-10-23T08:30:00Z', config: 'v2', open: true, window: 'thu-sat' },
  { now: '2026-10-24T02:23:00Z', config: 'v2', open: true, window: 'thu-sat' },
  { now: '2026-10-24T02:31:00Z', config: 'v2', open: false },
  { now: '2026-10-26T06:30:00Z', config: 'v2', open: false, nextStart: '2026-10-27T20:00+05:30', nextWindow: 'tue-thu' },
  { now: '2026-10-26T06:30:00Z', config: 'override', open: true, reason: 'override' },
  { now: '2026-10-22T20:30:00Z', config: 'expired-override', open: true, window: 'thu-sat', warning: 'override expired' },
  { now: '2026-10-22T20:30:00Z', config: 'disabled', open: false, reason: 'agent disabled' },
  { now: '2026-10-22T20:30:00Z', config: 'v1', open: true, window: 'weekly' },
  { now: '2026-10-26T06:30:00Z', config: 'v1', open: false }
];

const V2 = {
  agent_enabled: true,
  timezone: 'Asia/Kolkata',
  windows: [
    { name: 'tue-thu', start: { day: 'Tuesday', time: '20:00' }, end: { day: 'Thursday', time: '08:00' } },
    { name: 'thu-sat', start: { day: 'Thursday', time: '20:00' }, end: { day: 'Saturday', time: '08:00' } }
  ],
  weekly_window: { start: { day: 'Thursday', time: '20:00' }, end: { day: 'Saturday', time: '08:00' } },
  override_until: null
};

const configs = {
  v2: V2,
  override: { ...V2, override_until: '2026-10-27T04:30:00Z' },
  'expired-override': { ...V2, override_until: '2026-10-01T00:00:00Z' },
  disabled: { ...V2, agent_enabled: false },
  v1: {
    agent_enabled: true,
    timezone: 'Asia/Kolkata',
    weekly_window: { start: { day: 'Thursday', time: '20:00' }, end: { day: 'Saturday', time: '08:00' } },
    override_until: null
  }
};

for (const vector of VECTORS) {
  const result = isOpen(configs[vector.config], vector.now);
  assert.equal(result.open, vector.open, vector.now);
  if (vector.window) assert.equal(result.window, vector.window, vector.now);
  if (vector.reason) assert.equal(result.reason, vector.reason, vector.now);
  if (vector.nextStart) assert.equal(result.nextStart, vector.nextStart, vector.now);
  if (vector.warning) assert.ok(result.warnings.some(warning => warning.includes(vector.warning)), vector.now);
}

assert.deepEqual(validate(V2), []);
assert.deepEqual(validate(configs.v1), []);
assert.ok(validate({
  agent_enabled: true,
  windows: [
    { name: 'one', start: { day: 'Tuesday', time: '20:00' }, end: { day: 'Thursday', time: '08:00' } },
    { name: 'two', start: { day: 'Wednesday', time: '07:00' }, end: { day: 'Wednesday', time: '09:00' } }
  ]
}).some(error => error.includes('overlap')));
assert.ok(validate({
  agent_enabled: true,
  windows: [{ name: 'bad', start: { day: 'Funday', time: '20:00' }, end: { day: 'Monday', time: '20:00' } }]
}).some(error => error.includes('day name')));
assert.ok(validate({
  agent_enabled: true,
  windows: [{ name: 'bad', start: { day: 2, time: '20:00' }, end: { day: 'Monday', time: '20:00' } }]
}).some(error => error.includes('day name')));
assert.ok(validate({
  agent_enabled: true,
  windows: [{ name: 'bad', start: { day: 'Monday', time: '24:00' }, end: { day: 'Tuesday', time: '20:00' } }]
}).some(error => error.includes('HH:MM')));
assert.ok(validate({
  agent_enabled: true,
  windows: [{ name: 'same', start: { day: 'Monday', time: '20:00' }, end: { day: 'Monday', time: '20:00' } }]
}).some(error => error.includes('cannot be the same')));
assert.ok(validate({ agent_enabled: true, windows: 'not an array' }).some(error => error.includes('array')));
assert.ok(validate({ agent_enabled: true }).some(error => error.includes('missing both')));

const wrapWindow = {
  agent_enabled: true,
  windows: [{ name: 'sat-monday', start: { day: 'Saturday', time: '20:00' }, end: { day: 'Monday', time: '08:00' } }]
};
assert.equal(isOpen(wrapWindow, '2026-10-24T18:30:00Z').open, true);
assert.equal(isOpen(wrapWindow, '2026-10-26T02:30:00Z').open, false);

const wrapOverlap = {
  agent_enabled: true,
  windows: [
    ...wrapWindow.windows,
    { name: 'week-start', start: { day: 'Sunday', time: '00:00' }, end: { day: 'Sunday', time: '01:00' } }
  ]
};
assert.ok(validate(wrapOverlap).some(error => error.includes('overlap')));

const touching = {
  agent_enabled: true,
  windows: [
    ...wrapWindow.windows,
    { name: 'monday-morning', start: { day: 'Monday', time: '08:00' }, end: { day: 'Monday', time: '09:00' } }
  ]
};
assert.equal(validate(touching).some(error => error.includes('overlap')), false);

const weeklyFallback = {
  agent_enabled: true,
  windows: [],
  weekly_window: V2.weekly_window
};
assert.deepEqual(validate(weeklyFallback), []);
assert.equal(isOpen(weeklyFallback, '2026-10-22T15:30:00Z').window, 'weekly');
assert.ok(validate({ agent_enabled: true, windows: [] }).some(error => error.includes('missing both')));

const nullWindowConfig = { agent_enabled: true, windows: [null] };
assert.doesNotThrow(() => isOpen(nullWindowConfig, '2026-10-20T14:30:00Z'));
assert.equal(isOpen(nullWindowConfig, '2026-10-20T14:30:00Z').reason, 'invalid config');

const offsetlessOverride = { ...V2, override_until: '2026-10-27T10:00:00' };
assert.ok(validate(offsetlessOverride).some(error => error.includes('override_until')));
assert.equal(isOpen(offsetlessOverride, '2026-10-26T06:30:00Z').reason, 'invalid override_until');
assert.ok(validate({ ...V2, override_until: '2026-10-27T10:00:00+05:30' }).length === 0);

// T-501b: impossible calendar values must fail closed, not roll forward
for (const bad of ['2026-11-31T00:00:00Z', '2026-10-27T24:00:00Z', '2026-02-30T10:00:00+05:30',
  '2026-10-27T10:60:00Z', '2026-10-27T10:00:60Z', '2026-13-01T00:00:00Z', '2026-00-10T00:00:00Z',
  '2027-02-29T10:00:00Z', '2026-10-00T10:00:00Z']) {
  const cfg = { ...V2, override_until: bad };
  assert.ok(validate(cfg).some(error => error.includes('override_until')), bad);
  const res = isOpen(cfg, '2026-10-26T06:30:00Z');
  assert.equal(res.open, false, bad);
  assert.equal(res.reason, 'invalid override_until', bad);
}
assert.deepEqual(validate({ ...V2, override_until: '2028-02-29T10:00:00Z' }), []);
assert.equal(isOpen({ ...V2, override_until: '2028-02-29T10:00:00Z' }, '2028-02-28T10:00:00Z').reason, 'override');

const namedWindow = name => ({ name, start: { day: 'Tuesday', time: '20:00' }, end: { day: 'Thursday', time: '08:00' } });
for (const badName of [5, null, '', '   ', {}, ['x'], false]) {
  assert.ok(validate({ agent_enabled: true, windows: [namedWindow(badName)] })
    .some(error => error.includes('name must be a non-empty string')), String(badName));
  assert.equal(isOpen({ agent_enabled: true, windows: [namedWindow(badName)] }, '2026-10-20T14:30:00Z').open, false);
}
const dupe = { agent_enabled: true, windows: [namedWindow('same'),
  { ...namedWindow('same'), start: { day: 'Thursday', time: '20:00' }, end: { day: 'Friday', time: '08:00' } }] };
assert.ok(validate(dupe).some(error => error.includes('duplicate window name')));
assert.equal(isOpen(dupe, '2026-10-20T14:30:00Z').reason, 'invalid config');

const namedWeekly = { agent_enabled: true, weekly_window: namedWindow('sneaky') };
assert.deepEqual(validate(namedWeekly), []);
assert.equal(isOpen(namedWeekly, '2026-10-20T14:30:00Z').window, 'weekly');
assert.equal(isOpen({ agent_enabled: true, weekly_window: namedWindow(7) }, '2026-10-20T14:30:00Z').window, 'weekly');

function runCli(args, timezone) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: PROJECT_ROOT,
    env: { ...process.env, TZ: timezone },
    encoding: 'utf8'
  });
}

for (const vector of VECTORS) {
  const args = ['--config', '.claude/agent-window.json', '--now', vector.now];
  const losAngeles = runCli(args, 'America/Los_Angeles');
  const kolkata = runCli(args, 'Asia/Kolkata');
  assert.equal(losAngeles.status, kolkata.status, vector.now);
  assert.equal(losAngeles.stdout, kolkata.stdout, vector.now);
  assert.equal(losAngeles.stderr, kolkata.stderr, vector.now);
}

const openCli = runCli(['--config', '.claude/agent-window.json', '--now', '2026-10-20T14:30:00Z'], 'America/Los_Angeles');
assert.equal(openCli.status, 0);
assert.equal(openCli.stdout.trim(), 'OPEN tue-thu until 2026-10-22T08:00+05:30');

const closedCli = runCli(['--config', '.claude/agent-window.json', '--now', '2026-10-26T06:30:00Z'], 'Asia/Kolkata');
assert.equal(closedCli.status, 1);
assert.equal(closedCli.stdout.trim(), 'CLOSED outside window; next tue-thu 2026-10-27T20:00+05:30');

const missingConfigCli = runCli(['--config', 'does-not-exist.json', '--now', '2026-10-20T14:30:00Z'], 'Asia/Kolkata');
assert.equal(missingConfigCli.status, 2);

const offsetlessNowCli = runCli(['--config', '.claude/agent-window.json', '--now', '2026-10-26T06:30:00'], 'America/Los_Angeles');
assert.equal(offsetlessNowCli.status, 2);

const badNowCli = runCli(['--config', '.claude/agent-window.json', '--now', '2026-11-31T00:00:00Z'], 'Asia/Kolkata');
assert.equal(badNowCli.status, 2);
assert.equal(runCli(['--config', '.claude/agent-window.json', '--now', '2026-10-27T24:00:00Z'], 'Asia/Kolkata').status, 2);
assert.equal(runCli(['--config', '.claude/agent-window.json', '--now', '2028-02-29T10:00:00Z'], 'Asia/Kolkata').status !== 2, true);

// Fail-closed fixes: missing name, offset-less now, agent_enabled checked first.
const unnamed = { start: { day: 'Tuesday', time: '20:00' }, end: { day: 'Thursday', time: '08:00' } };
assert.ok(validate({ agent_enabled: true, windows: [unnamed] }).some(error => error.includes('name must be a non-empty string')));
const unnamedRes = isOpen({ agent_enabled: true, windows: [unnamed] }, '2026-10-20T14:30:00Z');
assert.equal(unnamedRes.open, false);
assert.equal(unnamedRes.reason, 'invalid config');
for (const badNow of ['2026-10-20T14:30:00', 'garbage', 5, null, {}]) {
  let res;
  assert.doesNotThrow(() => { res = isOpen(namedWeekly, badNow); }, String(badNow));
  assert.equal(res.open, false);
  assert.equal(res.reason, 'invalid now');
}
for (const cfg of [{ agent_enabled: false, windows: 'garbage' }, { agent_enabled: false }, { agent_enabled: 'true' },
  { agent_enabled: 1, windows: [null] }, null, 'x', [], undefined]) {
  let res;
  assert.doesNotThrow(() => { res = isOpen(cfg, '2026-10-20T14:30:00Z'); });
  assert.equal(res.open, false);
  assert.equal(res.reason, 'agent disabled');
}

const os = require('node:os');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'window-check-'));
function cliWithConfig(cfg, now) {
  const file = path.join(tmpDir, 'cfg.json');
  fs.writeFileSync(file, JSON.stringify(cfg));
  return runCli(['--config', file, '--now', now], 'Asia/Kolkata');
}
const disabledMalformed = cliWithConfig({ agent_enabled: false, windows: 'garbage' }, '2026-10-20T14:30:00Z');
assert.equal(disabledMalformed.status, 1);
assert.equal(disabledMalformed.stdout.trim(), 'CLOSED agent disabled');
assert.equal(cliWithConfig({ agent_enabled: 'true', windows: [namedWindow('a')] }, '2026-10-20T14:30:00Z').status, 1);
assert.equal(cliWithConfig('just a string', '2026-10-20T14:30:00Z').status, 1);
assert.equal(cliWithConfig({ agent_enabled: true, windows: 'garbage' }, '2026-10-20T14:30:00Z').status, 2);
assert.equal(cliWithConfig({ agent_enabled: true, windows: [unnamed] }, '2026-10-20T14:30:00Z').status, 2);
fs.rmSync(tmpDir, { recursive: true, force: true });

console.log('all passed');
