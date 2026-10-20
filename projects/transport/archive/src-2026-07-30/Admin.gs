/**
 * Admin.gs — the lock on the admin-only features.
 *
 * Because the app is open to "Anyone" (so drivers don't sign in), we can't tell
 * who's who from a Google account. Instead the admin enters a PIN. The PIN is
 * stored only as a one-way hash, checked on the SERVER for every admin action,
 * and a short-lived token keeps the admin unlocked for a while, then auto-locks.
 *
 * It's a sensible lock for a school office — not bank-grade. Keep the PIN private.
 */

const ADMIN_TTL_SECONDS = 30 * 60; // auto-lock after 30 minutes of no admin actions

// ---- Setting / changing the PIN (owner only, from the Sheet menu) ----------

function setAdminPin() {
  const ui = SpreadsheetApp.getUi();
  const r1 = ui.prompt('Set admin PIN', 'Choose a PIN (4–8 digits):', ui.ButtonSet.OK_CANCEL);
  if (r1.getSelectedButton() !== ui.Button.OK) return;
  const pin = (r1.getResponseText() || '').trim();
  if (!/^\d{4,8}$/.test(pin)) { ui.alert('That should be 4 to 8 digits. Nothing changed.'); return; }

  const r2 = ui.prompt('Confirm admin PIN', 'Type the same PIN again:', ui.ButtonSet.OK_CANCEL);
  if (r2.getSelectedButton() !== ui.Button.OK) return;
  if ((r2.getResponseText() || '').trim() !== pin) { ui.alert('PINs did not match. Nothing changed.'); return; }

  const props = PropertiesService.getScriptProperties();
  var salt = props.getProperty('ADMIN_PIN_SALT');
  if (!salt) { salt = Utilities.getUuid(); props.setProperty('ADMIN_PIN_SALT', salt); }
  props.setProperty('ADMIN_PIN_HASH', hashPin_(pin, salt));
  ui.alert('Admin PIN saved', 'Admins can now unlock the app with this PIN.', ui.ButtonSet.OK);
}

function hashPin_(pin, salt) {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256, pin + '|' + salt, Utilities.Charset.UTF_8);
  return bytes.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

function adminPinIsSet() {
  return !!PropertiesService.getScriptProperties().getProperty('ADMIN_PIN_HASH');
}

// ---- Login / logout / session (called from the web app) --------------------

function adminLogin(pin, name) {
  const props = PropertiesService.getScriptProperties();
  const hash = props.getProperty('ADMIN_PIN_HASH');
  const salt = props.getProperty('ADMIN_PIN_SALT');
  if (!hash) return { ok: false, error: 'No admin PIN has been set yet. The owner sets it from the Sheet: 🚌 Fleet → Set / change admin PIN.' };
  if (hashPin_(String(pin || '').trim(), salt) !== hash) return { ok: false, error: 'Wrong PIN.' };

  const who = (name || '').trim() || 'Admin';
  const token = Utilities.getUuid().replace(/-/g, '');
  CacheService.getScriptCache().put('atk_' + token, who, ADMIN_TTL_SECONDS);
  return { ok: true, token: token, name: who };
}

function adminLogout(token) {
  if (token) CacheService.getScriptCache().remove('atk_' + token);
  return { ok: true };
}

/** Used by the app on load to see if a saved session is still valid. */
function adminPing(token) {
  const name = adminName_(token);
  return name ? { ok: true, name: name } : { ok: false };
}

/**
 * Returns the admin's name if the token is valid, else null.
 * Also slides the auto-lock window forward on each valid use.
 */
function adminName_(token) {
  if (!token) return null;
  const cache = CacheService.getScriptCache();
  const name = cache.get('atk_' + token);
  if (!name) return null;
  cache.put('atk_' + token, name, ADMIN_TTL_SECONDS); // keep alive while in use
  return name;
}
