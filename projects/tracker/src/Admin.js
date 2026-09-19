/**
 * Christwood ICT — Projects Tracker
 * Admin.js — the Sheet menu, trigger management, and the small dialogs.
 *
 * Triggers are installed programmatically and existing ones deleted first —
 * the classic "ten copies of the same trigger" bug is a house footgun, not a
 * hypothetical. One nightly sweep dispatches everything rather than a timer
 * per feature.
 */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🧩 Tracker Tools')
    .addItem('Sync now', 'syncNow')
    .addItem('Open items — quick view', 'showOpenItemsDialog')
    .addSeparator()
    .addItem('Add a Suggestions tab to a project…', 'showInstallDialog')
    .addSubMenu(SpreadsheetApp.getUi().createMenu('First-time setup')
      .addItem('1 · Set up / repair all tabs', 'menuSetup')
      .addItem('2 · Check what the migration would change', 'menuMigrationReport')
      .addItem('3 · Apply the migration', 'menuApplyMigration')
      .addItem('4 · Seed the open threads', 'menuSeedThreads')
      .addItem('5 · Install / repair triggers', 'installTriggers'))
    .addSubMenu(SpreadsheetApp.getUi().createMenu('Notifications')
      .addItem('Set a webhook URL…', 'menuSetWebhook')
      .addItem('Send a test message', 'menuTestWebhook')
      .addItem('Send the weekly digest now', 'menuSendDigest')
      .addItem('Refresh webhook status', 'refreshWebhookStatus'))
    .addSubMenu(SpreadsheetApp.getUi().createMenu('Maintenance')
      .addItem('Sync health', 'menuSyncHealth')
      .addItem('System check', 'showSystemCheck')
      .addItem('Back up now', 'menuBackup')
      .addItem('Clear the web app cache', 'menuClearCache')
      .addItem('Remove all triggers', 'removeTriggers'))
    .addToUi();
}

// ---------- Menu wrappers (a dialog, never a silent return) ----------

function menuSetup() {
  var msg = setupSheets();
  ui_().alert('Setup complete', msg + '\n\nNext: "Check what the migration would change".', ui_().ButtonSet.OK);
}

function menuMigrationReport() {
  var text = migrationReportText_(migrationReport());
  showTextDialog_('What the migration would change', text, 620, 560);
}

function menuApplyMigration() {
  var r = ui_().alert('Apply the migration?',
    'This blanks the placeholder owner sentences, folds duplicate name spellings, and converts ' +
    'old-schema Suggestions tabs in the project files.\n\n' +
    'Every project tab is backed up to a dated copy first. Nothing is deleted.\n\n' +
    'Have you read the report?', ui_().ButtonSet.YES_NO);
  if (r !== ui_().Button.YES) return;
  showTextDialog_('Migration applied', applyMigration(), 560, 420);
}

function menuSeedThreads() {
  var r = ui_().alert('Seed the open threads?',
    'Adds the live threads and blocked items recorded in the design brief (§8) to the master ' +
    'Suggestions tab.\n\nSome may have closed off-log since — check them afterwards.\n\n' +
    'Running this twice does not duplicate anything.', ui_().ButtonSet.YES_NO);
  if (r !== ui_().Button.YES) return;
  showTextDialog_('Threads seeded', seedOpenThreads(), 560, 420);
}

function menuBackup()      { ui_().alert(nightlyBackup()); }
function menuSendDigest()  { ui_().alert(sendWeeklyDigest()); }

function menuClearCache() {
  clearBootstrapCache_();
  clearSettingsCache_();
  ui_().alert('Cache cleared — the web app will rebuild from the sheet on the next load.');
}

function menuSyncHealth() {
  var props = PropertiesService.getScriptProperties();
  var last  = Number(props.getProperty('LAST_SYNC_OK') || 0);
  var s     = lastSyncSummary_();
  var pending = safeJson_(props.getProperty('SYNC_PENDING'), null);

  var triggers = ScriptApp.getProjectTriggers().map(function (t) {
    return '  • ' + t.getHandlerFunction() + ' (' + t.getEventType() + ')';
  });

  var failing = [];
  var all = props.getProperties();
  Object.keys(all).forEach(function (k) {
    if (k.indexOf('FAILSTREAK_') === 0) failing.push('  • ' + k.replace('FAILSTREAK_', '') + ' — ' + all[k] + ' runs in a row');
  });

  var lines = [
    'Last good sync: ' + (last ? fmtDateTime_(new Date(last)) + '  (' + Math.round((Date.now() - last) / 3600000) + 'h ago)' : 'never'),
    s ? 'Last run: ' + s.files + ' files, ' + s.imported + ' new, ' + s.updated + ' updated, ' + s.archived + ' archived' : '',
    pending && pending.length ? 'Deferred to the next run: ' + pending.join(', ') : '',
    '',
    'Triggers installed (' + triggers.length + '):',
    triggers.length ? triggers.join('\n') : '  ⚠️ none — run "Install / repair triggers"',
    '',
    failing.length ? 'Currently failing:\n' + failing.join('\n') : 'Nothing is currently failing.',
    '',
    'Webhooks configured:',
    webhookCatalogue_().map(function (w) {
      return '  ' + (getWebhook_(w[0]) ? '✅' : '—') + ' ' + w[0];
    }).join('\n')
  ].filter(function (l) { return l !== ''; });

  showTextDialog_('Sync health', lines.join('\n'), 560, 520);
}

// ---------- System check (RFC-002 / T-201 + T-202) ----------

/**
 * "What is live" in one dialog, in ten seconds. Two halves:
 *   1. Runtime state    — deployment, triggers, sync age, webhooks, Config.
 *   2. Data integrity   — stranded suggestions, schema drift, staff hygiene,
 *                         unowned live systems.
 *
 * READ-ONLY. This reports; it never writes a cell or a Script Property, and
 * it never fixes anything it finds — that is a deliberate non-goal (RFC-002).
 * Opening a project file can fail on its own, so check 2 (schema drift) wraps
 * each file open in withRetry_ and contains the failure to that one file —
 * one unreadable spreadsheet must not blank the rest of the report.
 */
function showSystemCheck() {
  return guarded_('showSystemCheck', function () {
    var lines = [].concat(
      ['IS IT RUNNING?', ''],
      runtimeStateLines_(),
      ['', 'IS THE DATA COHERENT?', ''],
      dataIntegrityLines_()
    );
    showTextDialog_('System check', lines.join('\n'), 620, 620);
  });
}

// ---------- Half one: runtime state (T-201) ----------

function runtimeStateLines_() {
  var props = PropertiesService.getScriptProperties();
  var s = getSettings_();

  var lines = [];

  // Script id + deployments. The Apps Script runtime has no ScriptApp method
  // that lists a project's deployments — that only exists in the advanced
  // Apps Script API (script.googleapis.com), which this project does not
  // enable. Say so honestly rather than guessing, and hand over the command
  // that actually answers it.
  lines.push('Script id: ' + ScriptApp.getScriptId());
  lines.push('Deployments: not readable from Apps Script — the ScriptApp ' +
    'service has no deployment listing. Run this from the project folder:');
  lines.push('  clasp list-deployments');
  lines.push('(The @HEAD entry is the dev deployment; the versioned one is production.)');
  lines.push('');

  // Triggers.
  var triggers = ScriptApp.getProjectTriggers();
  var handlerSchedule = {
    syncNightly:     '01:00 daily',
    nightlyBackup:   '02:00 daily',
    heartbeatCheck:  '09:00 daily',
    sendWeeklyDigest: (s.weekly_digest_day || 'Monday') + ' ' + (s.weekly_digest_hour || 8) + ':00'
  };
  lines.push('Triggers installed (' + triggers.length + '):');
  if (!triggers.length) {
    lines.push('  ⚠️ none — run "Install / repair triggers"');
  } else {
    triggers.forEach(function (t) {
      var fn = t.getHandlerFunction();
      lines.push('  • ' + fn + ' — ' + (handlerSchedule[fn] || t.getEventType()));
    });
  }
  lines.push('');

  // Last good sync.
  var last = Number(props.getProperty('LAST_SYNC_OK') || 0);
  if (last) {
    var hours = (Date.now() - last) / 3600000;
    var verdict = hours < 36 ? 'Healthy' : '⚠️ Overdue — the heartbeat should have alerted';
    lines.push('Last good sync: ' + fmtDateTime_(new Date(last)) + '  (' + Math.round(hours) + 'h ago) — ' + verdict);
  } else {
    lines.push('Last good sync: never');
  }

  var summary = lastSyncSummary_();
  lines.push(summary
    ? 'Last run: ' + summary.files + ' files, ' + summary.imported + ' new, ' +
      summary.updated + ' updated, ' + summary.archived + ' archived' +
      (summary.failed ? ', ' + summary.failed + ' failed' : '')
    : 'Last run: no summary recorded yet.');
  lines.push('');

  // Webhooks.
  var webhooks = webhookCatalogue_();
  var set = webhooks.filter(function (w) { return getWebhook_(w[0]); }).length;
  lines.push('Webhooks: ' + set + ' of ' + webhooks.length + ' configured');
  webhooks.forEach(function (w) {
    lines.push('  ' + (getWebhook_(w[0]) ? '✅' : '—') + ' ' + w[0]);
  });
  lines.push('');

  // Config values that change behaviour.
  var behaviourKeys = ['sync_enabled', 'writeback_enabled', 'central_delivery', 'backup_enabled', 'notify_raiser_on_close'];
  lines.push('Config that changes behaviour:');
  behaviourKeys.forEach(function (k) {
    var v = s[k];
    lines.push('  ' + k + ' = ' + (v === undefined ? '(not in Config tab)' : String(v)));
  });

  return lines;
}

// ---------- Half two: data integrity (T-202) ----------

function dataIntegrityLines_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var tracker = resolveTrackerSheet_(ss);
  var master = ss.getSheetByName(CONFIG.TAB.SUGGESTIONS);
  var projects = readProjects_(tracker);

  var lines = [];

  lines = lines.concat(strandedSuggestionLines_(master, projects));
  lines.push('');
  lines = lines.concat(schemaDriftLines_(projects));
  lines.push('');
  lines = lines.concat(staffHygieneLines_(ss));
  lines.push('');
  lines = lines.concat(unownedLiveSystemLines_(projects));

  return lines;
}

/**
 * Check 1 — stranded suggestions: a master row whose Project owns a spread-
 * sheet (a fileId) but whose Pushed fingerprint is blank. A blank Pushed on a
 * project that is a Drive folder (no fileId) is normal — that project has no
 * Suggestions tab to push into — and must NOT be reported.
 */
function strandedSuggestionLines_(master, projects) {
  var out = ['Stranded suggestions (owns a file, never pushed down):'];
  if (!master) { out.push('  No "' + CONFIG.TAB.SUGGESTIONS + '" tab found.'); return out; }

  var byName = {};
  projects.forEach(function (p) { byName[p.name.toLowerCase()] = p; });

  var t = readTable_(master);
  var stranded = [];
  t.rows.forEach(function (row) {
    if (isBlankRow_(row)) return;
    var ref = str_(t, row, 'Ref');
    if (!ref) return;
    var pushed = str_(t, row, 'Pushed');
    if (pushed) return;

    var projectName = str_(t, row, 'Project');
    var p = byName[projectName.toLowerCase()];
    if (!p || !p.fileId) return;   // no spreadsheet to have pushed into — not stranded

    stranded.push(ref + ' — ' + projectName);
  });

  out.push('  ' + stranded.length + ' found' + (stranded.length ? ':' : '.'));
  stranded.forEach(function (s) { out.push('    • ' + s); });
  return out;
}

/**
 * Check 2 — schema drift: each project's own Suggestions tab, column count
 * against the canonical schema. Opens every project file that has one, so a
 * single unreadable file is contained here and reported, not thrown.
 */
function schemaDriftLines_(projects) {
  var out = ['Schema drift (project Suggestions tab vs. canonical columns):'];
  var wantCols = columnNames_(suggestionColumns_()).length;
  var behind = [];
  var failed = [];

  projects.filter(function (p) { return p.fileId; }).forEach(function (p) {
    try {
      var fileSs = withRetry_('system-check:open:' + p.name, function () {
        return SpreadsheetApp.openById(p.fileId);
      }, 3, 600);
      var tab = fileSs.getSheetByName(CONFIG.TAB.SUGGESTIONS);
      if (!tab) return;   // no tab yet — not drift, just not installed

      var have = readTable_(tab).headers.length;
      if (have < wantCols) behind.push(p.name + ' — ' + have + ' of ' + wantCols + ' columns');
    } catch (err) {
      failed.push(p.name + ': ' + (err && err.message ? err.message : String(err)));
    }
  });

  out.push('  ' + behind.length + ' behind' + (behind.length ? ':' : '.'));
  behind.forEach(function (b) { out.push('    • ' + b); });
  if (failed.length) {
    out.push('  ' + failed.length + ' file(s) could not be opened (skipped, not counted as drift):');
    failed.forEach(function (f) { out.push('    • ' + f); });
  }
  return out;
}

/** Check 3 — Staff hygiene: active rows with no email, or a name under two characters. */
function staffHygieneLines_(ss) {
  var out = ['Staff hygiene (active, but no email or a one-letter name):'];
  var sheet = ss.getSheetByName(CONFIG.TAB.STAFF);
  if (!sheet) { out.push('  No "' + CONFIG.TAB.STAFF + '" tab found.'); return out; }

  var t = readTable_(sheet);
  var bad = [];
  t.rows.forEach(function (row) {
    if (isBlankRow_(row)) return;
    var name = str_(t, row, 'Name');
    if (!name) return;
    var active = String(cell_(t, row, 'Active')).toLowerCase();
    if (active === 'false') return;
    var email = str_(t, row, 'Email');
    if (!email || name.length < 2) {
      bad.push(name + (email ? '' : ' — no email') + (name.length < 2 ? ' — name too short' : ''));
    }
  });

  out.push('  ' + bad.length + ' found' + (bad.length ? ':' : '.'));
  bad.forEach(function (b) { out.push('    • ' + b); });
  return out;
}

/** Check 4 — Unowned live systems: Current Status matches /launch|live/i with an empty Owner. */
function unownedLiveSystemLines_(projects) {
  var out = ['Unowned live systems (Launched/Live with no Owner):'];
  var bad = projects.filter(function (p) {
    return /launch|live/i.test(p.status) && !p.owner;
  });
  out.push('  ' + bad.length + ' found' + (bad.length ? ':' : '.'));
  bad.forEach(function (p) { out.push('    • ' + p.name + ' (' + p.status + ')'); });
  return out;
}

// ---------- Webhooks ----------

function menuSetWebhook() {
  var keys = webhookCatalogue_().map(function (w) {
    return (getWebhook_(w[0]) ? '✅ ' : '— ') + w[0] + '  ·  ' + w[2];
  }).join('\n');

  var which = ui_().prompt('Which webhook?',
    'Type the key exactly as listed.\n\n' + keys +
    '\n\nOps webhooks all point at the SAME Ops Alerts space — name each one after its area ' +
    'in Chat, and the sender line tells you what is failing.',
    ui_().ButtonSet.OK_CANCEL);
  if (which.getSelectedButton() !== ui_().Button.OK) return;

  var key = String(which.getResponseText()).trim().toUpperCase();
  if (!key) return;

  var url = ui_().prompt('Webhook URL for ' + key,
    'Paste the Google Chat incoming-webhook URL.\n\nLeave blank and press OK to switch this channel off.\n\n' +
    'It is stored in Script Properties, never in the sheet — staff can read every tab, protected or not.',
    ui_().ButtonSet.OK_CANCEL);
  if (url.getSelectedButton() !== ui_().Button.OK) return;

  var value = String(url.getResponseText()).trim();
  if (value && !/^https:\/\/chat\.googleapis\.com\//.test(value)) {
    ui_().alert('That does not look like a Chat webhook URL. It should start with https://chat.googleapis.com/');
    return;
  }

  setWebhook_(key, value);
  refreshWebhookStatus();
  audit_('Webhook', '', '', (value ? 'Set' : 'Cleared') + ' webhook ' + key, '');
  ui_().alert(value ? key + ' is set.' : key + ' is switched off.');
}

function menuTestWebhook() {
  var which = ui_().prompt('Send a test message',
    'Which webhook key? e.g. OPS_SYNC', ui_().ButtonSet.OK_CANCEL);
  if (which.getSelectedButton() !== ui_().Button.OK) return;

  var key = String(which.getResponseText()).trim().toUpperCase();
  if (!getWebhook_(key)) { ui_().alert(key + ' has no URL set.'); return; }

  var ok = postChatCard_(key, '🔧 Test from the Projects Tracker',
    'If you can read this, ' + key + ' works',
    [['Sent', fmtDateTime_(new Date())],
     ['Meaning', 'This is the sender name you will see when something in this area fails.']],
    [{ text: 'Open tracker', url: masterSheetUrl_() }]);

  ui_().alert(ok ? 'Sent. Check the space.' : 'Failed to send — check the URL.');
}

// ---------- Triggers ----------

/**
 * One nightly sweep, one weekly digest, one daily heartbeat. Existing triggers
 * for these handlers are deleted first so re-running never stacks duplicates.
 */
function installTriggers() {
  return guarded_('installTriggers', function () {
    var handlers = ['syncNightly', 'sendWeeklyDigest', 'heartbeatCheck', 'nightlyBackup'];
    ScriptApp.getProjectTriggers().forEach(function (t) {
      if (handlers.indexOf(t.getHandlerFunction()) !== -1) ScriptApp.deleteTrigger(t);
    });

    var s = getSettings_();

    ScriptApp.newTrigger('syncNightly').timeBased().atHour(1).everyDays(1)
      .inTimezone(CONFIG.TIMEZONE).create();

    ScriptApp.newTrigger('nightlyBackup').timeBased().atHour(2).everyDays(1)
      .inTimezone(CONFIG.TIMEZONE).create();

    ScriptApp.newTrigger('heartbeatCheck').timeBased().atHour(9).everyDays(1)
      .inTimezone(CONFIG.TIMEZONE).create();

    var day = weekDayEnum_(s.weekly_digest_day || 'Monday');
    ScriptApp.newTrigger('sendWeeklyDigest').timeBased().onWeekDay(day)
      .atHour(Number(s.weekly_digest_hour) || 8).inTimezone(CONFIG.TIMEZONE).create();

    var msg = [
      'Nightly sync — 1am',
      'Nightly backup — 2am',
      'Heartbeat check — 9am (tells you if the sync died)',
      'Weekly digest — ' + (s.weekly_digest_day || 'Monday') + ' ' + (s.weekly_digest_hour || 8) + ':00'
    ].join('\n');

    audit_('Triggers', '', '', 'Triggers installed', msg.replace(/\n/g, ' · '));
    try { ui_().alert('Triggers installed\n\n' + msg + '\n\n(Times are approximate — Google runs them within about 15 minutes.)'); } catch (e) {}
    return msg;
  });
}

function removeTriggers() {
  var r = ui_().alert('Remove all triggers?',
    'The nightly sync, backup, heartbeat and weekly digest will all stop.\n\nNo data is lost.',
    ui_().ButtonSet.YES_NO);
  if (r !== ui_().Button.YES) return;

  var n = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); n++; });
  audit_('Triggers', '', '', 'All triggers removed', String(n));
  ui_().alert(n + ' triggers removed.');
}

function weekDayEnum_(name) {
  var map = {
    monday: ScriptApp.WeekDay.MONDAY, tuesday: ScriptApp.WeekDay.TUESDAY,
    wednesday: ScriptApp.WeekDay.WEDNESDAY, thursday: ScriptApp.WeekDay.THURSDAY,
    friday: ScriptApp.WeekDay.FRIDAY, saturday: ScriptApp.WeekDay.SATURDAY,
    sunday: ScriptApp.WeekDay.SUNDAY
  };
  return map[String(name).trim().toLowerCase()] || ScriptApp.WeekDay.MONDAY;
}

// ---------- Quick view inside the Sheet ----------

/**
 * The 15-minute triage list, in the sheet, without leaving for the web app.
 * Oldest first, because that is the order that matters.
 */
function showOpenItemsDialog() {
  var snap = buildSnapshot_();
  var rows = snap.items.slice(0, 60);

  var html = '<style>' +
    'body{font-family:Inter,-apple-system,Segoe UI,sans-serif;font-size:13px;margin:0;padding:16px;color:#1A1A1A;}' +
    'h3{margin:0 0 2px;font-size:14px;color:#1C4E9D;}p.s{margin:0 0 14px;color:#5F6469;font-size:12px;}' +
    'table{border-collapse:collapse;width:100%;}th{text-align:left;font-size:10.5px;text-transform:uppercase;' +
    'letter-spacing:.04em;color:#5F6469;border-bottom:1px solid #E3E7EB;padding:6px 8px;}' +
    'td{padding:7px 8px;border-bottom:1px solid #F0F3F6;vertical-align:top;line-height:1.4;}' +
    '.age{white-space:nowrap;color:#5F6469;font-size:11.5px;}.old{color:#C0271F;font-weight:600;}' +
    '.pill{font-size:10px;font-weight:700;padding:2px 7px;border-radius:6px;background:#EEF0F2;color:#5F6469;}' +
    '.blk{background:#FBEAE9;color:#C0271F;}.new{background:#FDF0D5;color:#9A6400;}' +
    '</style>' +
    '<h3>Open items — most urgent first</h3>' +
    '<p class="s">' + snap.stats.openItems + ' open · ' +
    (snap.stats.overdue ? '<b style="color:#C0271F">' + snap.stats.overdue + ' past deadline</b> · ' : '') +
    snap.stats.blocked + ' blocked · ' +
    snap.stats.stale + ' untouched for ' + snap.staleDays + '+ days</p>';

  if (!rows.length) {
    html += '<p>Nothing open. Either the triage meeting is working, or nobody is raising anything — ' +
            'worth knowing which.</p>';
  } else {
    html += '<table><tr><th>Age</th><th>Due</th><th>Project</th><th>Item</th>' +
            '<th>Type</th><th>Status</th><th>Who</th></tr>';
    rows.forEach(function (i) {
      html += '<tr>' +
        '<td class="age ' + (i.ageDays >= snap.staleDays ? 'old' : '') + '">' + esc_(i.ageLabel) + '</td>' +
        '<td class="age ' + (i.overdue ? 'old' : '') + '">' + esc_(i.dueLabel || '—') + '</td>' +
        '<td>' + esc_(i.project) + '</td>' +
        '<td>' + esc_(i.suggestion) +
          (i.waitingOn ? ' <span class="pill blk">waiting on ' + esc_(i.waitingOn) + '</span>' : '') + '</td>' +
        '<td><span class="pill">' + esc_(i.type) + '</span></td>' +
        '<td><span class="pill ' + (i.status === 'New' ? 'new' : '') + '">' + esc_(i.status) + '</span></td>' +
        '<td>' + esc_(i.assignee || i.owner || '—') + '</td>' +
      '</tr>';
    });
    html += '</table>';
    if (snap.items.length > rows.length) {
      html += '<p class="s">Showing 60 of ' + snap.items.length + '. The rest are in the Suggestions tab.</p>';
    }
  }

  SpreadsheetApp.getUi().showModalDialog(
    HtmlService.createHtmlOutput(html).setWidth(900).setHeight(560), 'Open items');
}

// ---------- Dialog helpers ----------

function ui_() { return SpreadsheetApp.getUi(); }

function esc_(s) {
  return String(s || '').replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
  });
}

function showTextDialog_(title, text, w, h) {
  var html = '<div style="font-family:Inter,-apple-system,Segoe UI,sans-serif;font-size:12.5px;' +
    'white-space:pre-wrap;line-height:1.55;color:#1A1A1A;padding:4px">' + esc_(text) + '</div>';
  SpreadsheetApp.getUi().showModalDialog(
    HtmlService.createHtmlOutput(html).setWidth(w || 560).setHeight(h || 460), title);
}
