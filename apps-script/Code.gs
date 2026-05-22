/**
 * Where's Louie? — Google Apps Script Backend
 * =============================================
 * Serves as both:
 *   1. A webhook receiver for the Python MQTT bridge (POST)
 *   2. A JSON API for the GitHub Pages website (GET)
 *
 * Deploy as a Web App:
 *   Execute as: Me
 *   Who has access: Anyone
 *
 * Set these Script Properties (Project Settings → Script Properties):
 *   SHEET_ID      — ID of your Google Sheet (from its URL)
 *   BRIDGE_SECRET — same secret used in bridge/.env
 */

// ── Sheet names ──────────────────────────────────────────────────────────────
const SHEET_POSITIONS   = "Positions";
const SHEET_SUBMISSIONS = "Submissions";

// ── Helper: get Script Properties ────────────────────────────────────────────
function getProp(key) {
  return PropertiesService.getScriptProperties().getProperty(key);
}

function getSheet(name) {
  const ss = SpreadsheetApp.openById(getProp("SHEET_ID"));
  return ss.getSheetByName(name);
}

// ── CORS headers for browser requests ────────────────────────────────────────
function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function jsonResponse(data, status) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}


// ── POST handler — receives GPS data from Python bridge ──────────────────────
function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);

    // Verify shared secret
    if (body.secret !== getProp("BRIDGE_SECRET")) {
      return jsonResponse({ error: "Unauthorized" });
    }

    const sheet = getSheet(SHEET_POSITIONS);

    // Add header row if sheet is empty
    if (sheet.getLastRow() === 0) {
      sheet.appendRow([
        "timestamp", "lat", "lng", "altitude", "battery_pct", "speed", "snr", "node_id"
      ]);
    }

    sheet.appendRow([
      body.timestamp,
      body.lat,
      body.lng,
      body.altitude  ?? "",
      body.battery_pct ?? "",
      body.speed     ?? "",
      body.snr       ?? "",
      body.node_id   ?? "",
    ]);

    return jsonResponse({ ok: true, message: "Position logged" });

  } catch (err) {
    return jsonResponse({ error: err.toString() });
  }
}


// ── GET handler — JSON API for the website ───────────────────────────────────
function doGet(e) {
  const action = (e.parameter && e.parameter.action) || "positions";

  try {
    switch (action) {
      case "positions": return jsonResponse(getPositions());
      case "posts":     return jsonResponse(getApprovedPosts());
      case "latest":    return jsonResponse(getLatestPosition());
      case "all":       return jsonResponse({
                          positions: getPositions(),
                          posts:     getApprovedPosts(),
                          latest:    getLatestPosition(),
                        });
      default:          return jsonResponse({ error: "Unknown action" });
    }
  } catch (err) {
    return jsonResponse({ error: err.toString() });
  }
}


// ── Data fetchers ─────────────────────────────────────────────────────────────

function getPositions() {
  const sheet = getSheet(SHEET_POSITIONS);
  if (!sheet || sheet.getLastRow() < 2) return [];

  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 8).getValues();
  return rows
    .filter(r => r[0] && r[1] && r[2])   // must have timestamp, lat, lng
    .map(r => ({
      timestamp:   r[0],
      lat:         Number(r[1]),
      lng:         Number(r[2]),
      altitude:    r[3] !== "" ? Number(r[3]) : null,
      battery_pct: r[4] !== "" ? Number(r[4]) : null,
      speed:       r[5] !== "" ? Number(r[5]) : null,
      snr:         r[6] !== "" ? Number(r[6]) : null,
      node_id:     r[7] || "",
    }));
}


function getLatestPosition() {
  const positions = getPositions();
  if (positions.length === 0) return null;
  return positions[positions.length - 1];
}


function getApprovedPosts() {
  const sheet = getSheet(SHEET_SUBMISSIONS);
  if (!sheet || sheet.getLastRow() < 2) return [];

  // Expected column order from Google Form:
  // A: Timestamp | B: Name | C: Location | D: Story | E: Photo URL | F: Approved
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < 2) return [];

  const rows = sheet.getRange(2, 1, lastRow - 1, Math.max(lastCol, 6)).getValues();
  return rows
    .filter(r => {
      const approved = r[5];
      // Accept TRUE (boolean), "TRUE" (string), or "Yes" — flexible for manual edits
      return approved === true || String(approved).toUpperCase() === "TRUE" || String(approved).toLowerCase() === "yes";
    })
    .map((r, i) => ({
      id:        i + 1,
      timestamp: r[0],
      name:      r[1] || "Anonymous",
      location:  r[2] || "",
      story:     r[3] || "",
      photo_url: r[4] || "",
    }));
}


// ── Utility: set up the spreadsheet headers (run once manually) ───────────────
function setupSheetHeaders() {
  const ss = SpreadsheetApp.openById(getProp("SHEET_ID"));

  // Positions tab
  let pos = ss.getSheetByName(SHEET_POSITIONS);
  if (!pos) pos = ss.insertSheet(SHEET_POSITIONS);
  if (pos.getLastRow() === 0) {
    pos.appendRow(["timestamp", "lat", "lng", "altitude", "battery_pct", "speed", "snr", "node_id"]);
    pos.setFrozenRows(1);
    pos.getRange(1, 1, 1, 8).setFontWeight("bold");
  }

  // Submissions tab — add the Approved column header if needed
  let sub = ss.getSheetByName(SHEET_SUBMISSIONS);
  if (!sub) {
    sub = ss.insertSheet(SHEET_SUBMISSIONS);
    sub.appendRow(["Timestamp", "Name", "Location (where did you take Louie?)", "Story", "Photo URL", "Approved"]);
    sub.setFrozenRows(1);
    sub.getRange(1, 1, 1, 6).setFontWeight("bold");
  }

  SpreadsheetApp.getUi().alert("Sheet headers created! ✓");
}


// ── Utility: send email notification when a new submission arrives ─────────────
// Attach this to the Google Form's "On form submit" trigger in the Apps Script editor
function onFormSubmit(e) {
  try {
    const ownerEmail = Session.getActiveUser().getEmail();
    const row = e.values;  // [timestamp, name, location, story, photo_url]
    GmailApp.sendEmail(
      ownerEmail,
      "📸 New Louie submission from " + (row[1] || "someone"),
      `Name: ${row[1]}\nLocation: ${row[2]}\nStory: ${row[3]}\n\nPhoto: ${row[4]}\n\nApprove it in Google Sheets by setting the Approved column to TRUE.`,
    );
  } catch (err) {
    // Email notification is best-effort — don't crash on failure
    console.error("Email notification failed:", err);
  }
}
