/**
 * ═══════════════════════════════════════════════════════════════
 * CHRISTWOOD PURCHASE REQUEST SYSTEM — Print Service
 * ═══════════════════════════════════════════════════════════════
 * Prepares data for the print-friendly view of purchase requests.
 * ═══════════════════════════════════════════════════════════════
 */

/**
 * Returns all data needed to render the print view of a request.
 *
 * @param {string} requestId
 * @return {Object} Print-ready data including digital signature
 */
function getPrintData(requestId) {
  var request = getRequestById(requestId);

  if (!request) {
    return { error: 'Request not found.' };
  }

  if (request.error) {
    return request;
  }

  var config = getConfig();

  return {
    // School branding
    schoolName: config.schoolName,
    schoolLogoUrl: convertDriveUrl_(config.schoolLogoUrl),

    // Request details
    requestId: request.requestId,
    staffName: request.staffName,
    staffEmail: request.staffEmail,
    department: request.department,
    submittedDate: request.submittedDate,
    purpose: request.purpose,
    stockInHand: request.stockInHand,
    notes: request.notes,
    status: request.status,

    // Items
    items: request.items,
    totalCost: request.totalCost,

    // Attachments
    attachmentUrls: request.attachmentUrls,

    // Digital signature
    digitalSignature: request.digitalSignature,

    // Print permissions
    canPrint: request.canPrint
  };
}

/**
 * Converts a Google Drive sharing URL to a direct-serve image URL.
 * Handles formats like:
 *   https://drive.google.com/file/d/FILE_ID/view?usp=sharing
 *   https://drive.google.com/open?id=FILE_ID
 *   https://drive.google.com/uc?id=FILE_ID
 * If the URL is already a direct link or non-Drive URL, returns as-is.
 *
 * @param {string} url
 * @return {string} Direct image URL
 * @private
 */
function convertDriveUrl_(url) {
  if (!url) return '';

  url = String(url).trim();

  // Extract file ID from various Google Drive URL formats
  var fileId = '';

  // Format: /file/d/FILE_ID/...
  var match1 = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (match1) {
    fileId = match1[1];
  }

  // Format: ?id=FILE_ID or &id=FILE_ID
  if (!fileId) {
    var match2 = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    if (match2) {
      fileId = match2[1];
    }
  }

  // If we extracted a file ID, return the direct thumbnail URL
  if (fileId) {
    return 'https://lh3.googleusercontent.com/d/' + fileId;
  }

  // Not a Drive URL — return as-is (could be a direct public URL)
  return url;
}
