'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { loadGas, makeSpreadsheet } = require('./gas-stubs');

const ACCESS = [
  { email: 'view@school.test', role: 'view', active: 'Yes' },
  { email: 'boss@school.test', role: 'manage', active: 'Yes' },
  { email: 'gone@school.test', role: 'manage', active: 'No' }
];

function gas(email) { return loadGas(['GpsAuth.js'], { email }); }

test('gpsCheckRole_ table', () => {
  const g = gas('');
  const cases = [
    ['anonymous (blank email)', '', 'view', false],
    ['anonymous, manage', '', 'manage', false],
    ['PIN-only caller has no email', undefined, 'view', false],
    ['address not on list', 'stranger@school.test', 'view', false],
    ['inactive address', 'gone@school.test', 'view', false],
    ['inactive manager asks manage', 'gone@school.test', 'manage', false],
    ['view calling manage', 'view@school.test', 'manage', false],
    ['unknown required role', 'boss@school.test', 'admin', false],
    ['no required role', 'boss@school.test', undefined, false],
    ['view calling view', 'view@school.test', 'view', true],
    ['manage calling manage', 'boss@school.test', 'manage', true],
    ['manage calling view', 'boss@school.test', 'view', true],
    ['case and spaces ignored', '  BOSS@School.test ', 'manage', true]
  ];
  cases.forEach(([name, email, role, ok]) => {
    const r = g.sandbox.gpsCheckRole_(email, role, ACCESS);
    assert.strictEqual(r.ok, ok, name);
    if (!ok) assert.deepStrictEqual(Object.keys(r).sort(), ['error', 'ok'], name + ': only ok+error');
  });
});

test('refusals do not reveal why', () => {
  const g = gas('');
  const a = g.sandbox.gpsCheckRole_('stranger@school.test', 'view', ACCESS).error;
  const b = g.sandbox.gpsCheckRole_('gone@school.test', 'view', ACCESS).error;
  const c = g.sandbox.gpsCheckRole_('view@school.test', 'manage', ACCESS).error;
  assert.strictEqual(a, b); assert.strictEqual(b, c);
});

test('empty access list denies everyone', () => {
  assert.strictEqual(gas('').sandbox.gpsCheckRole_('boss@school.test', 'view', []).ok, false);
});

function sheetWithAccess(rows) {
  const ss = makeSpreadsheet();
  const sh = ss.insertSheet('GPS_Access');
  sh.data = [['email', 'name', 'role', 'active', 'added_by', 'added_on', 'notes']].concat(rows);
  return { ss, sh };
}

test('gpsRequire_: anonymous deployment returns blank identity => refused, no sheet read', () => {
  const { ss } = sheetWithAccess([['boss@school.test', '', 'manage', 'Yes']]);
  const g = loadGas(['GpsAuth.js'], { ss, email: '' });
  const r = g.run("gpsRequire_('view')");
  assert.strictEqual(r.ok, false);
  assert.strictEqual(g.state.cachePuts, 0);
});

test('gpsRequire_: getActiveUser throwing is treated as not signed in', () => {
  const { ss } = sheetWithAccess([['boss@school.test', '', 'manage', 'Yes']]);
  const g = loadGas(['GpsAuth.js'], { ss, email: 'boss@school.test' });
  g.state.throwIdentity = true;
  assert.strictEqual(g.run("gpsRequire_('view')").ok, false);
});

test('gpsRequire_: signed in and listed passes; not listed, inactive, view-for-manage refused', () => {
  const { ss } = sheetWithAccess([
    ['boss@school.test', '', 'manage', 'Yes'], ['view@school.test', '', 'view', 'Yes'], ['gone@school.test', '', 'view', 'No']]);
  const check = (email, role) => { const g = loadGas(['GpsAuth.js'], { ss, email }); return g.run(`gpsRequire_('${role}')`); };
  assert.strictEqual(check('boss@school.test', 'manage').ok, true);
  assert.strictEqual(check('view@school.test', 'view').ok, true);
  assert.strictEqual(check('view@school.test', 'manage').ok, false);
  assert.strictEqual(check('gone@school.test', 'view').ok, false);
  assert.strictEqual(check('stranger@school.test', 'view').ok, false);
});

test('gpsRequire_: cache hit avoids a second read; deactivation bites after 60 s', () => {
  const { ss, sh } = sheetWithAccess([['boss@school.test', '', 'manage', 'Yes']]);
  const g = loadGas(['GpsAuth.js'], { ss, email: 'boss@school.test' });
  assert.strictEqual(g.run("gpsRequire_('manage')").ok, true);
  assert.strictEqual(g.state.cachePuts, 1);
  g.state.now += 30000;
  sh.data[1][3] = 'No'; // deactivate
  assert.strictEqual(g.run("gpsRequire_('manage')").ok, true, 'still cached inside 60 s');
  assert.strictEqual(g.state.cachePuts, 1, 'cache hit, no reload');
  g.state.now += 31000; // 61 s after the cache was written
  assert.strictEqual(g.run("gpsRequire_('manage')").ok, false, 'refused once the cache expires');
});

test('gpsRequire_: unreadable access sheet fails closed', () => {
  const g = loadGas(['GpsAuth.js'], { email: 'boss@school.test' }); // no GPS_Access tab
  const r = g.run("gpsRequire_('view')");
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.email, undefined);
});

test('gpsRequire_ takes no token or email argument: extra args cannot grant access', () => {
  const { ss } = sheetWithAccess([['boss@school.test', '', 'manage', 'Yes']]);
  const g = loadGas(['GpsAuth.js'], { ss, email: '' });
  assert.strictEqual(g.run("gpsRequire_('view', 'boss@school.test', 'atk_validpintoken')").ok, false);
});

test('gpsLogAccess_ writes one row by header name with the viewer address', () => {
  const ss = makeSpreadsheet();
  const sh = ss.insertSheet('GPS_Access_Log');
  sh.data = [['viewer_email', 'junk', 'timestamp', 'view']]; // different order on purpose
  const g = loadGas(['GpsAuth.js'], { ss });
  assert.strictEqual(g.run("gpsLogAccess_(' Boss@School.test ', 'live')"), true);
  assert.deepStrictEqual(sh.data[1], ['boss@school.test', '', '2026-11-19 10:00:00', 'live']);
  assert.strictEqual(sh.data.length, 2);
});

test('gpsLogAccess_ returns false, not throw, when the tab is missing', () => {
  assert.strictEqual(gas('').run("gpsLogAccess_('a@b.test', 'live')"), false);
});
