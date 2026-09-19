/**
 * Christwood ICT — Projects Tracker
 * Install.js — puts an identical Suggestions tab into a project's own file.
 *
 * With 21 files and growing, the failure mode is column drift: three
 * vocabularies for one concept, then a migration project at 40 files
 * (SUGGESTIONS_SYSTEM.md §4.9). One click, structurally identical, every time.
 *
 * Only ~7 projects can host a tab at all. The rest are Drive folders or have
 * nothing built yet, and they use the master tab instead (C6) — this dialog
 * shows you which is which rather than pretending otherwise.
 */

// ---------- Dialog ----------

function showInstallDialog() {
  var html = HtmlService.createHtmlOutput(installDialogHtml_())
    .setWidth(560).setHeight(560);
  SpreadsheetApp.getUi().showModalDialog(html, 'Add a Suggestions tab to a project');
}

/**
 * Every project, sorted into what can host a tab and what cannot.
 * Called from the dialog.
 */
function getInstallCandidates() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var projects = readProjects_(resolveTrackerSheet_(ss));
  var out = { ready: [], installed: [], blocked: [] };

  projects.forEach(function (p) {
    if (!p.fileId) {
      out.blocked.push({
        name: p.name,
        reason: p.linkKind === 'folder'
          ? 'This is a Drive folder of many files — there is no single home for a tab.'
          : 'Nothing built yet — no spreadsheet to attach to.'
      });
      return;
    }
    try {
      var target = SpreadsheetApp.openById(p.fileId);
      var tab = target.getSheetByName(CONFIG.TAB.SUGGESTIONS);
      if (tab) {
        var canonical = !detectLegacyMapping_(readTable_(tab).headers);
        (canonical ? out.installed : out.ready).push({
          name: p.name, fileId: p.fileId,
          note: canonical ? 'Already set up' : 'Has an old-schema tab — installing will convert it'
        });
      } else {
        out.ready.push({ name: p.name, fileId: p.fileId, note: 'Ready to install' });
      }
    } catch (e) {
      out.blocked.push({ name: p.name, reason: 'Cannot open the file: ' + e.message });
    }
  });

  return out;
}

/** Called from the dialog with the chosen project names. */
function installIntoProjects(names) {
  return guarded_('installIntoProjects', function () {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var byName = {};
    readProjects_(resolveTrackerSheet_(ss)).forEach(function (p) { byName[p.name] = p; });

    var done = [];
    (names || []).forEach(function (name) {
      var p = byName[name];
      if (!p || !p.fileId) { done.push('✗ ' + name + ' — no spreadsheet'); return; }
      try {
        done.push('✓ ' + name + ' — ' + installSuggestionsTab_(p.fileId, p.name));
      } catch (e) {
        done.push('✗ ' + name + ' — ' + e.message);
      }
    });

    clearBootstrapCache_();
    audit_('Install', '', names.join(', '), 'Suggestions tabs installed', done.join(' · '));
    return done.join('\n');
  });
}

// ---------- The install itself ----------

/**
 * Creates the canonical tab, or converts an existing legacy one.
 * Never destroys rows: a legacy tab is renamed to a dated backup first.
 */
function installSuggestionsTab_(fileId, projectName) {
  var ss  = withRetry_('open:' + projectName, function () { return SpreadsheetApp.openById(fileId); }, 3, 500);
  var tab = ss.getSheetByName(CONFIG.TAB.SUGGESTIONS);

  if (tab) {
    var mapping = detectLegacyMapping_(readTable_(tab).headers);
    if (mapping) {
      var n = convertLegacyTab_(fileId, projectName);
      return 'converted ' + n + ' existing rows';
    }
    // Canonical already — just repair the visual layer and any missing column.
    ensureProjectColumns_(tab);
    decorateProjectTab_(tab, projectName);
    return 'already set up, formatting refreshed';
  }

  var names = columnNames_(suggestionColumns_());
  tab = ss.insertSheet(CONFIG.TAB.SUGGESTIONS, 0);
  tab.getRange(1, 1, 1, names.length).setValues([names]);
  if (tab.getMaxColumns() > names.length) {
    tab.deleteColumns(names.length + 1, tab.getMaxColumns() - names.length);
  }
  decorateProjectTab_(tab, projectName);
  return 'new tab created';
}

function ensureProjectColumns_(tab) {
  var t = readTable_(tab);
  var missing = columnNames_(suggestionColumns_()).filter(function (n) {
    return t.idx[normalizeKey_(n)] === undefined;
  });
  if (!missing.length) return;
  var start = Math.max(tab.getLastColumn(), 1) + 1;
  if (tab.getMaxColumns() < start + missing.length - 1) {
    tab.insertColumnsAfter(tab.getMaxColumns(), start + missing.length - 1 - tab.getMaxColumns());
  }
  tab.getRange(1, start, 1, missing.length).setValues([missing]);
}

/**
 * Formatting, dropdowns, column notes, and warning-protection on the columns
 * ICT owns. The grey columns are the "ICT will fill this in" signal — nobody
 * should waste a minute typing into a cell the sync overwrites tonight.
 */
function decorateProjectTab_(tab, projectName) {
  formatSuggestionsSheet_(tab, false);

  var t = readTable_(tab);
  suggestionColumns_().forEach(function (c) {
    var n = colNum_(t, c.name);
    if (n && c.note) tab.getRange(1, n).setNote(c.note);
  });

  // A one-line explanation living in the sheet, where the person actually is.
  var refCol = colNum_(t, 'Ref');
  if (refCol) {
    tab.getRange(1, refCol).setNote(
      'Suggestions for: ' + projectName + '\n\n' +
      'Type a row whenever something occurs to you — a bug, an addition, an improvement.\n' +
      'Fill in Type, Suggestion, Details and your name. That is all.\n' +
      'ICT fills the grey columns. You will see the answer appear right here.\n\n' +
      'Do not edit or delete the Ref — it is what keeps your row linked.'
    );
  }

  // Warning-only, not a hard lock: these files have editors we cannot enumerate,
  // and locking someone out of their own sheet is worse than a stray edit the
  // sync corrects tonight.
  tab.getProtections(SpreadsheetApp.ProtectionType.RANGE).forEach(function (p) {
    if (/^\[tracker\]/.test(p.getDescription() || '')) p.remove();
  });

  writebackColumns_().forEach(function (name) {
    var n = colNum_(t, name);
    if (!n) return;
    var p = tab.getRange(2, n, Math.max(tab.getMaxRows() - 1, 1), 1)
      .protect()
      .setDescription('[tracker] ' + name + ' is filled in by ICT');
    p.setWarningOnly(true);
  });

  tab.activate();
}

// ---------- Dialog markup ----------

function installDialogHtml_() {
  return '' +
'<style>' +
' body{font-family:Inter,-apple-system,Segoe UI,sans-serif;font-size:13px;color:#1A1A1A;margin:0;padding:16px;}' +
' h3{margin:0 0 4px;font-size:14px;color:#1C4E9D;}' +
' p.sub{margin:0 0 14px;color:#5F6469;font-size:12px;line-height:1.5;}' +
' .grp{margin-bottom:16px;}' +
' .grp h4{margin:0 0 6px;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#5F6469;}' +
' label{display:flex;gap:8px;align-items:flex-start;padding:7px 9px;border:1px solid #E3E7EB;border-radius:8px;margin-bottom:5px;cursor:pointer;line-height:1.4;}' +
' label:hover{background:#F5F8FC;}' +
' label.off{opacity:.65;cursor:default;background:#FAFBFC;}' +
' .nm{font-weight:600;}' +
' .rs{color:#5F6469;font-size:11.5px;display:block;}' +
' button{background:#1C4E9D;color:#fff;border:0;border-radius:8px;padding:10px 18px;font:inherit;font-weight:600;cursor:pointer;}' +
' button:disabled{background:#8A9096;cursor:default;}' +
' #out{white-space:pre-wrap;margin-top:12px;font-size:12px;color:#2E7D32;}' +
' .bar{position:sticky;bottom:0;background:#fff;padding-top:10px;}' +
'</style>' +
'<h3>Add a Suggestions tab</h3>' +
'<p class="sub">Creates a tab with exactly the same columns as every other project, so nothing drifts. ' +
'Existing tabs on the old schema are converted — the old rows are kept in a dated backup tab.</p>' +
'<div id="body">Loading projects…</div>' +
'<div class="bar"><button id="go" disabled onclick="run()">Install</button></div>' +
'<div id="out"></div>' +
'<script>' +
'var READY=[];' +
'google.script.run.withSuccessHandler(render).withFailureHandler(function(e){' +
'  document.getElementById("body").textContent="Could not load: "+e.message;}).getInstallCandidates();' +
'function esc(s){return String(s||"").replace(/[&<>"]/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;"}[c];});}' +
'function render(d){' +
'  READY=d.ready;var h="";' +
'  if(d.ready.length){h+=\'<div class="grp"><h4>Can host a tab (\'+d.ready.length+\')</h4>\';' +
'    d.ready.forEach(function(p,i){h+=\'<label><input type="checkbox" checked value="\'+esc(p.name)+\'"><span><span class="nm">\'+esc(p.name)+\'</span><span class="rs">\'+esc(p.note)+\'</span></span></label>\';});h+="</div>";}' +
'  if(d.installed.length){h+=\'<div class="grp"><h4>Already set up (\'+d.installed.length+\')</h4>\';' +
'    d.installed.forEach(function(p){h+=\'<label class="off"><input type="checkbox" value="\'+esc(p.name)+\'"><span><span class="nm">\'+esc(p.name)+\'</span><span class="rs">Tick to refresh its formatting</span></span></label>\';});h+="</div>";}' +
'  if(d.blocked.length){h+=\'<div class="grp"><h4>Use the master tab instead (\'+d.blocked.length+\')</h4>\';' +
'    d.blocked.forEach(function(p){h+=\'<label class="off"><span><span class="nm">\'+esc(p.name)+\'</span><span class="rs">\'+esc(p.reason)+\'</span></span></label>\';});h+="</div>";}' +
'  document.getElementById("body").innerHTML=h||"No projects found.";' +
'  document.getElementById("go").disabled=false;' +
'}' +
'function run(){' +
'  var names=[].slice.call(document.querySelectorAll("input:checked")).map(function(c){return c.value;});' +
'  if(!names.length){document.getElementById("out").textContent="Nothing selected.";return;}' +
'  var b=document.getElementById("go");b.disabled=true;b.textContent="Installing "+names.length+"…";' +
'  google.script.run.withSuccessHandler(function(r){document.getElementById("out").textContent=r;b.textContent="Done";})' +
'    .withFailureHandler(function(e){document.getElementById("out").style.color="#C0271F";' +
'      document.getElementById("out").textContent=e.message;b.disabled=false;b.textContent="Install";})' +
'    .installIntoProjects(names);' +
'}' +
'</script>';
}
