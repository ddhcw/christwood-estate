/**
 * Runs.js — the Automated Runs tab: setup, refresh, and protection.
 *
 * One row per agent pull request. Everyone with the sheet can read it. The
 * Approve and Rollback columns are protected to Leads, and that protection is
 * the authorisation model (RFC-0003) — Google enforces it, so no code here
 * asks a client who it is.
 */

var RUNS_COLUMNS = [
  { name: 'Run date',       w: 130, owner: 'sync',   note: 'When the agent opened this pull request.' },
  { name: 'Project',        w: 200, owner: 'sync',   note: 'Project name as it appears in the tracker.' },
  { name: 'Project slug',   w: 100, owner: 'sync',   note: 'Folder under projects/ in the repo. Used to find the script — do not edit.' },
  { name: 'Ref',            w: 110, owner: 'sync',   note: 'Links back to the Suggestions row.' },
  { name: 'Ticket',         w: 120, owner: 'sync',   note: 'The ticket file the agent worked from.' },
  { name: 'Issue',          w: 70,  owner: 'sync',   note: 'GitHub issue number.' },
  { name: 'PR',             w: 70,  owner: 'sync',   note: 'Pull request number.' },
  { name: 'PR link',        w: 260, owner: 'sync',   note: 'Open this and read it before you approve.' },
  { name: 'Actions taken',  w: 420, owner: 'sync',   note: 'The agent\'s own summary of what it changed.' },
  { name: 'Could not verify', w: 420, owner: 'sync', note: 'What the agent could NOT check. It has no Apps Script runtime and executes nothing. Read this.' },
  { name: 'Files',          w: 260, owner: 'sync',   note: 'Files this PR touches.' },
  { name: 'PR state',       w: 100, owner: 'sync',   note: 'Open / Merged / Closed, from GitHub.' },
  { name: 'Reviewed SHA',   w: 90,  owner: 'sync',   note: 'The commit you reviewed. If the branch moves after you approve, the deploy refuses.' },
  { name: 'Approve',        w: 90,  owner: 'LEAD',   note: 'Tick to merge and deploy this, live, within the hour. Leads only.' },
  { name: 'Approved by',    w: 190, owner: 'deploy', note: 'Filled by the deploy job.' },
  { name: 'Approved on',    w: 130, owner: 'deploy', note: 'Filled by the deploy job.' },
  { name: 'Deploy state',   w: 120, owner: 'deploy', note: 'Not ready / Ready / Deploying / Live / Pushed / Refused / Failed / Rolled back.' },
  { name: 'Deployed version', w: 90, owner: 'deploy', note: 'Apps Script version number now serving.' },
  { name: 'Previous version', w: 90, owner: 'deploy', note: 'What it replaced — the rollback target.' },
  { name: 'Deployed on',    w: 130, owner: 'deploy', note: 'Filled by the deploy job.' },
  { name: 'Deploy note',    w: 420, owner: 'deploy', note: 'What happened, or why it refused.' },
  { name: 'Rollback',       w: 90,  owner: 'LEAD',   note: 'Tick to restore what was there before this deploy. Leads only.' }
];

var RUNS_STATES = ['Not ready', 'Ready', 'Deploying', 'Live', 'Pushed',
                   'Refused', 'Failed', 'Rolled back'];


// ---------- setup ----------

/** Idempotent (#4), visual layer included. Safe to run any number of times. */
function setupAutomatedRuns() {
  return guarded_('setupAutomatedRuns', function () {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(DEPLOY_TAB) || ss.insertSheet(DEPLOY_TAB);
    var did = [];

    // Headers — add missing ones, never reorder or drop (#10).
    var have = sheet.getLastColumn()
      ? sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String)
      : [];
    RUNS_COLUMNS.forEach(function (c) {
      var at = have.indexOf(c.name);
      if (at === -1) {
        at = have.length;
        sheet.getRange(1, at + 1).setValue(c.name);
        have.push(c.name);
        did.push('+' + c.name);
      }
      sheet.setColumnWidth(at + 1, c.w);
      sheet.getRange(1, at + 1).setNote(c.note);
    });

    var lastCol = have.length;
    sheet.getRange(1, 1, 1, lastCol)
      .setFontWeight('bold').setBackground('#1e3a5f').setFontColor('#ffffff')
      .setVerticalAlignment('middle').setWrap(true);
    sheet.setFrozenRows(1);
    sheet.setRowHeight(1, 44);

    var rows = Math.max(sheet.getMaxRows() - 1, 1);
    var col  = function (n) { return have.indexOf(n) + 1; };

    // Checkboxes, and a closed list for the state.
    [ 'Approve', 'Rollback' ].forEach(function (n) {
      sheet.getRange(2, col(n), rows, 1)
        .setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build())
        .setHorizontalAlignment('center');
    });
    sheet.getRange(2, col('Deploy state'), rows, 1).setDataValidation(
      SpreadsheetApp.newDataValidation().requireValueInList(RUNS_STATES, true)
        .setAllowInvalid(true).build());

    // Status colours, always paired with the word itself — never colour alone.
    var band = function (value, bg, fg) {
      return SpreadsheetApp.newConditionalFormatRule()
        .whenTextEqualTo(value).setBackground(bg).setFontColor(fg)
        .setRanges([sheet.getRange(2, col('Deploy state'), rows, 1)]).build();
    };
    sheet.setConditionalFormatRules([
      band('Live',        '#d7efdc', '#0b5c26'),   // done — green
      band('Pushed',      '#d7efdc', '#0b5c26'),
      band('Deploying',   '#fdf0d0', '#7a4f01'),   // pending — amber
      band('Ready',       '#fdf0d0', '#7a4f01'),
      band('Not ready',   '#ebedf0', '#4a4f57'),   // stale — grey
      band('Rolled back', '#ebedf0', '#4a4f57'),
      band('Refused',     '#fbdcdc', '#8c1c1c'),   // error — red
      band('Failed',      '#fbdcdc', '#8c1c1c')
    ]);

    sheet.getRange(2, 1, rows, lastCol).setVerticalAlignment('top').setWrap(false);
    [ 'Actions taken', 'Could not verify', 'Deploy note' ].forEach(function (n) {
      sheet.getRange(2, col(n), rows, 1).setWrap(true);
    });

    did.push(runsProtect_(sheet, have));

    // Triggers: refresh first so the tab is current, then deploy.
    var have2 = {};
    ScriptApp.getProjectTriggers().forEach(function (x) { have2[x.getHandlerFunction()] = true; });
    if (!have2.deployApproved) {
      // Hourly; deployApproved() checks the Tue/Thu 09-17 window itself, so a
      // fire outside it costs one cheap no-op rather than needing 16 triggers.
      ScriptApp.newTrigger('deployApproved').timeBased().everyHours(1).create();
      did.push('trigger deployApproved (hourly, gated to Tue/Thu 09-17)');
    }
    if (!have2.refreshAutomatedRuns) {
      ScriptApp.newTrigger('refreshAutomatedRuns').timeBased()
        .onWeekDay(ScriptApp.WeekDay.SATURDAY).atHour(8)
        .inTimezone(CONFIG.TIMEZONE).create();
      did.push('trigger refreshAutomatedRuns (Sat 08:00)');
    }

    audit_('Setup', '', '', 'setupAutomatedRuns | ' + (did.join(' · ') || 'already set up'));
    return did.join(' · ') || 'already set up';
  });
}

/**
 * Locks the whole tab to Leads, then opens every column EXCEPT Approve and
 * Rollback back up. Result: anyone may read, only a Lead may tick.
 *
 * This is the authorisation model. It is deliberately Google's protection
 * rather than a check in our code, because our code cannot see who is looking
 * (WebApp.js:6) and a protected range cannot be bypassed by anyone.
 */
function runsProtect_(sheet, headers) {
  var leads = ghLeadEmails_();
  if (!leads.length) return 'protection SKIPPED — no Lead with an email in the Staff tab';

  sheet.getProtections(SpreadsheetApp.ProtectionType.RANGE)
       .forEach(function (p) { p.remove(); });

  var rows = Math.max(sheet.getMaxRows() - 1, 1);
  ['Approve', 'Rollback'].forEach(function (n) {
    var c = headers.indexOf(n) + 1;
    if (!c) return;
    var p = sheet.getRange(2, c, rows, 1).protect()
      .setDescription(n + ' — Leads only (RFC-0003)');
    p.removeEditors(p.getEditors());
    p.addEditors(leads);
    try { p.setDomainEdit(false); } catch (e) {}
  });
  return 'Approve + Rollback locked to: ' + leads.join(', ');
}


// ---------- refresh from GitHub ----------

function runsRefresh_() {
  if (!ghEnabled_()) return { skipped: true, reason: 'GitHub bridge not configured' };

  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(DEPLOY_TAB);
  if (!sheet) return { skipped: true, reason: 'run setupAutomatedRuns first' };

  var res = ghFetch_('get', '/repos/' + ghRepo_() + '/pulls?state=all&per_page=100&sort=created&direction=desc');
  if (res.code !== 200) return { error: 'GitHub ' + res.code };

  var t       = readTable_(sheet);
  var byPr    = {};
  t.rows.forEach(function (r) {
    var n = String(str_(t, r, 'PR')).replace(/[^0-9]/g, '');
    if (n) byPr[n] = r;
  });

  var added = 0, updated = 0, appends = [];
  var headers = t.headers.map(String);

  (res.body || []).forEach(function (pr) {
    if (String(pr.head && pr.head.ref || '').indexOf('agent/') !== 0) return;  // agent PRs only

    var ref   = (String(pr.title).match(/\[(S-[0-9A-F]{8})\]/i) || [])[1] || '';
    var body  = String(pr.body || '');
    var state = pr.merged_at ? 'Merged' : (pr.state === 'closed' ? 'Closed' : 'Open');

    var rec = {
      'Run date':         fmtDateTime_(new Date(pr.created_at)),
      'Ref':              ref,
      'Issue':            (body.match(/Closes #(\d+)/i) || [])[1] || '',
      'PR':               pr.number,
      'PR link':          pr.html_url,
      'Actions taken':    runsSection_(body, 'What changed'),
      'Could not verify': runsSection_(body, 'Could not verify'),
      'PR state':         state,
      'Reviewed SHA':     (pr.head && pr.head.sha || '').substr(0, 40),
      'Project slug':     (body.match(/projects\/([a-z0-9\-_]+)/i) || [])[1] || ''
    };

    var existing = byPr[String(pr.number)];
    if (existing) {
      // Never overwrite the human columns or the deploy job's own record.
      ['PR state', 'Could not verify', 'Actions taken', 'Reviewed SHA'].forEach(function (k) {
        var c = colNum_(t, k);
        if (c && String(str_(t, existing, k)) !== String(rec[k] || '')) {
          sheet.getRange(existing.index, c).setValue(rec[k] || '');
          updated++;
        }
      });
      var ds = colNum_(t, 'Deploy state');
      if (ds && !str_(t, existing, 'Deploy state')) {
        sheet.getRange(existing.index, ds).setValue(state === 'Open' ? 'Ready' : 'Not ready');
      }
      return;
    }

    rec['Project']      = runsProjectName_(rec['Project slug']);
    rec['Ticket']       = (body.match(/(TICKET-\d+)/) || [])[1] || '';
    rec['Files']        = '';
    rec['Deploy state'] = state === 'Merged' ? 'Not ready' : 'Ready';
    appends.push(headers.map(function (h) { return rec[h] === undefined ? '' : rec[h]; }));
    added++;
  });

  if (appends.length) {
    sheet.getRange(sheet.getLastRow() + 1, 1, appends.length, headers.length)
         .setValues(appends);                       // one write (#3)
  }

  audit_('Deploy', '', '', 'Automated Runs refreshed | ' + added + ' new · ' + updated + ' updated');
  return { added: added, updated: updated };
}

/** Pulls one "## Heading" section out of a PR body. */
function runsSection_(body, heading) {
  var re = new RegExp('##\\s*' + heading + '\\s*\\n([\\s\\S]*?)(?=\\n##\\s|$)', 'i');
  var m  = body.match(re);
  return m ? m[1].trim().substr(0, 4000) : '';
}

/** Maps a repo folder back to the tracker's project name, so the tab reads in English. */
function runsProjectName_(slug) {
  if (!slug) return '';
  var map = {
    purchase:  'Digital MRN/PRN (Purchase Requisition Automation)',
    transport: 'Transport Management System',
    calllog:   'Official Phone Call Logs Tracking System',
    tracker:   'Christwood Projects Tracker'
  };
  return map[slug] || titleCase_(slug);
}
