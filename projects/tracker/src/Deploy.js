/**
 * Deploy.js — the approval-gated deploy path.
 *
 * A Lead ticks Approve on the Automated Runs tab. Within the hour, on Tuesdays
 * and Thursdays between 09:00 and 17:00, this merges the pull request, writes
 * the merged files into the target Apps Script project, cuts a version, and
 * repoints the live deployment at it.
 *
 * RFC-0003 governs every choice here. Three are worth restating because they
 * are what keeps this safe:
 *
 *   1. AUTHORISATION IS THE SHEET'S, NOT OURS. The Approve column is protected
 *      to Leads. Google enforces that. We never ask a client who it is
 *      (non-negotiable #6) because we never have to — if the box is ticked, a
 *      Lead ticked it.
 *
 *   2. DEPLOYED BYTES ARE REVIEWED BYTES. Content is fetched from GitHub at the
 *      exact merge SHA recorded when the row was approved. If anything moved
 *      since Dan looked, the row is refused, not deployed.
 *
 *   3. THE TARGET COMES FROM THE REPO. Script IDs are read from each project's
 *      committed .clasp.json. Editing a cell cannot aim a deploy at another
 *      script.
 *
 * One stage, by decision: approve means live. Rollback is therefore not
 * optional — every deploy records the version it replaced.
 */

var DEPLOY_TAB      = 'Automated Runs';
var SCRIPT_API      = 'https://script.googleapis.com/v1';
var DEPLOY_WEEKDAYS = [2, 4];   // Tue, Thu (JS getDay)
var DEPLOY_FROM_H   = 9;
var DEPLOY_TO_H     = 17;

/** Never deploys itself. A bad push would break the pusher. RFC-0003. */
var DEPLOY_EXCLUDED = ['tracker'];


// ---------- entry points ----------

/** Hourly trigger, Tue & Thu. Checks its own window so a stray trigger is harmless. */
function deployApproved() {
  return guarded_('deployApproved', function () {
    var now = new Date();
    var day  = Number(Utilities.formatDate(now, CONFIG.TIMEZONE, 'u')) % 7;  // 0=Sun
    var hour = Number(Utilities.formatDate(now, CONFIG.TIMEZONE, 'H'));
    if (DEPLOY_WEEKDAYS.indexOf(day) === -1 || hour < DEPLOY_FROM_H || hour >= DEPLOY_TO_H) {
      return { skipped: true, reason: 'outside the Tue/Thu 09-17 window' };
    }
    return deployRun_('scheduled');
  });
}

/** §6 manual twin. Same logic, no window check — Dan asked for it, Dan gets it. */
function deployApprovedNow() {
  return guarded_('deployApprovedNow', function () { return deployRun_('manual'); });
}

/** Reads GitHub and refreshes the Automated Runs tab. Changes nothing else. */
function refreshAutomatedRuns() {
  return guarded_('refreshAutomatedRuns', function () { return runsRefresh_(); });
}


// ---------- the deploy pass ----------

function deployRun_(mode) {
  if (!ghEnabled_()) return { skipped: true, reason: 'GitHub bridge not configured' };

  var lock = acquireLock_(30000);
  try {
    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(DEPLOY_TAB);
    if (!sheet) return { skipped: true, reason: 'no ' + DEPLOY_TAB + ' tab' };

    var t = readTable_(sheet);
    var done = [], refused = [], failed = [];

    for (var i = 0; i < t.rows.length; i++) {
      var row = t.rows[i];
      if (isBlankRow_(row)) continue;

      var ref   = str_(t, row, 'Ref');
      var state = str_(t, row, 'Deploy state');

      if (isTrue_(cell_(t, row, 'Rollback'))) {
        var rb = deployRollback_(sheet, t, row, ref);
        (rb.ok ? done : failed).push(ref + ' rollback: ' + rb.note);
        continue;
      }

      if (!isTrue_(cell_(t, row, 'Approve'))) continue;
      if (state === 'Live' || state === 'Deploying') continue;   // idempotent (#8)

      var out = deployOne_(sheet, t, row);
      if (out.ok)            done.push(ref + ': ' + out.note);
      else if (out.refused)  refused.push(ref + ': ' + out.note);
      else                   failed.push(ref + ': ' + out.note);
    }

    var summary = 'Deploy (' + mode + ') | ' + done.length + ' deployed' +
                  (refused.length ? ' · ' + refused.length + ' refused' : '') +
                  (failed.length  ? ' · ' + failed.length + ' failed'  : '');
    audit_('Deploy', '', '', summary +
           (done.length ? ' | ' + done.join(' · ') : '') +
           (refused.length ? ' | REFUSED: ' + refused.join(' · ') : ''));

    if (failed.length || refused.length) {
      opsAlert_('OPS_SYNC', '⚠️ Deploy needs attention', [
        ['Deployed', String(done.length)],
        ['Refused',  refused.join(', ') || '—'],
        ['Failed',   failed.join(', ')  || '—'],
        ['When',     fmtDateTime_(new Date())]
      ], { signature: 'deploy|' + refused.concat(failed).join(','), force: false });
    }
    return { done: done, refused: refused, failed: failed };
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

function deployOne_(sheet, t, row) {
  var ref     = str_(t, row, 'Ref');
  var slug    = str_(t, row, 'Project slug');
  var prNum   = String(str_(t, row, 'PR')).replace(/[^0-9]/g, '');
  var seenSha = str_(t, row, 'Reviewed SHA');

  var set = function (col, val) { deploySet_(sheet, t, row, col, val); };

  if (DEPLOY_EXCLUDED.indexOf(slug) !== -1) {
    set('Deploy state', 'Refused');
    set('Deploy note', slug + ' never deploys itself — push it by hand (RFC-0003).');
    return { refused: true, note: 'excluded project' };
  }
  if (!slug || !prNum) {
    set('Deploy state', 'Refused');
    set('Deploy note', 'Missing project slug or PR number. Run Refresh.');
    return { refused: true, note: 'incomplete row' };
  }

  set('Deploy state', 'Deploying');
  set('Approved on', fmtDateTime_(new Date()));

  // 1. The PR must be open-and-mergeable, or already merged by someone.
  var pr = ghFetch_('get', '/repos/' + ghRepo_() + '/pulls/' + prNum);
  if (pr.code !== 200) return deployFail_(set, 'GitHub ' + pr.code + ' reading PR #' + prNum);

  // 2. Nothing may have moved since Dan reviewed it.
  var headSha = pr.body.head && pr.body.head.sha;
  if (seenSha && headSha && seenSha !== headSha) {
    set('Approve', false);                       // force a fresh look
    set('Deploy state', 'Refused');
    set('Deploy note', 'The branch changed after you approved it (' +
        seenSha.substr(0, 7) + ' → ' + headSha.substr(0, 7) + '). Re-review, then tick again.');
    return { refused: true, note: 'changed since approval' };
  }

  // 3. Merge it. The Sheet is the single surface, by decision (RFC-0003 Q2).
  var mergeSha = pr.body.merged ? pr.body.merge_commit_sha : null;
  if (!mergeSha) {
    var m = ghFetch_('put', '/repos/' + ghRepo_() + '/pulls/' + prNum + '/merge', {
      merge_method: 'squash',
      commit_title: '[' + ref + '] ' + (pr.body.title || '') + ' (#' + prNum + ')',
      sha: headSha
    });
    if (m.code !== 200) {
      return deployFail_(set, 'Merge refused: HTTP ' + m.code + ' ' + (m.body.message || ''));
    }
    mergeSha = m.body.sha;
    audit_('Deploy', ref, slug, 'PR #' + prNum + ' merged by approval');
  }

  // 4. Fetch the files as merged — not from any working copy.
  var files = deployFetchFiles_(slug, mergeSha);
  if (files.error) return deployFail_(set, files.error);
  if (!files.list.length) return deployFail_(set, 'No pushable files found for ' + slug);

  var scriptId = deployScriptId_(slug, mergeSha);
  if (!scriptId) return deployFail_(set, 'No scriptId in projects/' + slug + '/.clasp.json');

  // 5. Snapshot what is there now, so rollback has something to restore.
  var before = scriptGet_(scriptId);
  if (before.error) return deployFail_(set, 'Could not read the target: ' + before.error);
  deployStash_(ref, scriptId, before.files);

  // 6. Write. The API replaces all files in one call, so this is atomic.
  var put = scriptPut_(scriptId, files.list);
  if (put.error) return deployFail_(set, 'Push failed: ' + put.error);

  // 7. Cut a version and repoint the live deployment at it. One stage.
  var ver = scriptVersion_(scriptId, ref + ' — approved by ' + str_(t, row, 'Approved by') +
                                     ' ' + todayStr_());
  if (ver.error) return deployFail_(set, 'Pushed, but versioning failed: ' + ver.error);

  var live = deployLiveDeployment_(scriptId);
  var promoted = '';
  if (live) {
    var up = scriptPromote_(scriptId, live, ver.versionNumber, ref + ' ' + todayStr_());
    promoted = up.error ? ' ⚠️ pushed and versioned, but the live deployment did NOT move: ' + up.error
                        : ' Live deployment now on v' + ver.versionNumber + '.';
  } else {
    promoted = ' No versioned web-app deployment found — code is on HEAD only.';
  }

  set('Previous version', String(before.versionHint || ''));
  set('Deployed version', String(ver.versionNumber));
  set('Deployed on', fmtDateTime_(new Date()));
  set('Deploy state', live && promoted.indexOf('⚠️') === -1 ? 'Live' : 'Pushed');
  set('Deploy note', files.list.length + ' files at ' + mergeSha.substr(0, 7) + '.' +
      promoted + deployTriggerWarning_(files.list));
  return { ok: true, note: 'v' + ver.versionNumber };
}

function deployFail_(set, msg) {
  set('Deploy state', 'Failed');
  set('Deploy note', msg + ' — still approved; it will retry next run.');
  return { ok: false, note: msg };
}


// ---------- rollback ----------

function deployRollback_(sheet, t, row, ref) {
  var set = function (c, v) { deploySet_(sheet, t, row, c, v); };
  var slug = str_(t, row, 'Project slug');
  var stash = deployUnstash_(ref);
  if (!stash) {
    set('Rollback', false);
    set('Deploy note', 'Nothing stashed for ' + ref + ' — cannot roll back automatically.');
    return { ok: false, note: 'no snapshot' };
  }
  var scriptId = stash.scriptId;
  var put = scriptPut_(scriptId, stash.files);
  if (put.error) { set('Deploy note', 'Rollback failed: ' + put.error); return { ok: false, note: put.error }; }

  var ver = scriptVersion_(scriptId, 'ROLLBACK of ' + ref + ' ' + todayStr_());
  var live = deployLiveDeployment_(scriptId);
  if (live && !ver.error) scriptPromote_(scriptId, live, ver.versionNumber, 'Rollback ' + ref);

  set('Rollback', false);
  set('Approve', false);
  set('Deploy state', 'Rolled back');
  set('Deploy note', 'Restored the content from before ' + ref +
      (ver.versionNumber ? ' as v' + ver.versionNumber : '') + '. Approve is now clear.');
  audit_('Deploy', ref, slug, 'Rolled back');
  return { ok: true, note: 'restored' };
}

/** Snapshots live in Script Properties, not the Sheet — they are large and not for reading. */
function deployStash_(ref, scriptId, files) {
  try {
    PropertiesService.getScriptProperties()
      .setProperty('ROLLBACK_' + ref, JSON.stringify({ scriptId: scriptId, files: files }));
  } catch (e) {
    audit_('Deploy', ref, '', 'Could not stash a rollback snapshot: ' + e.message);
  }
}

function deployUnstash_(ref) {
  return safeJson_(PropertiesService.getScriptProperties().getProperty('ROLLBACK_' + ref), null);
}


// ---------- GitHub content ----------

function deployFetchFiles_(slug, sha) {
  var base = 'projects/' + slug;
  var tree = ghFetch_('get', '/repos/' + ghRepo_() + '/git/trees/' + sha + '?recursive=1');
  if (tree.code !== 200) return { error: 'GitHub ' + tree.code + ' reading the tree' };

  var wanted = (tree.body.tree || []).filter(function (n) {
    if (n.type !== 'blob') return false;
    if (n.path.indexOf(base + '/') !== 0) return false;              // inside this project only
    return /\.(js|gs|html)$/.test(n.path) || /\/appsscript\.json$/.test(n.path);
  });

  var out = [];
  for (var i = 0; i < wanted.length; i++) {
    var n = wanted[i];
    var blob = ghFetch_('get', '/repos/' + ghRepo_() + '/git/blobs/' + n.sha);
    if (blob.code !== 200) return { error: 'GitHub ' + blob.code + ' reading ' + n.path };

    var rel  = n.path.substring(base.length + 1);
    var name = rel.replace(/\.(js|gs|html|json)$/, '');
    var type = /\.html$/.test(rel) ? 'HTML'
             : /appsscript\.json$/.test(rel) ? 'JSON' : 'SERVER_JS';
    out.push({
      name: type === 'JSON' ? 'appsscript' : name,
      type: type,
      source: Utilities.newBlob(Utilities.base64Decode(blob.body.content || '')).getDataAsString()
    });
  }
  return { list: out };
}

function deployScriptId_(slug, sha) {
  var res = ghFetch_('get', '/repos/' + ghRepo_() + '/contents/projects/' + slug +
                            '/.clasp.json?ref=' + sha);
  if (res.code !== 200) return null;
  var txt = Utilities.newBlob(Utilities.base64Decode(res.body.content || '')).getDataAsString();
  return (safeJson_(txt, {}) || {}).scriptId || null;
}

/** Names the risk rather than leaving it implicit. Triggers run HEAD. */
function deployTriggerWarning_(files) {
  var hasTriggers = files.some(function (f) {
    return f.type === 'SERVER_JS' && /ScriptApp\.newTrigger|timeBased\(\)/.test(f.source);
  });
  return hasTriggers
    ? ' ⚠️ This project has time-driven triggers, which run HEAD code — they will use this build on their next fire.'
    : '';
}


// ---------- Apps Script API ----------

function scriptFetch_(method, path, payload) {
  return withRetry_('scriptapi:' + method + ' ' + path, function () {
    var res = UrlFetchApp.fetch(SCRIPT_API + path, {
      method: method,
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
      payload: payload ? JSON.stringify(payload) : undefined,
      muteHttpExceptions: true
    });
    var code = res.getResponseCode();
    if (code >= 500 || code === 429) throw new Error('Apps Script API ' + code);
    return { code: code, body: safeJson_(res.getContentText(), {}) };
  }, 3, 1000);
}

function scriptGet_(scriptId) {
  var r = scriptFetch_('get', '/projects/' + scriptId + '/content');
  if (r.code !== 200) return { error: scriptApiHint_(r) };
  return { files: r.body.files || [], versionHint: r.body.scriptId ? 'HEAD' : '' };
}

function scriptPut_(scriptId, files) {
  var r = scriptFetch_('put', '/projects/' + scriptId + '/content', { files: files });
  if (r.code !== 200) return { error: scriptApiHint_(r) };
  return { ok: true };
}

function scriptVersion_(scriptId, description) {
  var r = scriptFetch_('post', '/projects/' + scriptId + '/versions',
                       { description: description.substr(0, 255) });
  if (r.code !== 200) return { error: scriptApiHint_(r) };
  return { versionNumber: r.body.versionNumber };
}

/** The web-app deployment carrying the /exec URL staff use. */
function deployLiveDeployment_(scriptId) {
  var r = scriptFetch_('get', '/projects/' + scriptId + '/deployments');
  if (r.code !== 200) return null;
  var found = null;
  (r.body.deployments || []).forEach(function (d) {
    var cfg = d.deploymentConfig || {};
    if (!cfg.versionNumber) return;                 // @HEAD, not the live one
    var isWebApp = (d.entryPoints || []).some(function (e) { return e.entryPointType === 'WEB_APP'; });
    if (isWebApp && !found) found = d.deploymentId;
  });
  return found;
}

function scriptPromote_(scriptId, deploymentId, versionNumber, description) {
  var r = scriptFetch_('put', '/projects/' + scriptId + '/deployments/' + deploymentId, {
    deploymentConfig: {
      scriptId: scriptId,
      versionNumber: versionNumber,
      manifestFileName: 'appsscript',
      description: description.substr(0, 255)
    }
  });
  if (r.code !== 200) return { error: scriptApiHint_(r) };
  return { ok: true };
}

/** A 403 here is almost always one specific missing setting. Say so. */
function scriptApiHint_(r) {
  var msg = (r.body.error && r.body.error.message) || r.body.message || '';
  if (r.code === 403 && /API|disabled|permission/i.test(msg)) {
    return 'HTTP 403 — enable the Apps Script API at ' +
           'script.google.com/home/usersettings, and check the tracker has the ' +
           'script.projects scope. (' + msg + ')';
  }
  return 'HTTP ' + r.code + ' ' + msg;
}


// ---------- small helpers ----------

function isTrue_(v) {
  return v === true || String(v).trim().toUpperCase() === 'TRUE';
}

function deploySet_(sheet, t, row, header, value) {
  var c = colNum_(t, header);
  if (c) sheet.getRange(row.index, c).setValue(value);
}
