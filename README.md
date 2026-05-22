# 🦆 Where's Louie?

A public GPS tracker + community blog for Louie the rubber duck.
Inspired by [Hitchbot](https://en.wikipedia.org/wiki/HitchBOT). Built with Meshtastic, Google Workspace, and a lot of hot glue.

**Live site:** *(update this after GitHub Pages deployment)*

---

## How It Works

```
[Meshtastic T1000-E in Louie's backpack]
    ↓  LoRa radio
[Community Meshtastic mesh nodes]
    ↓  MQTT
[mqtt.meshtastic.org]
    ↓  subscribed by
[louie_bridge.py  ← runs on your computer or a VPS]
    ↓  HTTP POST
[Google Apps Script Web App]
    ↓  writes to
[Google Sheets]  ←  also receives photo submissions via Google Form
    ↑  reads from
[GitHub Pages website]  →  shows route map + community blog
```

---

## Setup Checklist

- [ ] **Step 1** — Find Louie's node ID
- [ ] **Step 2** — Configure MQTT on the T1000-E
- [ ] **Step 3** — Set up Google Sheets + Apps Script
- [ ] **Step 4** — Configure and run the Python bridge
- [ ] **Step 5** — Create the Google Form for submissions
- [ ] **Step 6** — Deploy the website to GitHub Pages
- [ ] **Step 7** — Update the two config URLs in `website/app.js`

---

## Step 1 — Find Louie's Node ID

Your T1000-E has a unique Meshtastic node ID like `!a1b2c3d4`.

**To find it:**
1. Connect to the T1000-E via the Meshtastic app (Bluetooth)
2. Go to **⚙ Settings → Device** — the node ID appears at the top
3. Or open [client.meshtastic.org](https://client.meshtastic.org) (USB) and look in the top left

The ID always starts with `!` followed by 8 hex characters.

---

## Step 2 — Configure MQTT on the T1000-E

So community nodes can forward Louie's position to the internet:

1. In the Meshtastic app, go to **Settings → MQTT**
2. Enable MQTT
3. Server: `mqtt.meshtastic.org`
4. Port: `1883`
5. Username: `meshdev`
6. Password: `large4cats`
7. Enable **JSON output** (important — the bridge reads JSON packets)
8. Root topic: `msh` (default)

Any Meshtastic node near Louie that's connected to the internet will now forward his GPS packets to the public MQTT broker.

---

## Step 3 — Set Up Google Sheets + Apps Script

See **`apps-script/setup.md`** for the full walkthrough. Summary:

1. Create a new Google Sheet named "Where's Louie? Data"
2. Open Extensions → Apps Script, paste `apps-script/Code.gs`
3. Set Script Properties: `SHEET_ID` and `BRIDGE_SECRET`
4. Run `setupSheetHeaders()` once
5. Deploy as Web App (Execute as: Me, Access: Anyone)
6. Copy the Web App URL

---

## Step 4 — Configure and Run the Python Bridge

### Install dependencies

```bash
cd bridge
pip install -r requirements.txt
```

### Configure

```bash
cp .env.example .env
```

Edit `.env`:
```
LOUIE_NODE_ID=!a1b2c3d4          # your node ID from Step 1
APPS_SCRIPT_URL=https://script.google.com/macros/s/.../exec  # from Step 3
BRIDGE_SECRET=your-long-random-secret  # same value as in Script Properties
```

### Test it (sends a fake position to verify the connection works)

```bash
python louie_bridge.py --test
```

Check your Google Sheet — you should see a row appear in the **Positions** tab.

### Run it

```bash
python louie_bridge.py
```

### Keep it running

**On Linux/Mac (background with screen):**
```bash
screen -S louie
python louie_bridge.py
# Ctrl+A, D to detach  |  screen -r louie to reattach
```

**On Linux (systemd service — runs on boot):**

Create `/etc/systemd/system/louie-bridge.service`:
```ini
[Unit]
Description=Where's Louie? MQTT Bridge
After=network-online.target
Wants=network-online.target

[Service]
WorkingDirectory=/path/to/wheres-louie/bridge
ExecStart=/usr/bin/python3 louie_bridge.py
Restart=always
RestartSec=10
User=youruser

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable louie-bridge
sudo systemctl start louie-bridge
sudo journalctl -u louie-bridge -f  # view logs
```

**On Windows (keep terminal open, or use Task Scheduler):**
```powershell
python louie_bridge.py
```

---

## Step 5 — Create the Google Form

See **`apps-script/setup.md` Step 7** for the full walkthrough. Short version:

1. Create a Google Form with these fields:
   - Your name (short answer)
   - Where did you take Louie? (short answer)
   - Tell us about it! (paragraph)
   - Upload a photo (file upload — images only)

2. Link form responses to your Google Sheet (Submissions tab)

3. Copy the form's share URL — you'll need it in Step 7

---

## Step 6 — Deploy to GitHub Pages

1. Push this repo to GitHub
2. Go to **Settings → Pages** in your GitHub repo
3. Source: **Deploy from branch**, branch: `main`, folder: `/website`
4. Your site will be live at `https://yourusername.github.io/wheres-louie`

Or push just the `website/` folder as the root of a `gh-pages` branch.

---

## Step 7 — Update `website/app.js`

Open `website/app.js` and update the two constants at the top:

```js
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/YOUR_ID/exec";
const GOOGLE_FORM_URL  = "https://forms.gle/YOUR_FORM_LINK_HERE";
```

Commit and push — the site will update automatically.

---

## Approving Community Posts

1. Open **"Where's Louie? Data"** Google Sheet
2. Go to the **Submissions** tab
3. Find the post you want to approve
4. Set the **Approved** column (column F) to `TRUE`
5. The post appears on the website within seconds (next time someone loads the page)

You'll get an email whenever a new submission comes in (configured in Apps Script setup).

---

## File Structure

```
where's-louie/
├── bridge/
│   ├── louie_bridge.py     # MQTT → Google Sheets bridge (run this!)
│   ├── requirements.txt
│   └── .env.example        # copy to .env and fill in values
├── apps-script/
│   ├── Code.gs             # paste this into Google Apps Script
│   └── setup.md            # step-by-step Apps Script setup guide
├── website/
│   ├── index.html          # the public website
│   ├── style.css
│   └── app.js              # map + blog rendering (update URLs here!)
└── README.md               # this file
```

---

## Troubleshooting

**Bridge connects but no positions appear in Sheets**
- Verify Louie's node ID is correct in `.env` (must match exactly, including `!`)
- Check that MQTT is enabled on the T1000-E with JSON output enabled
- Ensure a community Meshtastic node near Louie is online and MQTT-enabled
- Run `python louie_bridge.py --test` to verify the Sheets connection works

**Website shows "can't reach tracking server"**
- Check that the `APPS_SCRIPT_URL` in `app.js` is correct and up to date
- Make sure the Apps Script is deployed as "Anyone" can access
- Try opening the URL directly in a browser with `?action=positions`

**Photos not showing in blog posts**
- Google Drive photos need to be in a folder shared as "Anyone with the link can view"
- The form's upload folder sharing may need to be updated

**MQTT connection drops frequently**
- The bridge auto-reconnects — check logs for errors
- If on a home network, ensure your router allows outbound port 1883
- Try the TLS port: change `MQTT_PORT = 8883` and add `client.tls_set()` before connect

---

## The Experiment

Louie's journey depends on:
1. **Community Meshtastic nodes** being near him to relay his GPS
2. **People** willing to carry him somewhere interesting and pass him on
3. **You**, for sharing the site and making it weird and fun

If Louie goes dark for a few days, he might just be in a Meshtastic dead zone. He'll resurface.

Questions or want to hand off Louie? → [goodthinklabs.com](https://www.goodthinklabs.com)
