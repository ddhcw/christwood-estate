/**
 * GpsAuth.js — per-person sign-in for the GPS views (PRD rev 4 R41, R14, R18).
 *
 * The web app is deployed ANYONE_ANONYMOUS, so any visitor can call any public
 * server function. Identity therefore comes from one place only:
 * Session.getActiveUser().getEmail(), which is non-empty only in a deployment
 * that makes the visitor sign in with a school Workspace account (RFC-GPS-5).
 * It is never taken from the admin PIN, a token, a parameter or the calling
 * page. Every GPS server function starts with gpsRequire_('view' | 'manage').
 *
 * All functions end in "_" so google.script.run cannot call them directly.
 */

const GPS_ACCESS_CACHE_KEY = 'gps_access_v1';
/** Cache lifetime. A deactivation bites within this many seconds (R41). */
const GPS_ACCESS_CACHE_TTL_S = 60;

const GPS_ROLE_RANK = { view: 1, manage: 2 };

const GPS_MSG_SIGN_IN = 'Please sign in with your school account.';
const GPS_MSG_NO_ACCESS = 'You do not have access to this.';

// ---- Pure logic ------------------------------------------------------------

function gpsNormEmail_(v) { return String(v == null ? '' : v).trim().toLowerCase(); }

/**
 * Decide whether `email` may use a function that needs `required`.
 * accessRows: array of {email, role, active} straight from GPS_Access.
 * Returns {ok:true, email, role} or {ok:false, error}. The error never says
 * whether the address is unknown, inactive or under-privileged, so the list
 * cannot be probed. `manage` includes `view`; `view` does not include `manage`.
 */
function gpsCheckRole_(email, required, accessRows) {
  var who = gpsNormEmail_(email);
  if (!who) return { ok: false, error: GPS_MSG_SIGN_IN };
  var need = GPS_ROLE_RANK[String(required)];
  if (!need) return { ok: false, error: GPS_MSG_NO_ACCESS }; // unknown role: deny
  var best = 0, bestRole = '';
  (accessRows || []).forEach(function (r) {
    if (!r || gpsNormEmail_(r.email) !== who) return;
    if (String(r.active == null ? '' : r.active).trim().toLowerCase() !== 'yes') return;
    var rank = GPS_ROLE_RANK[String(r.role == null ? '' : r.role).trim().toLowerCase()] || 0;
    if (rank > best) { best = rank; bestRole = String(r.role).trim().toLowerCase(); }
  });
  if (best >= need) return { ok: true, email: who, role: bestRole };
  return { ok: false, error: GPS_MSG_NO_ACCESS };
}

/** Build a GPS_Access_Log row in header order from {header: value}. Unknown headers get ''. */
function gpsBuildLogRow_(headers, values) {
  return headers.map(function (h) {
    var k = String(h == null ? '' : h).trim();
    return Object.prototype.hasOwnProperty.call(values, k) ? values[k] : '';
  });
}

// ---- Apps Script glue ------------------------------------------------------

/**
 * The signed-in viewer's address, lower-cased, or '' if nobody is signed in.
 * In the anonymous deployment this is always ''. Any error also gives ''.
 */
function gpsIdentity_() {
  try {
    return gpsNormEmail_(Session.getActiveUser().getEmail());
  } catch (e) {
    return '';
  }
}

/**
 * Active GPS_Access rows as [{email, role, active}], cached for 60 s. Only
 * active rows are cached, so a deactivated address is absent from the cache.
 * Throws if the sheet cannot be read; gpsRequire_ turns that into a refusal.
 */
function gpsLoadAccess_() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get(GPS_ACCESS_CACHE_KEY);
  if (hit) {
    try { return JSON.parse(hit); } catch (e) { /* fall through and reload */ }
  }
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('GPS_Access');
  if (!sh) throw new Error('GPS_Access tab missing');
  var rows = [];
  if (sh.getLastRow() > 1) {
    var values = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
    var headers = values[0].map(function (h) { return String(h == null ? '' : h).trim(); });
    var ie = headers.indexOf('email'), ir = headers.indexOf('role'), ia = headers.indexOf('active');
    if (ie < 0 || ir < 0 || ia < 0) throw new Error('GPS_Access headers missing');
    for (var i = 1; i < values.length; i++) {
      var r = { email: values[i][ie], role: values[i][ir], active: values[i][ia] };
      if (String(r.active).trim().toLowerCase() === 'yes' && gpsNormEmail_(r.email)) rows.push(r);
    }
  }
  cache.put(GPS_ACCESS_CACHE_KEY, JSON.stringify(rows), GPS_ACCESS_CACHE_TTL_S);
  return rows;
}

/**
 * Gate for every GPS server function. Returns {ok:true, email, role} or
 * {ok:false, error}. Callers must return the {ok:false} object as-is and
 * touch no coordinates or student data before this passes. Takes no token and
 * no email argument by design, so the admin PIN can never satisfy it.
 */
function gpsRequire_(role) {
  var email = gpsIdentity_();
  if (!email) return { ok: false, error: GPS_MSG_SIGN_IN };
  var rows;
  try { rows = gpsLoadAccess_(); }
  catch (e) {
    try { Logger.log('gpsRequire_: access list unavailable: ' + e); } catch (x) {}
    return { ok: false, error: GPS_MSG_NO_ACCESS };
  }
  return gpsCheckRole_(email, role, rows);
}

/**
 * R18: record one GPS view with the signed-in address. One appendRow call.
 * Returns true if written. Callers decide whether a failed log blocks the view.
 */
function gpsLogAccess_(email, view) {
  try {
    var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('GPS_Access_Log');
    if (!sh || sh.getLastColumn() < 1) return false;
    var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    var ts = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd HH:mm:ss');
    sh.appendRow(gpsBuildLogRow_(headers, {
      timestamp: ts, view: String(view == null ? '' : view), viewer_email: gpsNormEmail_(email)
    }));
    return true;
  } catch (e) {
    try { Logger.log('gpsLogAccess_ failed: ' + e); } catch (x) {}
    return false;
  }
}
