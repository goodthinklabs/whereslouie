#!/usr/bin/env python3
"""
louie_bridge.py — Tracki API → Google Apps Script bridge for Where's Louie?

Authenticates with the Tracki API, polls for new GPS positions on a fixed
interval, and forwards each new position to Google Sheets via Apps Script.

Usage:
    python louie_bridge.py           # normal polling mode
    python louie_bridge.py --test    # fetch once and print, no forwarding
    python louie_bridge.py --once    # fetch once, forward, then exit
"""

import json
import os
import sys
import time
import argparse
import logging
from datetime import datetime, timezone

import requests
from dotenv import load_dotenv

load_dotenv()

# ── Config ────────────────────────────────────────────────────────────────────
TRACKI_URL      = "https://app.trackimo.com"
NOMINATIM_URL   = "https://nominatim.openstreetmap.org/reverse"
TRACKI_USER     = os.getenv("TRACKI_USER", "")
TRACKI_PASS     = os.getenv("TRACKI_PASS", "")
CLIENT_ID       = os.getenv("TRACKI_CLIENT_ID", "")
CLIENT_SECRET   = os.getenv("TRACKI_CLIENT_SECRET", "")
REDIRECT_URI    = os.getenv("TRACKI_REDIRECT_URI", "http://localhost")
DEVICE_ID       = os.getenv("TRACKI_DEVICE_ID", "")   # optional: pin to specific device

APPS_SCRIPT_URL = os.getenv("APPS_SCRIPT_URL", "")
BRIDGE_SECRET   = os.getenv("BRIDGE_SECRET", "")

POLL_INTERVAL   = int(os.getenv("POLL_INTERVAL_SECS", "300"))   # default 5 minutes

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("louie")


# ── Authentication ────────────────────────────────────────────────────────────

def authenticate():
    """Log in and exchange OAuth code for a bearer token.
    Returns (access_token, account_id).
    """
    # Step 1: password login → session cookie
    resp = requests.post(
        TRACKI_URL + "/api/internal/v2/user/login",
        headers={"Content-Type": "application/json"},
        json={"username": TRACKI_USER, "password": TRACKI_PASS},
        timeout=15,
    )
    resp.raise_for_status()
    cookies = dict(resp.cookies)
    if "JSESSIONID" not in cookies:
        raise RuntimeError("Login failed — check TRACKI_USER / TRACKI_PASS")

    # Step 2: OAuth auth endpoint → 302 with ?code=... in Location header
    resp = requests.get(
        TRACKI_URL + "/api/v3/oauth2/auth",
        params={
            "client_id":     CLIENT_ID,
            "redirect_uri":  REDIRECT_URI,
            "response_type": "code",
            "scope":         "locations,devices,accounts",
        },
        cookies=cookies,
        allow_redirects=False,
        timeout=15,
    )
    if resp.status_code != 302:
        raise RuntimeError(f"OAuth auth returned {resp.status_code} (expected 302)")
    location = resp.headers.get("Location", "")
    code = location.split("code=")[-1].split("&")[0]
    if not code:
        raise RuntimeError(f"No code in OAuth redirect Location: {location}")

    # Step 3: exchange code for access token
    resp = requests.post(
        TRACKI_URL + "/api/v3/oauth2/token",
        headers={"Content-Type": "application/json"},
        json={"client_id": CLIENT_ID, "client_secret": CLIENT_SECRET, "code": code},
        cookies=cookies,
        timeout=15,
    )
    resp.raise_for_status()
    access_token = resp.json().get("access_token")
    if not access_token:
        raise RuntimeError(f"No access_token in token response: {resp.text[:200]}")

    # Step 4: fetch account_id
    user = requests.get(
        TRACKI_URL + "/api/v3/user",
        headers={"Authorization": f"Bearer {access_token}"},
        timeout=15,
    ).json()
    account_id = user["account_id"]
    log.info(f"Authenticated as {TRACKI_USER} (account {account_id})")
    return access_token, account_id


def resolve_device_id(token, account_id):
    """Return the pinned TRACKI_DEVICE_ID, or auto-detect the first device."""
    if DEVICE_ID:
        return DEVICE_ID
    resp = requests.get(
        TRACKI_URL + f"/api/v4/accounts/{account_id}/descendants",
        headers={"Authorization": f"Bearer {token}"},
        timeout=15,
    )
    resp.raise_for_status()
    devices = resp.json().get("devices", [])
    if not devices:
        raise RuntimeError("No devices found on this Tracki account")
    dev_id = devices[0]["device_id"]
    log.info(f"Auto-detected device {dev_id}")
    return dev_id


# ── Location polling ──────────────────────────────────────────────────────────

def fetch_latest_location(token, account_id, device_id):
    """Return the most recent raw location object from Tracki, or None."""
    resp = requests.post(
        TRACKI_URL + f"/api/v3/accounts/{account_id}/locations/filter?limit=1",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        json={"device_ids": [device_id]},
        timeout=15,
    )
    resp.raise_for_status()
    data = resp.json()
    locations = data if isinstance(data, list) else data.get("locations", [])
    return locations[0] if locations else None


def parse_location(raw):
    """Normalize a Tracki location object to the Apps Script schema.
    Returns a dict, or None if lat/lng are missing.
    """
    lat = raw.get("lat") or raw.get("latitude")
    lng = raw.get("lng") or raw.get("lon") or raw.get("longitude")
    if lat is None or lng is None:
        return None

    ts_raw = raw.get("time") or raw.get("timestamp") or raw.get("date")
    if isinstance(ts_raw, (int, float)):
        # Tracki uses milliseconds if the value is > 1e10
        epoch = ts_raw / 1000 if ts_raw > 1e10 else ts_raw
        ts = datetime.fromtimestamp(epoch, tz=timezone.utc).isoformat()
    elif ts_raw:
        ts = ts_raw
    else:
        ts = datetime.now(timezone.utc).isoformat()

    return {
        "timestamp":   ts,
        "lat":         float(lat),
        "lng":         float(lng),
        "altitude":    raw.get("altitude") or raw.get("alt"),
        "battery_pct": raw.get("battery") or raw.get("battery_pct"),
        "speed":       raw.get("speed"),
        "snr":         None,
        "node_id":     str(raw.get("device_id", device_id_hint(raw))),
    }


def device_id_hint(raw):
    return raw.get("id") or raw.get("deviceId") or ""


# ── Reverse geocoding ─────────────────────────────────────────────────────────

def reverse_geocode(lat, lng):
    """Snap exact GPS coordinates to the nearest city centre using Nominatim.

    Returns (city_display, city_lat, city_lng).
    Falls back to (None, lat, lng) on any error so the bridge never blocks.
    """
    try:
        resp = requests.get(
            NOMINATIM_URL,
            params={
                "format":         "json",
                "lat":            lat,
                "lon":            lng,
                "zoom":           10,        # city-level match
                "addressdetails": 1,
            },
            headers={
                "User-Agent": "WhereIsLouie/1.0 (goodthinklabs.com)",
                "Accept-Language": "en",
            },
            timeout=10,
        )
        resp.raise_for_status()
        data = resp.json()

        addr = data.get("address", {})

        # City name: prefer city > town > village > municipality > county
        city_name = (
            addr.get("city")
            or addr.get("town")
            or addr.get("village")
            or addr.get("municipality")
            or addr.get("county")
            or "Unknown"
        )

        # State: use two-letter code for US ("US-FL" -> "FL"), full name elsewhere
        country_code = addr.get("country_code", "").upper()
        state = addr.get("state", "")
        if country_code == "US":
            iso = addr.get("ISO3166-2-lvl4", "")   # e.g. "US-FL"
            state_code = iso.split("-")[-1] if "-" in iso else state[:2].upper()
            city_display = f"{city_name}, {state_code}" if state_code else city_name
        else:
            city_display = f"{city_name}, {state}" if state else city_name

        # Nominatim returns the centroid of the matched object at zoom=10
        city_lat = float(data.get("lat", lat))
        city_lng = float(data.get("lon", lng))

        log.info(f"City snapped → {city_display} ({city_lat:.4f}, {city_lng:.4f})")
        return city_display, city_lat, city_lng

    except Exception as e:
        log.warning(f"Reverse geocode failed ({e}) — keeping raw coordinates")
        return None, lat, lng


# ── Forwarding ────────────────────────────────────────────────────────────────

def forward_to_sheets(pos):
    payload = {**pos, "secret": BRIDGE_SECRET}
    try:
        r = requests.post(APPS_SCRIPT_URL, json=payload, timeout=15)
        if r.status_code == 200:
            log.info(f"Forwarded to Sheets ✓  ({r.elapsed.total_seconds():.2f}s)")
            return True
        log.warning(f"Sheets responded {r.status_code}: {r.text[:200]}")
    except requests.RequestException as e:
        log.error(f"Failed to reach Apps Script: {e}")
    return False


# ── Config validation ─────────────────────────────────────────────────────────

def validate_config():
    required = {
        "TRACKI_USER":       TRACKI_USER,
        "TRACKI_PASS":       TRACKI_PASS,
        "TRACKI_CLIENT_ID":  CLIENT_ID,
        "TRACKI_CLIENT_SECRET": CLIENT_SECRET,
        "APPS_SCRIPT_URL":   APPS_SCRIPT_URL,
        "BRIDGE_SECRET":     BRIDGE_SECRET,
    }
    missing = [k for k, v in required.items() if not v]
    if missing:
        for k in missing:
            log.error(f"Config error: {k} is not set")
        log.error("Copy .env.example to .env and fill in your values.")
        sys.exit(1)


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Where's Louie? Tracki bridge")
    parser.add_argument("--test", action="store_true",
                        help="Fetch location once, print JSON, don't forward to Sheets")
    parser.add_argument("--once", action="store_true",
                        help="Fetch once, forward to Sheets, then exit")
    args = parser.parse_args()

    validate_config()

    token, account_id = authenticate()
    device_id = resolve_device_id(token, account_id)
    last_ts = None   # deduplicate by timestamp

    log.info(f"Polling device {device_id} every {POLL_INTERVAL}s")

    while True:
        try:
            raw = fetch_latest_location(token, account_id, device_id)

            if raw is None:
                log.info("No location data yet")
            else:
                pos = parse_location(raw)
                if pos is None:
                    log.warning(f"Could not parse location (missing lat/lng): {raw}")
                elif pos["timestamp"] == last_ts:
                    log.debug("No new position since last poll")
                else:
                    log.info(
                        f"Position: lat={pos['lat']:.6f} lng={pos['lng']:.6f} "
                        f"bat={pos['battery_pct']}% speed={pos['speed']}"
                    )
                    # Snap to city centre for privacy — no home addresses on the map
                    city, city_lat, city_lng = reverse_geocode(pos["lat"], pos["lng"])
                    pos["city"]     = city
                    pos["city_lat"] = city_lat
                    pos["city_lng"] = city_lng

                    if args.test:
                        print(json.dumps(pos, indent=2))
                    else:
                        if forward_to_sheets(pos):
                            last_ts = pos["timestamp"]

        except requests.HTTPError as e:
            if e.response is not None and e.response.status_code in (401, 403):
                log.warning("Token expired — re-authenticating…")
                try:
                    token, account_id = authenticate()
                    device_id = resolve_device_id(token, account_id)
                except Exception as auth_err:
                    log.error(f"Re-auth failed: {auth_err}")
            else:
                log.error(f"HTTP error: {e}")
        except Exception as e:
            log.error(f"Unexpected error: {e}")

        if args.test or args.once:
            break

        time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    main()
