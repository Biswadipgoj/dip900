/**
 * ============================================================
 * EMI PORTAL — Google Apps Script Web App
 * ============================================================
 * Deploys as a Web App (/exec) to mirror Supabase data into
 * Google Sheets in real-time.
 *
 * SHEET TABS:
 *   "Register book"  → RUNNING customers
 *   "EMI Complete"   → COMPLETE customers
 *
 * SECURITY: All requests must include header or param:
 *   token = "dip2001"
 *
 * UPSERT KEY: "IMEI NO"
 * ============================================================
 */

// ─── CONFIG ──────────────────────────────────────────────────────────────────
var TOKEN          = "dip2001";
var RUNNING_TAB    = "Register book";
var COMPLETE_TAB   = "EMI Complete";
var UPSERT_KEY_COL = "IMEI NO";

// ─── HEADER ALIAS MAP ─────────────────────────────────────────────────────────
// Maps every possible spelling / typo to the canonical column name used in the sheet.
// Add more aliases here if your sheet has additional spelling variants.
var HEADER_ALIASES = {
  // IMEI
  "IMEI NO"          : "IMEI NO",
  "IMEI"             : "IMEI NO",
  "imei"             : "IMEI NO",
  "imei_no"          : "IMEI NO",

  // Customer name
  "CUSTOMER NAME"    : "CUSTOMER NAME",
  "CUSTOMAR NAME"    : "CUSTOMER NAME",
  "customer_name"    : "CUSTOMER NAME",
  "NAME"             : "CUSTOMER NAME",

  // Father name
  "FATHER NAME"      : "FATHER NAME",
  "father_name"      : "FATHER NAME",

  // Address
  "ADDRESS"          : "ADDRESS",
  "address"          : "ADDRESS",

  // Mobile
  "MOBILE NO"        : "MOBILE NO",
  "MOBILE"           : "MOBILE NO",
  "mobile"           : "MOBILE NO",

  // Alternate number
  "ALTARNET NUMBER"  : "ALTARNET NUMBER",
  "ALTERNATE NUMBER" : "ALTARNET NUMBER",
  "ALT NUMBER"       : "ALTARNET NUMBER",
  "alternate_number_1": "ALTARNET NUMBER",

  // Aadhaar
  "AADHAR NO"        : "AADHAR NO",
  "AADHAAR"          : "AADHAR NO",
  "aadhaar"          : "AADHAR NO",
  "aadhar"           : "AADHAR NO",

  // Voter ID
  "VOTER ID"         : "VOTER ID",
  "voter_id"         : "VOTER ID",

  // Retailer / shop name
  "RETAIL NAME"      : "RETAIL NAME",
  "retailer_name"    : "RETAIL NAME",
  "SHOP NAME"        : "RETAIL NAME",

  // Model
  "MODEL NO"         : "MODEL NO",
  "model_no"         : "MODEL NO",
  "MODEL"            : "MODEL NO",

  // Box no
  "BOX NO"           : "BOX NO",
  "box_no"           : "BOX NO",

  // Purchase value
  "PURCHASE VALUE"   : "PURCHASE VALUE",
  "purchase_value"   : "PURCHASE VALUE",
  "AMOUNT"           : "PURCHASE VALUE",

  // Down payment
  "DOWN PAYMENT"     : "DOWN PAYMENT",
  "down_payment"     : "DOWN PAYMENT",

  // Disburse amount
  "DISBURSE AMOUNT"  : "DISBURSE AMOUNT",
  "disburse_amount"  : "DISBURSE AMOUNT",

  // Purchase date
  "PURCHASE DATE"    : "PURCHASE DATE",
  "purchase_date"    : "PURCHASE DATE",
  "DATE"             : "PURCHASE DATE",

  // EMI amount
  "EMI AMOUNT"       : "EMI AMOUNT",
  "emi_amount"       : "EMI AMOUNT",
  "MONTHLY EMI"      : "EMI AMOUNT",

  // EMI tenure
  "EMI TENURE"       : "EMI TENURE",
  "emi_tenure"       : "EMI TENURE",
  "TENURE"           : "EMI TENURE",

  // EMI due day
  "EMI DUE DAY"      : "EMI DUE DAY",
  "emi_due_day"      : "EMI DUE DAY",

  // 1st EMI charge
  "FIRST EMI CHARGE" : "FIRST EMI CHARGE",
  "first_emi_charge_amount": "FIRST EMI CHARGE",
  "1ST CHARGE"       : "FIRST EMI CHARGE",

  // Status
  "STATUS"           : "STATUS",
  "status"           : "STATUS",

  // Paid count
  "PAID COUNT"       : "PAID COUNT",
  "paid_count"       : "PAID COUNT",

  // Total paid
  "TOTAL PAID"       : "TOTAL PAID",
  "total_paid"       : "TOTAL PAID",

  // Fine due
  "FINE DUE"         : "FINE DUE",
  "fine_due"         : "FINE DUE",

  // Last payment date
  "LAST PAYMENT DATE": "LAST PAYMENT DATE",
  "last_payment_date": "LAST PAYMENT DATE",

  // Image URLs
  "CUSTOMAR IMAGE"   : "CUSTOMAR IMAGE",
  "CUSTOMER IMAGE"   : "CUSTOMAR IMAGE",
  "customer_photo_url": "CUSTOMAR IMAGE",

  "AADHAR FONT"      : "AADHAR FONT",
  "AADHAR FRONT"     : "AADHAR FONT",
  "aadhaar_front_url": "AADHAR FONT",

  "AADHAR BACK"      : "AADHAR BACK",
  "aadhaar_back_url" : "AADHAR BACK",

  "BILL"             : "BILL",
  "BILL IMAGE"       : "BILL",
  "bill_photo_url"   : "BILL",

  // Completion fields
  "COMPLETION DATE"  : "COMPLETION DATE",
  "completion_date"  : "COMPLETION DATE",
  "COMPLETION REMARK": "COMPLETION REMARK",
  "completion_remark": "COMPLETION REMARK",

  // Remarks
  "REMARKS"          : "REMARKS",
  "notes"            : "REMARKS",
};

// ─── CANONICAL COLUMN ORDER ───────────────────────────────────────────────────
// These are the columns written to the sheet in this exact order.
var CANONICAL_COLUMNS = [
  "IMEI NO",
  "CUSTOMER NAME",
  "FATHER NAME",
  "MOBILE NO",
  "ALTARNET NUMBER",
  "AADHAR NO",
  "VOTER ID",
  "ADDRESS",
  "RETAIL NAME",
  "MODEL NO",
  "BOX NO",
  "PURCHASE VALUE",
  "DOWN PAYMENT",
  "DISBURSE AMOUNT",
  "PURCHASE DATE",
  "EMI AMOUNT",
  "EMI TENURE",
  "EMI DUE DAY",
  "FIRST EMI CHARGE",
  "PAID COUNT",
  "TOTAL PAID",
  "FINE DUE",
  "LAST PAYMENT DATE",
  "STATUS",
  "COMPLETION DATE",
  "COMPLETION REMARK",
  "CUSTOMAR IMAGE",
  "AADHAR FONT",
  "AADHAR BACK",
  "BILL",
  "REMARKS",
];

// ─────────────────────────────────────────────────────────────────────────────
//  ROUTING
// ─────────────────────────────────────────────────────────────────────────────

function doGet(e) {
  // Health check
  var token = (e && e.parameter && e.parameter.token) ? e.parameter.token : "";
  if (token !== TOKEN) {
    return jsonResponse({ ok: false, error: "Unauthorized" });
  }
  return jsonResponse({
    ok      : true,
    message : "EMI Portal Sheet Sync is running",
    tabs    : [RUNNING_TAB, COMPLETE_TAB],
    actions : ["upsert", "bulkUpsert", "delete", "read"],
    uptime  : new Date().toISOString()
  });
}

function doPost(e) {
  try {
    var body   = JSON.parse(e.postData.contents);
    var token  = body.token || "";
    var action = body.action || "";
    var data   = body.data   || null;

    if (token !== TOKEN) {
      return jsonResponse({ ok: false, error: "Unauthorized" });
    }

    if (action === "upsert") {
      return doUpsert(data);
    } else if (action === "bulkUpsert") {
      return doBulkUpsert(data);
    } else if (action === "delete") {
      return doDelete(body.imei);
    } else if (action === "read") {
      return doRead();
    } else {
      return jsonResponse({ ok: false, error: "Unknown action: " + action });
    }

  } catch (err) {
    return jsonResponse({ ok: false, error: err.message, stack: err.stack });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  ACTION: UPSERT (single row)
// ─────────────────────────────────────────────────────────────────────────────

function doUpsert(rawRow) {
  if (!rawRow) return jsonResponse({ ok: false, error: "No data provided" });

  var row    = normalizeKeys(rawRow);
  var status = (row["STATUS"] || "RUNNING").toUpperCase();
  var imei   = (row[UPSERT_KEY_COL] || "").toString().trim();

  if (!imei) return jsonResponse({ ok: false, error: "IMEI NO is required" });

  // Remove from the OTHER tab first (in case status changed RUNNING ↔ COMPLETE)
  var otherTabName = (status === "COMPLETE") ? RUNNING_TAB : COMPLETE_TAB;
  deleteFromTab(otherTabName, imei);

  // Upsert into the correct tab
  var targetTab = (status === "COMPLETE") ? COMPLETE_TAB : RUNNING_TAB;
  upsertIntoTab(targetTab, row, imei);

  return jsonResponse({ ok: true, action: "upsert", imei: imei, tab: targetTab });
}

// ─────────────────────────────────────────────────────────────────────────────
//  ACTION: BULK UPSERT (array of rows)
// ─────────────────────────────────────────────────────────────────────────────

function doBulkUpsert(rows) {
  if (!rows || !Array.isArray(rows)) {
    return jsonResponse({ ok: false, error: "data must be an array" });
  }

  var results   = [];
  var errorCount = 0;

  for (var i = 0; i < rows.length; i++) {
    try {
      var row    = normalizeKeys(rows[i]);
      var status = (row["STATUS"] || "RUNNING").toUpperCase();
      var imei   = (row[UPSERT_KEY_COL] || "").toString().trim();
      if (!imei) { results.push({ row: i, error: "IMEI missing" }); errorCount++; continue; }

      var otherTab  = (status === "COMPLETE") ? RUNNING_TAB : COMPLETE_TAB;
      var targetTab = (status === "COMPLETE") ? COMPLETE_TAB : RUNNING_TAB;
      deleteFromTab(otherTab, imei);
      upsertIntoTab(targetTab, row, imei);
      results.push({ row: i, imei: imei, tab: targetTab, ok: true });
    } catch (err) {
      results.push({ row: i, error: err.message });
      errorCount++;
    }
  }

  return jsonResponse({ ok: errorCount === 0, results: results, errorCount: errorCount });
}

// ─────────────────────────────────────────────────────────────────────────────
//  ACTION: DELETE (by IMEI from both tabs)
// ─────────────────────────────────────────────────────────────────────────────

function doDelete(imei) {
  if (!imei) return jsonResponse({ ok: false, error: "imei is required" });
  var imeiStr = imei.toString().trim();
  var deletedFrom = [];
  if (deleteFromTab(RUNNING_TAB,  imeiStr)) deletedFrom.push(RUNNING_TAB);
  if (deleteFromTab(COMPLETE_TAB, imeiStr)) deletedFrom.push(COMPLETE_TAB);
  return jsonResponse({ ok: true, action: "delete", imei: imeiStr, deletedFrom: deletedFrom });
}

// ─────────────────────────────────────────────────────────────────────────────
//  ACTION: READ (export both tabs)
// ─────────────────────────────────────────────────────────────────────────────

function doRead() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  var runningData  = sheetToJson(ss, RUNNING_TAB);
  var completeData = sheetToJson(ss, COMPLETE_TAB);

  return jsonResponse({
    ok      : true,
    running : runningData,
    complete: completeData,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Normalize incoming JSON keys → canonical column names using HEADER_ALIASES.
 * Unknown keys are kept as-is.
 */
function normalizeKeys(raw) {
  var out = {};
  for (var k in raw) {
    if (!raw.hasOwnProperty(k)) continue;
    var canonical = HEADER_ALIASES[k] || HEADER_ALIASES[k.toUpperCase()] || k;
    out[canonical] = raw[k];
  }
  return out;
}

/**
 * Ensure a sheet tab exists with the canonical header row.
 * If headers are missing or out of order, they are written/expanded.
 */
function getOrCreateSheet(tabName) {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(tabName);

  if (!sheet) {
    sheet = ss.insertSheet(tabName);
    sheet.getRange(1, 1, 1, CANONICAL_COLUMNS.length).setValues([CANONICAL_COLUMNS]);
    sheet.getRange(1, 1, 1, CANONICAL_COLUMNS.length)
      .setFontWeight("bold")
      .setBackground("#1a73e8")
      .setFontColor("#ffffff");
    return sheet;
  }

  // Ensure header row has all canonical columns (add missing ones to the right)
  var existingHeaders = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  CANONICAL_COLUMNS.forEach(function(col) {
    if (existingHeaders.indexOf(col) === -1) {
      var newCol = sheet.getLastColumn() + 1;
      sheet.getRange(1, newCol).setValue(col).setFontWeight("bold");
      existingHeaders.push(col);
    }
  });

  return sheet;
}

/**
 * Get the column index map {colName: colIndex (1-based)} for a sheet.
 */
function getHeaderMap(sheet) {
  var lastCol = sheet.getLastColumn();
  if (lastCol === 0) return {};
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var map     = {};
  headers.forEach(function(h, i) { map[h.toString().trim()] = i + 1; });
  return map;
}

/**
 * Find the row number (1-based) of a given IMEI in the sheet.
 * Returns -1 if not found.
 */
function findRowByImei(sheet, imei) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;
  var col = getHeaderMap(sheet)[UPSERT_KEY_COL];
  if (!col) return -1;
  var values = sheet.getRange(2, col, lastRow - 1, 1).getValues();
  for (var i = 0; i < values.length; i++) {
    if (values[i][0].toString().trim() === imei) return i + 2;
  }
  return -1;
}

/**
 * Insert or update a row in the given tab.
 */
function upsertIntoTab(tabName, row, imei) {
  var sheet     = getOrCreateSheet(tabName);
  var headerMap = getHeaderMap(sheet);
  var existRow  = findRowByImei(sheet, imei);

  // Build the values array in canonical column order
  var colCount  = Math.max(sheet.getLastColumn(), CANONICAL_COLUMNS.length);
  var values    = new Array(colCount).fill("");

  CANONICAL_COLUMNS.forEach(function(col) {
    var colIdx = headerMap[col];
    if (!colIdx) return;
    var val = row.hasOwnProperty(col) ? row[col] : "";
    values[colIdx - 1] = (val === null || val === undefined) ? "" : val;
  });

  if (existRow > 0) {
    sheet.getRange(existRow, 1, 1, values.length).setValues([values]);
  } else {
    sheet.appendRow(values);
  }
}

/**
 * Delete a row by IMEI from a given tab. Returns true if deleted.
 */
function deleteFromTab(tabName, imei) {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(tabName);
  if (!sheet) return false;
  var rowNum = findRowByImei(sheet, imei);
  if (rowNum < 1) return false;
  sheet.deleteRow(rowNum);
  return true;
}

/**
 * Convert a sheet tab into an array of JSON objects.
 */
function sheetToJson(ss, tabName) {
  var sheet = ss.getSheetByName(tabName);
  if (!sheet || sheet.getLastRow() < 2) return [];
  var data    = sheet.getDataRange().getValues();
  var headers = data[0];
  var result  = [];
  for (var r = 1; r < data.length; r++) {
    var obj = {};
    for (var c = 0; c < headers.length; c++) {
      obj[headers[c]] = data[r][c];
    }
    result.push(obj);
  }
  return result;
}

/**
 * Return a JSON ContentService response.
 */
function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
