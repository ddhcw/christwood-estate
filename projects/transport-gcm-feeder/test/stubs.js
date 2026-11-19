'use strict';
// Minimal Apps Script stubs for node --test. Not a faithful emulation: only the
// calls FeedLogic.js and Feed.js make. Sheets are plain 2D arrays. Every
// setValues call is recorded in sheet.writes so tests can assert "one batch" and
// "no existing row touched".
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function makeSheet(name) {
  const sh = { name, data: [], maxRows: 1000, writes: [] };
  const cell = (r, c) => { const v = (sh.data[r - 1] || [])[c - 1]; return v === undefined ? '' : v; };
  Object.assign(sh, {
    getLastRow() { let n = 0; sh.data.forEach((row, i) => { if (row.some((v) => v !== '' && v != null)) n = i + 1; }); return n; },
    getLastColumn() { let n = 0; sh.data.forEach((row) => row.forEach((v, j) => { if (v !== '' && v != null) n = Math.max(n, j + 1); })); return n; },
    getMaxRows() { return sh.maxRows; },
    insertRowsAfter(_, n) { sh.maxRows += n; },
    getRange(r, c, nr, nc) {
      nr = nr || 1; nc = nc || 1;
      return {
        getValues() { const out = []; for (let i = 0; i < nr; i++) { const row = []; for (let j = 0; j < nc; j++) row.push(cell(r + i, c + j)); out.push(row); } return out; },
        getDisplayValues() { return this.getValues().map((row) => row.map((v) => (v instanceof Date ? v.toISOString() : String(v)))); },
        setValues(vals) {
          if (sh.failWrites) throw new Error('sheet write failed');
          sh.writes.push([r, c, vals.length, vals[0] ? vals[0].length : 0]);
          for (let i = 0; i < vals.length; i++) {
            while (sh.data.length < r + i) sh.data.push([]);
            for (let j = 0; j < vals[i].length; j++) sh.data[r - 1 + i][c - 1 + j] = vals[i][j];
          }
        },
        setValue(v) { this.setValues([[v]]); }
      };
    }
  });
  return sh;
}

function makeSpreadsheet() {
  const sheets = {};
  return { sheets, getSheetByName: (n) => sheets[n] || null, addSheet(n, rows) { const s = makeSheet(n); s.data = rows.map((r) => r.slice()); sheets[n] = s; return s; } };
}

/** Load the feeder's own files into a sandbox with GAS globals stubbed. */
function loadFeeder(opts) {
  opts = opts || {};
  const books = opts.books || {};
  const props = Object.assign({}, opts.props || {});
  const state = { logs: [], fetches: [], mails: [], sleeps: [], triggers: [], lockBusy: false, lockCalls: 0, locksHeld: 0,
    fetchHandler: opts.fetch || (() => ({ status: 200, body: 'ok' })), flushes: 0 };
  const sandbox = {
    console, JSON, Math, Date, Object, Array, String, Number, isFinite, parseFloat, Error, RegExp,
    Logger: { log: (m) => state.logs.push(String(m)) },
    Session: { getEffectiveUser: () => ({ getEmail: () => 'feeder@x.test' }), getActiveUser: () => ({ getEmail: () => 'person@x.test' }) },
    MailApp: { sendEmail: (m) => { state.mails.push(m); } },
    Utilities: { sleep: (ms) => state.sleeps.push(ms) },
    LockService: { getScriptLock: () => ({
      tryLock: () => { state.lockCalls++; if (state.lockBusy) return false; state.locksHeld++; return true; },
      releaseLock: () => { state.locksHeld--; } }) },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: (k) => (Object.prototype.hasOwnProperty.call(props, k) ? props[k] : null),
      setProperty: (k, v) => { props[k] = String(v); },
      deleteProperty: (k) => { delete props[k]; } }) },
    SpreadsheetApp: {
      openById: (id) => { if (!books[id]) throw new Error('no such sheet'); return books[id]; },
      flush: () => { state.flushes++; },
      getUi: () => { throw new Error('no ui'); }
    },
    UrlFetchApp: { fetch: (url, o) => {
      state.fetches.push({ url, payload: o && o.payload });
      const r = state.fetchHandler(url, o);
      return { getResponseCode: () => r.status };
    } },
    ScriptApp: { getProjectTriggers: () => state.triggers.slice(), deleteTrigger: (t) => { state.triggers = state.triggers.filter((x) => x !== t); },
      newTrigger: (fn) => { const t = { fn, getHandlerFunction: () => fn }; const b = { timeBased() { return b; }, everyMinutes(n) { t.minutes = n; return b; }, atHour(h) { t.hour = h; return b; }, everyDays(n) { t.days = n; return b; }, create() { state.triggers.push(t); return t; } }; return b; } }
  };
  vm.createContext(sandbox);
  ['FeedLogic.js', 'Feed.js'].forEach((f) => vm.runInContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), sandbox, { filename: f }));
  return { run: (code) => vm.runInContext(code, sandbox), state, props, sandbox };
}

module.exports = { loadFeeder, makeSpreadsheet, makeSheet };
