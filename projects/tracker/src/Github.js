/**
 * Github.js — the bridge between the Suggestions tab and the estate repo.
 *
 * A row assigned to the agent becomes a GitHub Issue; the PR that comes back
 * is written into the row. That is the whole job.
 *
 * Deliberately NOT done here:
 *   - Issues are created WITHOUT the `approved` label. `approved` is what makes
 *     an issue eligible for an unattended run, and it is added by a human after
 *     a ticket with real acceptance criteria exists. A raw one-line suggestion
 *     is not a ticket. Automating issue creation is useful; automating approval
 *     would make the pipeline faster and worse.
 *   - Nothing here closes an issue or merges anything. The sheet follows the
 *     repo, never the other way round.
 */

// ---------- settings ----------

var GH_PROP_TOKEN = 'GITHUB_TOKEN';          // Script Property. Never in source.
var GH_API        = 'https://api.github.com';

/** Repo as "owner/name", from the Config tab. Blank disables the whole module. */
function ghRepo_() {
  return String(getSettings_().github_repo || '').trim();
}

function ghEnabled_() {
  return !!ghRepo_() && !!ghToken_();
}

function ghToken_() {
  return PropertiesService.getScriptProperties().getProperty(GH_PROP_TOKEN) || '';
}

/** The Status value that means "hand this to the agent". */
var GH_QUEUE_STATUS = 'Queued for agent';

/** The Assignee value that means the agent. Matched case-insensitively. */
var GH_ASSIGNEE = 'Claude';


// ---------- HTTP ----------

/**
 * One GitHub call, with backoff. Returns {code, body}. Never throws for a
 * non-2xx — callers decide, because a 422 "already exists" is not a failure.
 */
function ghFetch_(method, path, payload) {
  var token = ghToken_();
  if (!token) throw new Error('No ' + GH_PROP_TOKEN + ' in Script Properties.');

  return withRetry_('github:' + method + ' ' + path, function () {
    var res = UrlFetchApp.fetch(GH_API + path, {
      method: method,
      contentType: 'application/json',
      headers: {
        Authorization: 'Bearer ' + token,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'
      },
      payload: payload ? JSON.stringify(payload) : undefined,
      muteHttpExceptions: true
    });
    var code = res.getResponseCode();

    // 5xx and secondary-rate-limit 403s are worth another attempt; the rest are not.
    if (code >= 500 || code === 429) throw new Error('GitHub ' + code);

    return { code: code, body: safeJson_(res.getContentText(), {}) };
  }, 3, 800);
}


// ---------- push: sheet → issues ----------

/**
 * Nightly, and on demand. Creates an Issue for every queued row that has not
 * got one yet. Idempotent on Ref: re-running creates nothing new.
 */
function pushQueuedToGithub() {
  return guarded_('pushQueuedToGithub', function () { return ghPush_('nightly'); });
}

/** §6 manual twin — same logic, runnable from the menu without waiting. */
function pushQueuedToGithubNow() {
  return guarded_('pushQueuedToGithubNow', function () { return ghPush_('manual'); });
}

function ghPush_(mode) {
  if (!ghEnabled_()) {
    audit_('GitHub', '', '', 'Push skipped — github_repo or ' + GH_PROP_TOKEN + ' not set');
    return { skipped: true, reason: 'not configured' };
  }

  var lock = acquireLock_(20000);
  try {
    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(CONFIG.TAB.SUGGESTIONS);
    if (!sheet) return { skipped: true, reason: 'no Suggestions tab' };

    var table = readTable_(sheet);                  // one read (non-negotiable #3)
    var colIssue = colNum_(table, 'GH Issue');
    if (!colIssue) {
      audit_('GitHub', '', '', 'Push skipped — run Setup to add the GH Issue column');
      return { skipped: true, reason: 'missing columns' };
    }

    var leads   = ghLeadEmails_();
    var created = [], refused = [], failed = [], writes = [];
    var gateWarned = false;

    for (var i = 0; i < table.rows.length; i++) {
      var row = table.rows[i];
      if (isBlankRow_(row)) continue;

      // NOT normalizeStatus_() — it maps anything matching /queued/ onto
      // CONFIG.STATUS.ACCEPTED, so every ordinary "Accepted" row would look
      // queued and get pushed. Compare the literal value the dropdown writes.
      var status   = str_(table, row, 'Status').trim();
      var assignee = str_(table, row, 'Assignee');
      var ref      = str_(table, row, 'Ref');
      var existing = str_(table, row, 'GH Issue');

      if (status !== GH_QUEUE_STATUS) continue;
      if (assignee.toLowerCase() !== GH_ASSIGNEE.toLowerCase()) continue;
      if (existing) continue;                       // already pushed — idempotent
      if (!ref) { failed.push('(no Ref)'); continue; }

      // Server-side authorisation. The client never asserts its own role
      // (non-negotiable #6): only a Lead may hand work to the agent.
      var raisedBy = str_(table, row, 'Queued by');
      if (!colNum_(table, 'Queued by')) {
        // Honest state (#9): say the gate is off rather than imply it ran.
        if (!gateWarned) {
          audit_('GitHub', '', '', 'Lead gate NOT enforced — no "Queued by" column. Run Setup to add it.');
          gateWarned = true;
        }
      } else if (leads.length && raisedBy &&
                 leads.indexOf(raisedBy.toLowerCase()) === -1) {
        refused.push(ref);
        audit_('GitHub', ref, str_(table, row, 'Project'),
               'Refused — ' + raisedBy + ' is not a Lead. Only a Lead may queue agent work.');
        continue;
      }

      var made = ghCreateIssue_(table, row, ref);
      if (made.number) {
        writes.push({ rowIndex: row.index, col: colIssue, value: made.number });
        created.push(ref + ' → #' + made.number);
        audit_('GitHub', ref, str_(table, row, 'Project'),
               'Issue #' + made.number + ' created (no `approved` label — add it once a ticket exists)');
      } else {
        failed.push(ref + ': ' + made.error);
      }
    }

    ghWriteCells_(sheet, writes);                   // one write pass

    var summary = 'GitHub push (' + mode + ') | ' + created.length + ' created' +
                  (refused.length ? ' · ' + refused.length + ' refused (not a Lead)' : '') +
                  (failed.length  ? ' · ' + failed.length + ' failed' : '');
    audit_('GitHub', '', '', summary + (created.length ? ' | ' + created.join(' · ') : ''));

    if (failed.length) {
      opsAlert_('OPS_SYNC', '⚠️ GitHub push had failures', [
        ['Created', String(created.length)],
        ['Failed',  failed.join(', ')],
        ['When',    fmtDateTime_(new Date())]
      ], { signature: 'ghpush|' + failed.join(','), force: false });
    }
    return { created: created, refused: refused, failed: failed };
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

function ghCreateIssue_(table, row, ref) {
  var project    = str_(table, row, 'Project');
  var suggestion = str_(table, row, 'Suggestion');
  var details    = str_(table, row, 'Details');
  var raiser     = str_(table, row, 'Submitted by') || str_(table, row, 'Suggestor');
  var owner      = str_(table, row, 'Owner');
  var type       = str_(table, row, 'Type');
  var neededBy   = str_(table, row, 'Needed by');

  // An issue with this Ref may already exist from an earlier partial run.
  var found = ghFindByRef_(ref);
  if (found) return { number: found };

  var body = [
    'Ref: **' + ref + '**' + (type ? ' · Type: ' + type : ''),
    'Project: `' + project + '`',
    raiser ? 'Raised by: ' + raiser : '',
    owner ? 'Owner: ' + owner : '',
    neededBy ? 'Needed by: ' + neededBy : '',
    '',
    '### Suggestion, as raised',
    '',
    '> ' + String(suggestion || '(blank)').replace(/\n/g, '\n> '),
    details ? '\n' + details : '',
    '',
    '---',
    '',
    '⚠️ **Not yet eligible for an unattended run.** This issue was created',
    'automatically from the Projects Tracker and carries the raw suggestion, not',
    'a ticket. Before adding `approved`:',
    '',
    '1. Decide whether it needs an RFC (schema change, new trigger, change to who',
    '   gets notified, or more than one project). If so, write and Accept it first.',
    '2. Write `docs/tickets/TICKET-NNNN.md` with numbered acceptance criteria.',
    '3. Add `approved`.',
    '',
    'A one-line suggestion worked without acceptance criteria produces confident',
    'guesses. See `docs/WEEKLY-SPRINT.md`.',
    '',
    '_Created by the Projects Tracker sync._'
  ].filter(function (x) { return x !== ''; }).join('\n');

  var res = ghFetch_('post', '/repos/' + ghRepo_() + '/issues', {
    title: '[' + ref + '] ' + (suggestion || project || 'Suggestion').slice(0, 110),
    body: body,
    labels: ['claude-task']          // deliberately NOT 'approved'
  });

  if (res.code >= 200 && res.code < 300 && res.body.number) return { number: res.body.number };
  return { error: 'HTTP ' + res.code + ' ' + (res.body.message || '') };
}

/** Find an existing open-or-closed issue carrying this Ref in its title. */
function ghFindByRef_(ref) {
  var res = ghFetch_('get', '/search/issues?q=' +
    encodeURIComponent('repo:' + ghRepo_() + ' in:title "' + ref + '"'));
  if (res.code === 200 && res.body.items && res.body.items.length) {
    return res.body.items[0].number;
  }
  return null;
}


// ---------- pull: issues → sheet ----------

/**
 * Writes PR link and agent status back into the sheet, so the tracker stops
 * claiming a row is untouched when the agent has already opened a PR.
 * Honest state (non-negotiable #9): anything not finished reads as pending.
 */
function pullGithubStatus() {
  return guarded_('pullGithubStatus', function () { return ghPull_(); });
}

function pullGithubStatusNow() {
  return guarded_('pullGithubStatusNow', function () { return ghPull_(); });
}

function ghPull_() {
  if (!ghEnabled_()) return { skipped: true, reason: 'not configured' };

  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.TAB.SUGGESTIONS);
  if (!sheet) return { skipped: true };

  var table    = readTable_(sheet);
  var colPr    = colNum_(table, 'GH PR');
  var colState = colNum_(table, 'Agent Status');
  if (!colPr || !colState) return { skipped: true, reason: 'missing columns' };

  var writes = [], updated = 0;

  for (var i = 0; i < table.rows.length; i++) {
    var row = table.rows[i];
    if (isBlankRow_(row)) continue;

    var num = str_(table, row, 'GH Issue');
    if (!num) continue;

    var res = ghFetch_('get', '/repos/' + ghRepo_() + '/issues/' + num);
    if (res.code !== 200) continue;

    var labels = (res.body.labels || []).map(function (l) {
      return typeof l === 'string' ? l : l.name;
    });
    var state = ghDescribeState_(res.body.state, labels);

    // A PR that closes this issue, if any.
    var prUrl = '';
    var tl = ghFetch_('get', '/repos/' + ghRepo_() + '/issues/' + num + '/timeline?per_page=100');
    if (tl.code === 200 && Array.isArray(tl.body)) {
      tl.body.forEach(function (ev) {
        if (ev.event === 'cross-referenced' && ev.source && ev.source.issue &&
            ev.source.issue.pull_request) {
          prUrl = ev.source.issue.pull_request.html_url || ev.source.issue.html_url || prUrl;
        }
      });
    }

    if (prUrl && str_(table, row, 'GH PR') !== prUrl) {
      writes.push({ rowIndex: row.index, col: colPr, value: prUrl });
    }
    if (str_(table, row, 'Agent Status') !== state) {
      writes.push({ rowIndex: row.index, col: colState, value: state });
      updated++;
    }
  }

  ghWriteCells_(sheet, writes);
  audit_('GitHub', '', '', 'GitHub pull | ' + updated + ' rows updated');
  return { updated: updated };
}

/** Plain English, and never optimistic. Unknown reads as pending, not done. */
function ghDescribeState_(state, labels) {
  var has = function (n) { return labels.indexOf(n) !== -1; };
  if (state === 'closed')          return 'Closed in GitHub';
  if (has('blocked'))              return 'Blocked — RFC not accepted';
  if (has('awaiting-review'))      return 'PR open — waiting for Dan';
  if (has('investigate-only'))     return 'Investigation queued';
  if (has('approved'))             return 'Queued for the agent';
  return 'Needs a ticket before it can run';
}


// ---------- helpers ----------

/** Lead emails from the Staff tab. Empty list = gate disabled (fail open, logged). */
function ghLeadEmails_() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.TAB.STAFF);
  if (!sheet) return [];
  var t = readTable_(sheet), out = [];
  t.rows.forEach(function (r) {
    if (String(str_(t, r, 'Role')).toLowerCase().indexOf('lead') !== -1) {
      var e = str_(t, r, 'Email').toLowerCase();
      if (e) out.push(e);
    }
  });
  return out;
}

/** One setValue per changed cell, batched by row. Never rewrites the sheet. */
function ghWriteCells_(sheet, writes) {
  if (!writes.length) return;
  writes.forEach(function (w) {
    sheet.getRange(w.rowIndex, w.col).setValue(w.value);
  });
  SpreadsheetApp.flush();
}


// ---------- setup ----------

/**
 * Idempotent (non-negotiable #4). Run from the menu as many times as you like:
 * adds the four columns, the Config row, and the triggers, and adds nothing
 * twice. Touches no existing values.
 *
 * Deliberately self-contained rather than folded into setupSheets() — this is
 * new and separable, and keeping it apart means a problem here cannot break
 * the setup path the whole tracker depends on.
 */
function setupGithubBridge() {
  return guarded_('setupGithubBridge', function () {
    var ss   = SpreadsheetApp.getActiveSpreadsheet();
    var did  = [];

    // 1. Columns on Suggestions and Archive.
    [CONFIG.TAB.SUGGESTIONS, CONFIG.TAB.ARCHIVE].forEach(function (tabName) {
      var sheet = ss.getSheetByName(tabName);
      if (!sheet) return;
      var t = readTable_(sheet);
      ['GH Issue', 'GH PR', 'Agent Status', 'Queued by'].forEach(function (name) {
        if (colNum_(t, name)) return;
        var col = sheet.getLastColumn() + 1;
        sheet.insertColumnAfter(sheet.getLastColumn());
        sheet.getRange(1, col).setValue(name);
        sheet.setColumnWidth(col, name === 'GH PR' ? 240 : 130);
        did.push(tabName + '.' + name);
        t = readTable_(sheet);                 // re-read so the next check sees it
      });
    });

    // 2. Config row for the repo. Blank value = the bridge stays off.
    var cfg = ss.getSheetByName(CONFIG.TAB.CONFIG);
    if (cfg) {
      var ct = readTable_(cfg), found = false;
      ct.rows.forEach(function (r) {
        if (String(str_(ct, r, 'Setting')).trim() === 'github_repo') found = true;
      });
      if (!found) {
        cfg.appendRow(['github_repo', '',
          'owner/repo for the estate repository, e.g. ddhcw/christwood-estate. ' +
          'Blank disables the GitHub bridge entirely. The token lives in Script ' +
          'Properties as GITHUB_TOKEN, never here.']);
        did.push('Config.github_repo');
      }
      clearSettingsCache_();
    }

    // 3. Status dropdown gains "Queued for agent".
    var sug = ss.getSheetByName(CONFIG.TAB.SUGGESTIONS);
    if (sug) {
      var st = readTable_(sug), sc = colNum_(st, 'Status');
      if (sc && sug.getLastRow() > 1) {
        var rng  = sug.getRange(2, sc, Math.max(sug.getLastRow() - 1, 1), 1);
        var rule = rng.getDataValidation();
        var vals = (rule && rule.getCriteriaValues()[0]) ? rule.getCriteriaValues()[0].slice() : [];
        if (vals.length && vals.indexOf(GH_QUEUE_STATUS) === -1) {
          vals.push(GH_QUEUE_STATUS);
          rng.setDataValidation(
            SpreadsheetApp.newDataValidation()
              .requireValueInList(vals, true).setAllowInvalid(false).build());
          did.push('Status dropdown += "' + GH_QUEUE_STATUS + '"');
        }
      }
    }

    // 4. Triggers. Push before the window opens; pull after it shuts.
    var wanted = {
      pushQueuedToGithub: { day: ScriptApp.WeekDay.THURSDAY, hour: 18 },
      pullGithubStatus:   { day: ScriptApp.WeekDay.SATURDAY, hour: 8  }
    };
    var have = {};
    ScriptApp.getProjectTriggers().forEach(function (t) { have[t.getHandlerFunction()] = true; });
    Object.keys(wanted).forEach(function (fn) {
      if (have[fn]) return;
      ScriptApp.newTrigger(fn).timeBased()
        .onWeekDay(wanted[fn].day).atHour(wanted[fn].hour)
        .inTimezone(CONFIG.TIMEZONE).create();
      did.push('trigger ' + fn);
    });

    var msg = did.length ? did.join(' · ') : 'nothing to do — already set up';
    audit_('Setup', '', '', 'setupGithubBridge | ' + msg);
    return msg;
  });
}

/** Tells you what is and is not wired, without changing anything. */
function githubBridgeStatus() {
  var ss  = SpreadsheetApp.getActiveSpreadsheet();
  var sug = ss.getSheetByName(CONFIG.TAB.SUGGESTIONS);
  var t   = sug ? readTable_(sug) : null;
  var trg = {};
  ScriptApp.getProjectTriggers().forEach(function (x) { trg[x.getHandlerFunction()] = true; });

  return {
    repo:        ghRepo_() || '(not set in Config)',
    tokenSet:    !!ghToken_(),
    columns:     t ? ['GH Issue', 'GH PR', 'Agent Status', 'Queued by']
                      .filter(function (c) { return !colNum_(t, c); }) : ['(no tab)'],
    leadGate:    t && colNum_(t, 'Queued by') ? 'enforced' : 'NOT enforced',
    pushTrigger: !!trg.pushQueuedToGithub,
    pullTrigger: !!trg.pullGithubStatus,
    ready:       ghEnabled_()
  };
}
