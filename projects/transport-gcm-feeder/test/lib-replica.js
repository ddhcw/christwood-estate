'use strict';
// A copy of the GCM library's fill_ and tidyBody_ (06_Template.gs), used to render
// the draft templates exactly as the sweeper would. Kept in sync by hand; the
// test that reads the real library file (if present) checks the source text.
function fill_(template, vals) {
  const lower = {};
  Object.keys(vals || {}).forEach((k) => { lower[k.toLowerCase().trim()] = vals[k]; });
  return String(template || '').replace(/\{\{\s*([^}]+?)\s*\}\}/g, (m, k) => {
    const optional = /\?$/.test(k);
    const name = optional ? k.replace(/\?\s*$/, '').trim() : k;
    const v = lower[name.toLowerCase()];
    if (v === undefined || v === null || v === '') return optional ? '' : m;
    return String(v);
  });
}
function tidyBody_(text) {
  return String(text || '').replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').replace(/^\n+|\n+$/g, '');
}
/** What the sweeper does with an OUTBOX row's Values (JSON): lower-cased keys, strings, then fill and tidy. */
function render(body, valuesJson) {
  const v = JSON.parse(valuesJson), pseudo = {};
  Object.keys(v).forEach((k) => { pseudo[k.toLowerCase()] = String(v[k]); });
  return tidyBody_(fill_(body, pseudo));
}
module.exports = { fill_, tidyBody_, render };
