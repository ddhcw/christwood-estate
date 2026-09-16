/**
 * ═══════════════════════════════════════════════════════════════
 * CHRISTWOOD PURCHASE REQUEST SYSTEM — HR Service
 * ═══════════════════════════════════════════════════════════════
 * Reads HR data from the ImportHR tab for user validation,
 * name/department lookup, and department listing.
 * ═══════════════════════════════════════════════════════════════
 */
/**
 * Validates whether a given email exists in the HR database.
 * @param {string} email
 * @return {boolean}
 */
function validateUser(email) {
  if (!email) return false;
  email = email.toLowerCase().trim();
  var hrData = getHRDataCached_();
  for (var i = 0; i < hrData.length; i++) {
    if (hrData[i].email && hrData[i].email.toLowerCase().trim() === email) {
      return true;
    }
  }
  return false;
}
/**
 * Returns user info (name, department, email) from HR data.
 * @param {string} email
 * @return {Object|null} {name, department, email} or null if not found
 */
function getUserInfo(email) {
  if (!email) return null;
  email = email.toLowerCase().trim();
  var hrData = getHRDataCached_();
  for (var i = 0; i < hrData.length; i++) {
    if (hrData[i].email && hrData[i].email.toLowerCase().trim() === email) {
      return {
        name: hrData[i].name || 'Unknown',
        department: hrData[i].department || 'Unknown',
        email: email
      };
    }
  }
  return null;
}
/**
 * Returns a list of all unique departments from the HR data.
 * @return {string[]}
 */
function getAllDepartments() {
  var hrData = getHRDataCached_();
  var deptSet = {};
  for (var i = 0; i < hrData.length; i++) {
    var dept = hrData[i].department;
    if (dept && String(dept).trim() !== '') {
      deptSet[String(dept).trim()] = true;
    }
  }
  return Object.keys(deptSet).sort();
}
/**
 * Checks if a user has view/print access (is in a department role).
 * @param {string} email
 * @return {boolean}
 */
function isAuthorizedViewer(email) {
  var role = getViewerRole(email);
  return role !== null;
}
/**
 * Checks if a user has print access.
 * @param {string} email
 * @return {boolean}
 */
function hasPrintAccess(email) {
  var role = getViewerRole(email);
  return role !== null && role.access && role.access.indexOf('Print') > -1;
}
// ─────────────────────────────────────────────────────────
// HR DATA READING (with simple cache)
// ─────────────────────────────────────────────────────────
/**
 * Script-level cache for HR data within a single execution.
 * @private
 */
var hrDataCache_ = null;
/**
 * Returns HR data, using a script-level cache to avoid
 * repeated sheet reads within the same execution.
 * @return {Object[]} Array of {name, department, email}
 * @private
 */
function getHRDataCached_() {
  if (hrDataCache_) return hrDataCache_;
  hrDataCache_ = readHRData_();
  return hrDataCache_;
}
/**
 * Reads HR data from the ImportHR tab.
 * Uses column mappings from Config to locate name, department, and email.
 * Data starts at row 5 (row 4 = headers).
 * @return {Object[]} Array of {name, department, email}
 * @private
 */
function readHRData_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('ImportHR');
  if (!sheet) {
    Logger.log('ImportHR tab not found.');
    return [];
  }
  var config = getConfig();
  // Convert column letters to 0-based indices
  var nameColIdx = columnLetterToIndex_(config.hrColName);
  var deptColIdx = columnLetterToIndex_(config.hrColDept);
  var emailColIdx = columnLetterToIndex_(config.hrColEmail);
  // Determine the rightmost column we need
  var maxCol = Math.max(nameColIdx, deptColIdx, emailColIdx) + 1;
  var lastRow = sheet.getLastRow();
  if (lastRow < 5) return []; // No data rows (row 4 = headers, row 5+ = data)
  var dataRange = sheet.getRange(5, 1, lastRow - 4, maxCol);
  var data = dataRange.getValues();
  var result = [];
  for (var i = 0; i < data.length; i++) {
    var email = data[i][emailColIdx];
    // Skip rows with no email
    if (!email || String(email).trim() === '') continue;
    result.push({
      name: String(data[i][nameColIdx] || '').trim(),
      department: String(data[i][deptColIdx] || '').trim(),
      email: String(email).trim()
    });
  }
  return result;
}
/**
 * Converts a column letter (A, B, ..., Z, AA, AB, ...) to a 0-based index.
 * @param {string} letter - Column letter(s)
 * @return {number} 0-based column index
 * @private
 */
function columnLetterToIndex_(letter) {
  if (!letter) return 0;
  letter = letter.toUpperCase().trim();
  var result = 0;
  for (var i = 0; i < letter.length; i++) {
    result = result * 26 + (letter.charCodeAt(i) - 64);
  }
  return result - 1; // Convert to 0-based
}
