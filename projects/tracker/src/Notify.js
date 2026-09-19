/**
 * Christwood ICT — Projects Tracker
 * Notify.js — Chat, email, audit log, and the error handler every entry point
 * is wrapped in.
 *
 * ANTI-DELUGE IS THE DESIGN, not a setting. A notification system nobody
 * mutes is one that almost never speaks. Four independent brakes:
 *
 *   1. Consecutive-failure threshold — one flaky night is silent. Only the
 *      second failure in a row for the same project says anything.
 *   2. Signature cooldown — the same project failing the same way does not
 *      re-announce itself for `alert_cooldown_hours`.
 *   3. Per-run ceiling — if nine projects break at once you get three alerts
 *      and one line saying "6 more". Never nine.
 *   4. Recovery is one line, once — not a matching celebration for every alert.
 *
 * Ops alerts all land in ONE space. Each project family posts through its own
 * webhook, so the Chat sender name is the diagnosis: you read "Admin Trackers"
 * before you read the message.
 */

/** Per-execution alert budget. GAS gives each run a fresh global scope. */
var ALERT_BUDGET_ = { used: 0, suppressed: 0 };

// ---------- The wrapper every entry point uses ----------

/**
 * Runs fn, and on failure posts function name + message to Ops Alerts before
 * rethrowing. Menu items, triggers and web-app endpoints all go through this.
 * Heartbeat catches dead; this catches dying.
 */
function guarded_(label, fn) {
  try {
    return fn();
  } catch (err) {
    var msg = (err && err.message) ? err.message : String(err);
    try {
      opsAlert_('OPS_SYNC', '⚠️ ' + label + ' failed', [
        ['Function', label],
        ['Error', msg],
        ['When', fmtDateTime_(new Date())]
      ], { signature: label + '|' + msg, force: true });
      audit_('Error', '', '', label + ' threw', msg);
    } catch (inner) { /* never let the error handler become the error */ }
    throw err;
  }
}

// ---------- Google Chat ----------

/**
 * Posts a card to a webhook. Returns true if it went out.
 * Silently no-ops when the webhook is unset — an unconfigured channel is off,
 * not broken.
 */
function postChatCard_(webhookKey, title, subtitle, rows, buttons) {
  var url = getWebhook_(webhookKey);
  if (!url) return false;

  var widgets = (rows || []).map(function (r) {
    return { decoratedText: { topLabel: String(r[0]), text: String(r[1]), wrapText: true } };
  });

  if (buttons && buttons.length) {
    widgets.push({
      buttonList: {
        buttons: buttons.map(function (b) {
          return { text: b.text, onClick: { openLink: { url: b.url } } };
        })
      }
    });
  }

  var payload = {
    cardsV2: [{
      cardId: 'tracker-' + Utilities.getUuid().substr(0, 8),
      card: {
        header: { title: title, subtitle: subtitle || (orgLabel_() + ' · Projects Tracker') },
        sections: [{ widgets: widgets }]
      }
    }]
  };

  try {
    withRetry_('chat:' + webhookKey, function () {
      var res = UrlFetchApp.fetch(url, {
        method: 'post',
        contentType: 'application/json; charset=UTF-8',
        payload: JSON.stringify(payload),
        muteHttpExceptions: true
      });
      var code = res.getResponseCode();
      if (code >= 500 || code === 429) throw new Error('HTTP ' + code);
      if (code >= 400) return null;   // 4xx is our bug; retrying will not help
      return res;
    }, 3, 500);
    return true;
  } catch (e) {
    console.error('Chat post failed for ' + webhookKey + ': ' + e.message);
    return false;
  }
}

/**
 * An Ops Alert, subject to all four brakes.
 *
 * @param {string} webhookKey
 * @param {string} title
 * @param {Array<Array>} rows  key/value pairs for the card
 * @param {Object} opts  { signature, force, link }
 * @return {boolean} whether anything was actually sent
 */
function opsAlert_(webhookKey, title, rows, opts) {
  opts = opts || {};
  var s = getSettings_();
  var props = PropertiesService.getScriptProperties();

  // Brake 3 — per-run ceiling.
  if (!opts.force && ALERT_BUDGET_.used >= (s.max_alerts_per_run || 3)) {
    ALERT_BUDGET_.suppressed++;
    return false;
  }

  // Brake 2 — signature cooldown.
  var sig = opts.signature || (title + '|' + JSON.stringify(rows));
  var sigKey = 'ALERTED_' + Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, sig)).substr(0, 20);
  var last = Number(props.getProperty(sigKey) || 0);
  var cooldownMs = (s.alert_cooldown_hours || 6) * 3600 * 1000;
  if (!opts.force && last && (Date.now() - last) < cooldownMs) return false;

  var buttons = [];
  if (opts.link) buttons.push({ text: 'Open', url: opts.link });
  else buttons.push({ text: 'Open tracker', url: masterSheetUrl_() });

  var ok = postChatCard_(webhookKey, title, null, rows, buttons);
  if (ok) {
    props.setProperty(sigKey, String(Date.now()));
    ALERT_BUDGET_.used++;
  }
  return ok;
}

/** Call once at the end of a run to emit the "and N more" rollup, if any. */
function flushAlertBudget_() {
  if (ALERT_BUDGET_.suppressed > 0) {
    postChatCard_('OPS_SYNC', '⚠️ ' + ALERT_BUDGET_.suppressed + ' more problems this run',
      'Suppressed to keep this space readable',
      [['Suppressed', ALERT_BUDGET_.suppressed + ' further alerts were held back.'],
       ['Where to look', 'Open the tracker → Sync Log column, or run Sync now for the full list.']],
      [{ text: 'Open tracker', url: masterSheetUrl_() }]);
  }
  ALERT_BUDGET_.used = 0;
  ALERT_BUDGET_.suppressed = 0;
}

/**
 * Brake 1 — consecutive-failure threshold, tracked per project.
 * @return {{shouldAlert:boolean, streak:number}}
 */
function recordFailure_(projectKey, errMessage) {
  var props = PropertiesService.getScriptProperties();
  var k = 'FAILSTREAK_' + slugKey_(projectKey);
  var streak = Number(props.getProperty(k) || 0) + 1;
  props.setProperty(k, String(streak));
  var threshold = getSettings_().alert_after_failures || 2;
  return { shouldAlert: streak >= threshold, streak: streak };
}

/**
 * Clears the streak. Returns true only on the transition from failing to
 * working, so recovery is announced exactly once.
 */
function recordSuccess_(projectKey) {
  var props = PropertiesService.getScriptProperties();
  var k = 'FAILSTREAK_' + slugKey_(projectKey);
  var had = Number(props.getProperty(k) || 0);
  if (had) props.deleteProperty(k);
  return had >= (getSettings_().alert_after_failures || 2);
}

/** Ops webhook for a project's Responsible Group, falling back to OPS_SYNC. */
function opsKeyForGroup_(group) {
  var g = slugKey_(group || '');
  if (!g) return 'OPS_SYNC';
  var candidates = ['OPS_' + g, 'OPS_' + g.split('_')[0]];
  for (var i = 0; i < candidates.length; i++) {
    if (getWebhook_(candidates[i])) return candidates[i];
  }
  return 'OPS_SYNC';
}

function digestKeyForGroup_(group) {
  var g = slugKey_(group || '');
  if (!g) return '';
  var candidates = ['DIGEST_' + g, 'DIGEST_' + g.split('_')[0]];
  for (var i = 0; i < candidates.length; i++) {
    if (getWebhook_(candidates[i])) return candidates[i];
  }
  return '';
}

// ---------- Telling the raiser (email, batched) ----------

/** name (lowercased, aliases included) -> { name, email } */
function staffMap_() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.TAB.STAFF);
  var map = {};
  if (!sheet) return map;
  var t = readTable_(sheet);
  t.rows.forEach(function (r) {
    var name = str_(t, r, 'Name');
    if (!name) return;
    var rec = { name: name, email: str_(t, r, 'Email'), role: str_(t, r, 'Role') };
    map[name.toLowerCase()] = rec;
    splitNames_(str_(t, r, 'Aliases')).forEach(function (a) { map[a.toLowerCase()] = rec; });
  });
  return map;
}

/**
 * One email per person per run, listing everything of theirs that closed —
 * never one email per item. This is the whole "no additional load" promise:
 * they hear the answer without ever going to look for it.
 *
 * @param {Array} closures [{ submittedBy, project, suggestion, status, note, ref }]
 * @return {number} emails sent
 */
function notifyRaisers_(closures) {
  var s = getSettings_();
  if (!s.notify_raiser_on_close || !closures || !closures.length) return 0;

  var staff = staffMap_();
  var byPerson = {};
  closures.forEach(function (c) {
    var who = String(c.submittedBy || '').trim();
    if (!who) return;
    var rec = staff[who.toLowerCase()];
    if (!rec || !rec.email) return;
    if (!byPerson[rec.email]) byPerson[rec.email] = { name: rec.name, items: [] };
    byPerson[rec.email].items.push(c);
  });

  var sent = 0;
  var appUrl = webAppUrl_();

  Object.keys(byPerson).forEach(function (email) {
    var p = byPerson[email];
    var lines = p.items.map(function (i) {
      return '<li><b>' + escapeForEmail_(i.suggestion) + '</b> — <i>' + escapeForEmail_(i.project) + '</i><br>' +
             '<span style="color:#5F6469">' + escapeForEmail_(i.status) +
             (i.note ? ' — ' + escapeForEmail_(i.note) : '') + '</span></li>';
    }).join('');

    var body =
      '<div style="font-family:Inter,Arial,sans-serif;color:#1A1A1A;max-width:560px">' +
      '<p>Hello ' + escapeForEmail_(p.name) + ',</p>' +
      '<p>' + (p.items.length === 1 ? 'A suggestion you raised has' : p.items.length + ' suggestions you raised have') +
      ' been closed off:</p>' +
      '<ul style="line-height:1.6">' + lines + '</ul>' +
      '<p style="color:#5F6469;font-size:13px">You do not need to do anything. ' +
      'This is just so you know it was looked at.' +
      (appUrl ? ' You can see everything open at <a href="' + appUrl + '">the ' + escapeForEmail_(teamLabel_()) + ' tracker</a>.' : '') +
      '</p>' +
      '<p style="color:#8A9096;font-size:12px">' + escapeForEmail_(orgLabel_()) + ' · sent automatically</p></div>';

    try {
      MailApp.sendEmail({
        to: email,
        subject: 'Your ICT suggestion' + (p.items.length > 1 ? 's have' : ' has') + ' been closed',
        htmlBody: body
      });
      sent++;
    } catch (e) {
      console.error('Could not email ' + email + ': ' + e.message);
    }
  });

  return sent;
}

function escapeForEmail_(s) {
  return String(s || '').replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
  });
}

// ---------- Weekly digest ----------

/**
 * One card per group Chat space: how many are open, the oldest, anything
 * blocked, anything unassigned. Groups with nothing open are skipped entirely
 * when digest_quiet_when_empty is on — "all clear" every week is how a channel
 * gets muted.
 */
function sendWeeklyDigest() {
  return guarded_('sendWeeklyDigest', function () {
    var s = getSettings_();
    if (!s.weekly_digest_enabled) return 'Weekly digest is switched off in Config.';

    var snap = buildSnapshot_();
    var byGroup = {};

    snap.items.forEach(function (it) {
      if (!isOpenStatus_(it.status)) return;
      var g = it.group || 'Unassigned group';
      if (!byGroup[g]) byGroup[g] = [];
      byGroup[g].push(it);
    });

    var sentTo = [];
    Object.keys(byGroup).forEach(function (group) {
      var key = digestKeyForGroup_(group);
      if (!key) return;

      var items = byGroup[group];
      if (!items.length && s.digest_quiet_when_empty) return;

      items.sort(function (a, b) { return (b.ageDays || 0) - (a.ageDays || 0); });

      var oldest    = items[0];
      var blocked   = items.filter(function (i) { return i.waitingOn; });
      var unowned   = items.filter(function (i) { return !i.assignee && !i.owner; });
      var stale     = items.filter(function (i) { return i.status === CONFIG.STATUS.NEW && i.ageDays >= (s.stale_new_days || 14); });
      var overdue   = items.filter(function (i) { return i.overdue; });
      var dueSoon   = items.filter(function (i) { return i.dueSoon; });

      var rows = [];
      // A missed deadline leads the card. Everything else is a number; this is
      // a date the school has already passed.
      if (overdue.length) {
        rows.push(['⚠️ Past their deadline', overdue.map(function (o) {
          return o.suggestion + ' — ' + o.project + ' (' + o.dueLabel + ')';
        }).slice(0, 4).join('\n')]);
      }
      rows.push(['Open items', String(items.length)]);
      if (dueSoon.length) rows.push(['Due this week', String(dueSoon.length)]);
      rows.push(['Oldest', oldest.suggestion + ' — ' + oldest.project + ' (' + ageLabel_(oldest.raisedOn) + ')']);
      if (stale.length)   rows.push(['Still untouched', stale.length + ' item' + (stale.length > 1 ? 's' : '') + ' at "New" for over ' + (s.stale_new_days || 14) + ' days']);
      if (blocked.length) rows.push(['Blocked', blocked.map(function (b) { return b.suggestion + ' → waiting on ' + b.waitingOn; }).slice(0, 3).join('\n')]);
      if (unowned.length) rows.push(['Nobody assigned', String(unowned.length)]);

      var ok = postChatCard_(key, '📋 ' + group + ' — this week', 'Nothing to fill in. Reply here if something is wrong.',
        rows, [{ text: 'See all open items', url: webAppUrl_() || masterSheetUrl_() }]);
      if (ok) sentTo.push(group);
    });

    audit_('Digest', '', '', 'Weekly digest sent', sentTo.join(', ') || 'nothing to send');
    return sentTo.length ? 'Digest sent to: ' + sentTo.join(', ') : 'Nothing open worth sending.';
  });
}

// ---------- Heartbeat ----------

/**
 * Catches the failure mode the brief calls out: the trigger quietly dying and
 * nobody noticing until suggestions mysteriously stop appearing.
 */
function heartbeatCheck() {
  return guarded_('heartbeatCheck', function () {
    var props = PropertiesService.getScriptProperties();
    var last = Number(props.getProperty('LAST_SYNC_OK') || 0);
    if (!last) return 'No sync has run yet.';

    var hours = (Date.now() - last) / 3600000;
    if (hours < 36) return 'Healthy — last good sync ' + Math.round(hours) + 'h ago.';

    opsAlert_('OPS_SYNC', '💤 The nightly sync has not run', [
      ['Last good sync', fmtDateTime_(new Date(last))],
      ['Silent for', Math.round(hours) + ' hours'],
      ['Likely cause', 'The time-driven trigger was removed, or authorisation lapsed.'],
      ['Fix', 'Tracker Tools → Triggers → Install / repair triggers']
    ], { signature: 'heartbeat-dead', force: false });

    return 'Alerted: no sync for ' + Math.round(hours) + 'h.';
  });
}

// ---------- Audit log ----------

/** Append-only record of every state mutation. Batched to a single write. */
function audit_(action, ref, project, detail, extra) {
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.TAB.AUDIT);
    if (!sheet) return;
    var who = '';
    try { who = Session.getEffectiveUser().getEmail() || 'trigger'; } catch (e) { who = 'trigger'; }
    sheet.appendRow([
      fmtDateTime_(new Date()), action, ref || '', project || '',
      String(detail || '') + (extra ? ' | ' + extra : ''), who
    ]);
  } catch (e) { /* the audit log must never break the thing it is auditing */ }
}

function auditBatch_(rows) {
  if (!rows || !rows.length) return;
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.TAB.AUDIT);
    if (!sheet) return;
    var who = '';
    try { who = Session.getEffectiveUser().getEmail() || 'trigger'; } catch (e) { who = 'trigger'; }
    var out = rows.map(function (r) {
      return [fmtDateTime_(new Date()), r[0], r[1] || '', r[2] || '', r[3] || '', who];
    });
    sheet.getRange(sheet.getLastRow() + 1, 1, out.length, 6).setValues(out);
  } catch (e) { /* ditto */ }
}

// ---------- URLs ----------

function masterSheetUrl_() {
  try { return SpreadsheetApp.getActiveSpreadsheet().getUrl(); } catch (e) { return ''; }
}

/**
 * The published web app URL, cached once found.
 * Only an /exec URL is stored — running from the editor yields a /dev URL that
 * nobody but Dan can open, and emailing that to staff is worse than no link.
 */
function webAppUrl_() {
  var props = PropertiesService.getScriptProperties();
  var cached = props.getProperty('WEB_APP_URL');
  if (cached) return cached;
  try {
    var u = ScriptApp.getService().getUrl();
    if (u && /\/exec$/.test(u)) { props.setProperty('WEB_APP_URL', u); return u; }
  } catch (e) { /* not deployed, or no web context */ }
  return '';
}
