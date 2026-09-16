/**
 * ═══════════════════════════════════════════════════════════════
 * CHRISTWOOD PURCHASE REQUEST SYSTEM — Configuration Service
 * ═══════════════════════════════════════════════════════════════
 * Reads and manages all configuration from the Config tab.
 * Uses key-based lookup for robustness.
 * ═══════════════════════════════════════════════════════════════
 */
/**
 * Reads all configuration from the Config sheet.
 * Scans Column B for keys and Column C for values.
 * @return {Object} Configuration object
 */
function getConfig() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Config');
  if (!sheet) {
    throw new Error('Config tab not found. Please run the setup script first.');
  }
  var data = sheet.getDataRange().getValues();
  var config = {
    // Defaults
    prefix: 'PR',
    yearCode: '2627',
    separator: '-',
    nextSeqNum: 1,
    nextSeqNumRow: -1,
    seqPadding: 4,
    onSubmissionEmails: '',
    onPrincipalEmails: '',
    onCEOEmails: '',
    onRejectionEmails: '',
    guestEmails: '',
    attachFolderId: '',
    maxFileSize: 10,
    allowedFileTypes: 'pdf,jpg,jpeg,png',
    schoolName: 'Christwood',
    schoolLogoUrl: '',
    sigText: '{{email}} has submitted this purchase request digitally on {{date}}. This digital submission serves as the requestor\'s authorisation and attestation — no physical signature is required.',
    hrColName: 'C',
    hrColDept: 'J',
    hrColEmail: 'N',
    departmentRoles: []
  };
  var inDeptSection = false;
  var deptSectionStart = -1;
  for (var i = 0; i < data.length; i++) {
    var colA = String(data[i][0]).trim();
    var colB = String(data[i][1]).trim();
    var colC = String(data[i][2]).trim();
    var colD = String(data[i][3]).trim();
    // Detect section headers to know when we're in the dept roles area
    if (colA.indexOf('Department Roles') > -1) {
      inDeptSection = true;
      deptSectionStart = i;
      continue;
    }
    // If we hit another section header, stop reading dept roles
    if (inDeptSection && colA && i > deptSectionStart + 1) {
      inDeptSection = false;
    }
    // Read department roles
    if (inDeptSection && colB && colB !== 'Department') {
      config.departmentRoles.push({
        department: colB,
        emails: parseEmailList_(colC),
        access: colD || 'View'
      });
      continue;
    }
    // Read key-value pairs
    switch (colB) {
      case 'Prefix':
        config.prefix = colC;
        break;
      case 'Academic Year Code':
        config.yearCode = colC;
        break;
      case 'Separator':
        config.separator = colC;
        break;
      case 'Next Sequence Number':
        config.nextSeqNum = parseInt(colC) || 1;
        config.nextSeqNumRow = i + 1; // 1-indexed row number
        break;
      case 'Sequence Padding':
        config.seqPadding = parseInt(colC) || 4;
        break;
      case 'On Submission':
        config.onSubmissionEmails = colC;
        break;
      case 'On Principal Approval':
        config.onPrincipalEmails = colC;
        break;
      case 'On CEO Approval':
        config.onCEOEmails = colC;
        break;
      case 'On Rejection':
        config.onRejectionEmails = colC;
        break;
      case 'Allowed Guest Emails':
        config.guestEmails = colC;
        break;
      case 'Attachment Folder ID':
        config.attachFolderId = colC;
        break;
      case 'Max File Size (MB)':
        config.maxFileSize = parseInt(colC) || 10;
        break;
      case 'Allowed File Types':
        config.allowedFileTypes = colC || 'pdf,jpg,jpeg,png';
        break;
      case 'School Name':
        config.schoolName = colC || 'Christwood';
        break;
      case 'School Logo URL':
        config.schoolLogoUrl = colC;
        break;
      case 'Digital Signature Text':
        config.sigText = colC;
        break;
      case 'HR Column: Staff Name':
        config.hrColName = colC || 'C';
        break;
      case 'HR Column: Department':
        config.hrColDept = colC || 'J';
        break;
      case 'HR Column: Email ID':
        config.hrColEmail = colC || 'N';
        break;
    }
  }
  return config;
}
/**
 * Generates the next request ID and atomically increments the counter.
 * Uses LockService to prevent race conditions.
 * @return {string} e.g., "PR2627-0001"
 */
function getNextRequestId() {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000); // Wait up to 10 seconds
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName('Config');
    var config = getConfig();
    // Build the ID
    var paddedNum = padNumber_(config.nextSeqNum, config.seqPadding);
    var requestId = config.prefix + config.yearCode + config.separator + paddedNum;
    // Increment the counter in the sheet
    if (config.nextSeqNumRow > 0) {
      sheet.getRange(config.nextSeqNumRow, 3).setValue(config.nextSeqNum + 1);
      SpreadsheetApp.flush();
    }
    return requestId;
  } catch (e) {
    throw new Error('Could not generate request ID. Please try again. (' + e.message + ')');
  } finally {
    lock.releaseLock();
  }
}
/**
 * Returns notification recipients for a given stage.
 * @param {string} stage - 'submission', 'principal', 'ceo', 'rejection'
 * @return {string[]} Array of email addresses
 */
function getNotificationRecipients(stage) {
  var config = getConfig();
  var emailStr = '';
  switch (stage) {
    case 'submission':
      emailStr = config.onSubmissionEmails;
      break;
    case 'principal':
      emailStr = config.onPrincipalEmails;
      break;
    case 'ceo':
      emailStr = config.onCEOEmails;
      break;
    case 'rejection':
      emailStr = config.onRejectionEmails;
      break;
  }
  return parseEmailList_(emailStr);
}
/**
 * Returns department role mappings.
 * @return {Object[]} Array of {department, emails[], access}
 */
function getDepartmentRoles() {
  var config = getConfig();
  return config.departmentRoles;
}
/**
 * Returns the viewer role for a given email.
 * Checks against department role email lists.
 * @param {string} email
 * @return {Object|null} {department, access} or null if not a viewer
 */
function getViewerRole(email) {
  if (!email) return null;
  email = email.toLowerCase().trim();
  var config = getConfig();
  var roles = config.departmentRoles;
  // Check each department role
  for (var i = 0; i < roles.length; i++) {
    var deptEmails = roles[i].emails;
    for (var j = 0; j < deptEmails.length; j++) {
      if (deptEmails[j].toLowerCase().trim() === email) {
        return {
          department: roles[i].department,
          access: roles[i].access
        };
      }
    }
  }
  return null;
}
/**
 * Checks if an email is in the guest list.
 * @param {string} email
 * @return {boolean}
 */
function isGuestUser(email) {
  if (!email) return false;
  email = email.toLowerCase().trim();
  var config = getConfig();
  var guests = parseEmailList_(config.guestEmails);
  for (var i = 0; i < guests.length; i++) {
    if (guests[i].toLowerCase().trim() === email) {
      return true;
    }
  }
  return false;
}
/**
 * Renders the digital signature text with actual values.
 * @param {string} email
 * @param {string} date - Formatted date string
 * @return {string}
 */
function getDigitalSignatureText(email, date) {
  var config = getConfig();
  var text = config.sigText;
  text = text.replace(/\{\{email\}\}/g, email);
  text = text.replace(/\{\{date\}\}/g, date);
  return text;
}
// ─────────────────────────────────────────────────────────
// PRIVATE HELPERS
// ─────────────────────────────────────────────────────────
/**
 * Parses a comma-separated email string into an array.
 * @param {string} str
 * @return {string[]}
 * @private
 */
function parseEmailList_(str) {
  if (!str || String(str).trim() === '') return [];
  return String(str)
    .split(',')
    .map(function(e) { return e.trim(); })
    .filter(function(e) { return e.length > 0 && e.indexOf('@') > -1; });
}
/**
 * Pads a number with leading zeros.
 * @param {number} num
 * @param {number} padding
 * @return {string}
 * @private
 */
function padNumber_(num, padding) {
  var str = String(num);
  while (str.length < padding) {
    str = '0' + str;
  }
  return str;
}
