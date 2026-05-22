# Apps Script Setup Guide

Follow these steps in order. This takes about 15 minutes.

---

## Step 1 — Create the Google Sheet

1. Go to [sheets.google.com](https://sheets.google.com) and create a new blank spreadsheet
2. Name it **"Where's Louie? Data"**
3. Copy the Sheet ID from the URL:
   ```
   https://docs.google.com/spreadsheets/d/THIS_IS_YOUR_SHEET_ID/edit
   ```
4. Keep this tab open — you'll need the ID in Step 4

---

## Step 2 — Create the Apps Script project

1. From within your Google Sheet, go to **Extensions → Apps Script**
2. Delete the default `function myFunction() {}` code
3. Paste the entire contents of `Code.gs` from this repo
4. Name the project **"Where's Louie? Backend"**
5. Click **Save** (floppy disk icon)

---

## Step 3 — Set Script Properties

1. In the Apps Script editor, click the **⚙ gear icon** (Project Settings) in the left sidebar
2. Scroll down to **Script Properties** and click **Add script property**
3. Add these two properties:

   | Property       | Value                                             |
   |----------------|---------------------------------------------------|
   | `SHEET_ID`     | Your Google Sheet ID from Step 1                  |
   | `BRIDGE_SECRET`| A long random string (generate one below)         |

   **Generating a secret key:**
   ```bash
   python -c "import secrets; print(secrets.token_hex(32))"
   ```
   Copy this exact value — you'll also paste it into `bridge/.env` as `BRIDGE_SECRET`.

4. Click **Save script properties**

---

## Step 4 — Set up sheet headers

1. In the Apps Script editor, open the function dropdown (top bar, next to "Debug")
2. Select **`setupSheetHeaders`**
3. Click **Run**
4. Grant the requested permissions (Google will ask you to authorize)
5. Go back to your Google Sheet — you should see the **Positions** and **Submissions** tabs with headers

---

## Step 5 — Deploy as a Web App

1. In the Apps Script editor, click **Deploy → New deployment**
2. Click the gear icon next to "Select type" and choose **Web app**
3. Configure:
   - **Description**: `v1`
   - **Execute as**: `Me`
   - **Who has access**: `Anyone`
4. Click **Deploy**
5. Copy the **Web app URL** — it looks like:
   ```
   https://script.google.com/macros/s/AKfycb.../exec
   ```
6. Paste this URL into `bridge/.env` as `APPS_SCRIPT_URL`
7. Also paste it into `website/app.js` as `APPS_SCRIPT_URL` (see website setup)

---

## Step 6 — Set up email notifications for new submissions

1. In the Apps Script editor, click **Triggers** (clock icon in the left sidebar)
2. Click **+ Add Trigger** (bottom right)
3. Configure:
   - **Function**: `onFormSubmit`
   - **Event source**: `From spreadsheet`
   - **Event type**: `On form submit`
4. Click **Save**

Now when someone submits the Google Form, you'll get an email automatically.

---

## Step 7 — Create the Google Form for community submissions

1. Go to [forms.google.com](https://forms.google.com) and create a new form
2. Title: **"📸 Take a Photo with Louie!"**
3. Add these questions:

   | # | Question | Type | Required? |
   |---|----------|------|-----------|
   | 1 | Your name (or alias — be as fun as you like!) | Short answer | Yes |
   | 2 | Where did you take Louie? (city, landmark, wherever!) | Short answer | Yes |
   | 3 | Tell us about it! What did you and Louie get up to? | Paragraph | No |
   | 4 | Upload a photo with Louie | File upload | No |

4. For the file upload question:
   - Allow only image files
   - Max file size: 10 MB

5. Click the **palette icon** → match colors to the site (teal `#3b93a7`)

6. Click the **⋮ menu → Get pre-filled link** — NOT needed, but do go to **Responses → Link to Sheets**
   - Link it to your existing **"Where's Louie? Data"** spreadsheet
   - Select the **Submissions** tab (or let it create a new one — just update the sheet name in Code.gs if needed)

7. In Form Settings → **Responses tab**:
   - Turn on **"Get email notifications for new responses"**

8. Share the form link — you'll embed this in the website

---

## Approving Posts

1. Open your **"Where's Louie? Data"** Google Sheet
2. Go to the **Submissions** tab
3. New form responses appear here automatically
4. To approve a post: type `TRUE` in the **Approved** column (column F)
5. The post will appear on the website within a minute

**Tip**: Sort by Approved column to quickly see what's pending.

---

## Redeploying After Code Changes

If you edit `Code.gs`, you **must** create a new deployment for changes to take effect:
1. **Deploy → New deployment**
2. The URL changes — update `bridge/.env` and `website/app.js`

Or use **Manage deployments** to update the existing one (URL stays the same):
1. **Deploy → Manage deployments**
2. Click the pencil icon → **Version: New version**
3. Click **Deploy**

---

## Testing the API

Once deployed, test your endpoints in a browser:

```
# All positions:
https://script.google.com/macros/s/YOUR_ID/exec?action=positions

# Approved posts:
https://script.google.com/macros/s/YOUR_ID/exec?action=posts

# Latest position:
https://script.google.com/macros/s/YOUR_ID/exec?action=latest

# Everything at once (used by the website):
https://script.google.com/macros/s/YOUR_ID/exec?action=all
```
