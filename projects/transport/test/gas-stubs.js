'use strict';
// Tiny Google Apps Script stubs for node --test. Not a faithful emulation: only
// the calls GpsSetup.js and GpsAuth.js make. Sheets are plain 2D arrays and every
// formatting call is recorded so a re-run can be compared with `snapshot()`.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

function makeRange(sh, r, c, nr, nc) {
  const fmt = (what) => (...a) => { sh.meta.fmt.push([what, r, c, nr, nc, a]); return range; };
  const range = {
    getValues() {
      const out = [];
      for (let i = 0; i < nr; i++) {
        const row = [];
        for (let j = 0; j < nc; j++) { const v = (sh.data[r - 1 + i] || [])[c - 1 + j]; row.push(v === undefined ? '' : v); }
        out.push(row);
      }
      return out;
    },
    setValues(vals) {
      for (let i = 0; i < vals.length; i++) {
        while (sh.data.length < r + i) sh.data.push([]);
        const row = sh.data[r - 1 + i];
        for (let j = 0; j < vals[i].length; j++) row[c - 1 + j] = vals[i][j];
      }
      return range;
    },
    setDataValidation(rule) { sh.meta.validation[r + ',' + c + ',' + nr + ',' + nc] = rule; return range; },
    protect() {
      const p = { _desc: '', _editors: ['owner@x.test', 'other@x.test'], _domain: true,
        getDescription() { return this._desc; }, setDescription(d) { this._desc = d; return this; },
        getEditors() { return this._editors.map((e) => ({ getEmail: () => e })); },
        removeEditors(us) { const rm = us.map((u) => u.getEmail()); this._editors = this._editors.filter((e) => !rm.includes(e)); },
        canDomainEdit() { return this._domain; }, setDomainEdit(v) { this._domain = v; } };
      sh.meta.protections.push(p); return p;
    },
    getA1Notation() { return [r, c, nr, nc].join(':'); }
  };
  ['setFontWeight', 'setFontColor', 'setBackground', 'setVerticalAlignment'].forEach((k) => { range[k] = fmt(k); });
  return range;
}

function makeSheet(name) {
  const sh = { name, data: [], maxCols: 26, maxRows: 1000, frozen: 0, meta: { fmt: [], validation: {}, rules: [], protections: [] } };
  Object.assign(sh, {
    getLastRow() { let n = 0; sh.data.forEach((row, i) => { if (row.some((v) => v !== '' && v != null)) n = i + 1; }); return n; },
    getLastColumn() { let n = 0; sh.data.forEach((row) => row.forEach((v, j) => { if (v !== '' && v != null) n = Math.max(n, j + 1); })); return n; },
    getMaxColumns() { return sh.maxCols; }, getMaxRows() { return sh.maxRows; },
    insertColumnsAfter(_, n) { sh.maxCols += n; }, insertRowsAfter(_, n) { sh.maxRows += n; },
    getRange(r, c, nr, nc) { return makeRange(sh, r, c, nr || 1, nc || 1); },
    setFrozenRows(n) { sh.frozen = n; },
    appendRow(row) { sh.data.push(row.slice()); },
    setConditionalFormatRules(rules) { sh.meta.rules = rules; },
    getConditionalFormatRules() { return sh.meta.rules; },
    getProtections() { return sh.meta.protections; }
  });
  return sh;
}

function makeSpreadsheet() {
  const sheets = {};
  return {
    sheets,
    getSheetByName: (n) => sheets[n] || null,
    insertSheet(n) { sheets[n] = makeSheet(n); return sheets[n]; },
    getOwner: () => ({ getEmail: () => 'owner@x.test' })
  };
}

function ruleBuilder() {
  const o = { spec: {} };
  const set = (k) => (...a) => { o.spec[k] = a; return o; };
  ['whenTextContains', 'whenTextEqualTo', 'whenFormulaSatisfied', 'setBackground', 'setFontColor', 'setRanges',
    'requireValueInList', 'setAllowInvalid'].forEach((k) => { o[k] = set(k); });
  o.build = () => JSON.parse(JSON.stringify(o.spec));
  return o;
}

/** Build a fresh sandbox with the GAS globals stubbed and the named project files loaded. */
function loadGas(files, opts) {
  opts = opts || {};
  const ss = opts.ss || makeSpreadsheet();
  const cacheStore = {};
  const propStore = Object.assign({}, opts.props || {});
  const state = { activeEmail: opts.email || '', logs: [], cachePuts: 0, now: 0, fetchCalls: [], sleeps: [],
    fetchHandler: opts.fetch || null, cacheStore, propStore, templates: [] };
  const sandbox = {
    console, JSON, Math, Date, Object, Array, String, Number, isFinite, parseFloat, Error,
    Logger: { log: (m) => state.logs.push(String(m)) },
    Session: { getActiveUser: () => ({ getEmail: () => { if (state.throwIdentity) throw new Error('no'); return state.activeEmail; } }),
               getScriptTimeZone: () => 'Asia/Kolkata' },
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ss,
      newDataValidation: ruleBuilder, newConditionalFormatRule: ruleBuilder,
      ProtectionType: { RANGE: 'RANGE' },
      getUi: () => { throw new Error('no ui'); }
    },
    CacheService: { getScriptCache: () => ({
      get: (k) => { const e = cacheStore[k]; return e && e.exp > state.now ? e.v : null; },
      put: (k, v, ttl) => { state.cachePuts++; cacheStore[k] = { v, exp: state.now + ttl * 1000 }; },
      remove: (k) => { delete cacheStore[k]; } }) },
    Utilities: { formatDate: () => '2026-11-19 10:00:00',
      sleep: (ms) => { state.sleeps.push(ms); },
      DigestAlgorithm: { SHA_256: 'SHA_256' }, Charset: { UTF_8: 'UTF_8' },
      computeDigest: (alg, text) => Array.from(crypto.createHash('sha256').update(String(text), 'utf8').digest()).map((b) => (b > 127 ? b - 256 : b)) },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: (k) => (Object.prototype.hasOwnProperty.call(propStore, k) ? propStore[k] : null),
      setProperty: (k, v) => { propStore[k] = String(v); } }) },
    UrlFetchApp: { fetch: (url, o) => {
      state.fetchCalls.push({ url, method: o && o.method, headers: (o && o.headers) || {}, payload: o && o.payload });
      if (!state.fetchHandler) throw new Error('no fetch handler');
      const r = state.fetchHandler(url, o);
      return { getResponseCode: () => r.status, getContentText: () => (typeof r.body === 'string' ? r.body : JSON.stringify(r.body)) };
    } },
    HtmlService: { createTemplateFromFile: (name) => { const t = { name, evaluate: () => ({ setWidth() { return this; }, setHeight() { return this; } }) }; state.templates.push(t); return t; } }
  };
  vm.createContext(sandbox);
  files.forEach((f) => vm.runInContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), sandbox, { filename: f }));
  return { run: (code) => vm.runInContext(code, sandbox), ss, state, sandbox };
}

/** Everything a re-run could change, as one string. Formatting is the set of distinct calls: re-applying the same format is not a change. */
function snapshot(ss) {
  return JSON.stringify(Object.keys(ss.sheets).sort().map((n) => {
    const s = ss.sheets[n];
    return [n, s.data, s.frozen, s.maxCols, s.maxRows, [...new Set(s.meta.fmt.map((f) => JSON.stringify(f)))].sort(), s.meta.validation, s.meta.rules,
      s.meta.protections.map((p) => [p._desc, p._editors, p._domain])];
  }));
}

module.exports = { loadGas, makeSpreadsheet, snapshot };
