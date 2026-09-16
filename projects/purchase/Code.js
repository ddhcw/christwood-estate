/**
 * ═══════════════════════════════════════════════════════════════
 * CHRISTWOOD PURCHASE REQUEST SYSTEM — Entry Point & Routing
 * ═══════════════════════════════════════════════════════════════
 * Serves the web app, handles routing, and provides utility
 * functions for template inclusion.
 * ═══════════════════════════════════════════════════════════════
 */
/**
 * Serves the web app.
 * @param {Object} e - Event parameter from doGet
 * @return {HtmlOutput}
 */
function doGet(e) {
  var template = HtmlService.createTemplateFromFile('Index');
  // Pass URL parameters to the template
  template.page = (e && e.parameter && e.parameter.page) ? e.parameter.page : 'form';
  template.requestId = (e && e.parameter && e.parameter.id) ? e.parameter.id : '';
  return template.evaluate()
    .setTitle('Purchase Request — Christwood')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}
/**
 * Includes an HTML file's content for template composition.
 * Usage in templates: <?!= include('Styles') ?>
 * @param {string} filename - Name of the HTML file (without .html)
 * @return {string} The file contents
 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}
/**
 * Returns the current user's email address.
 * Works when deployed as "Execute as: Me" for same-domain users.
 * @return {string}
 */
function getCurrentUserEmail() {
  return Session.getActiveUser().getEmail();
}
/**
 * Returns all initial data the client needs on page load.
 * Single call to minimize round-trips.
 * @return {Object} Initial data bundle
 */
function getInitialData() {
  var email = getCurrentUserEmail();
  // Handle case where email can't be determined (external user)
  if (!email) {
    return {
      email: '',
      userInfo: null,
      isValid: false,
      isGuest: false,
      viewerRole: null,
      requiresManualEmail: true,
      config: getPublicConfig_()
    };
  }
  var isGuest = isGuestUser(email);
  var isHRValid = validateUser(email);
  var isValid = isHRValid || isGuest;
  var userInfo = isHRValid ? getUserInfo(email) : buildGuestInfo_(email);
  var viewerRole = getViewerRole(email);
  return {
    email: email,
    userInfo: userInfo,
    isValid: isValid,
    isGuest: isGuest,
    viewerRole: viewerRole,
    requiresManualEmail: false,
    config: getPublicConfig_()
  };
}
/**
 * Validates a manually entered email (for external/guest users).
 * @param {string} email
 * @return {Object} Same structure as getInitialData
 */
function validateManualEmail(email) {
  if (!email || email.indexOf('@') === -1) {
    return { isValid: false, error: 'Please enter a valid email address.' };
  }
  email = email.toLowerCase().trim();
  var isGuest = isGuestUser(email);
  if (!isGuest) {
    return { isValid: false, error: 'This email is not authorised to submit requests.' };
  }
  return {
    email: email,
    userInfo: buildGuestInfo_(email),
    isValid: true,
    isGuest: true,
    viewerRole: null,
    config: getPublicConfig_()
  };
}
/**
 * Builds a minimal user info object for guest users.
 * @param {string} email
 * @return {Object}
 * @private
 */
function buildGuestInfo_(email) {
  return {
    name: email.split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, function(c) { return c.toUpperCase(); }),
    department: 'Guest / Consultant',
    email: email
  };
}
/**
 * Returns only the config values safe for the client.
 * @return {Object}
 * @private
 */
function getPublicConfig_() {
  var config = getConfig();
  return {
    schoolName: config.schoolName,
    allowedFileTypes: config.allowedFileTypes,
    maxFileSize: config.maxFileSize
  };
}
/**
 * Returns the deployed web app URL (for use in emails, etc.)
 * @return {string}
 */
function getWebAppUrl() {
  return ScriptApp.getService().getUrl();
}
