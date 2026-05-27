/**
 * Where's Louie? — Frontend App
 * ===============================
 * Fetches data from Google Apps Script, renders the route map and blog grid.
 *
 * ⚠️  CONFIGURE THIS:
 * Replace the APPS_SCRIPT_URL below with your deployed Apps Script Web App URL.
 */

const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbx1TdexzgG17vAXaXPS5fdS602bHYA7LfRb8fm847AMB_JoWQGiyPBborvPqwP_95LlmQ/exec";

// Google Form URL for submitting stories (update after creating your form)
const GOOGLE_FORM_URL = "https://forms.gle/kXjQrsgod1jKWhTd6";

// How old a position must be (in hours) before we consider it "stale"
const STALE_THRESHOLD_HOURS = 6;

// ── State ─────────────────────────────────────────────────────────────────────
let map;
let positions  = [];
let posts      = [];
let latest     = null;

// ── Entry point ───────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", async () => {
  initFormLinks();
  initMap();
  await loadData();
});

// ── Form links ────────────────────────────────────────────────────────────────

function initFormLinks() {
  document.querySelectorAll("#submit-btn, #submit-cta-btn").forEach(btn => {
    btn.addEventListener("click", e => {
      e.preventDefault();
      window.open(GOOGLE_FORM_URL, "_blank", "noopener,noreferrer");
    });
  });
}

// ── Map init ──────────────────────────────────────────────────────────────────

function initMap() {
  map = L.map("leaflet-map", {
    center: [39.5, -98.35],  // Center of US as default
    zoom: 4,
    zoomControl: true,
  });

  // OpenStreetMap tiles (dark-ish via CSS filter in style.css)
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 18,
  }).addTo(map);
}

// ── Data loading ──────────────────────────────────────────────────────────────

async function loadData() {
  try {
    const url = `${APPS_SCRIPT_URL}?action=all`;
    const res  = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    positions = data.positions || [];
    posts     = data.posts     || [];
    latest    = data.latest    || null;

    renderAll();
  } catch (err) {
    console.error("Failed to load Louie data:", err);
    renderOfflineState();
  }
}

function renderAll() {
  updateHeroStatus();
  updateStats();
  renderMap();
  renderPosts();
}

// ── Hero status ───────────────────────────────────────────────────────────────

function updateHeroStatus() {
  const dot  = document.getElementById("status-dot");
  const text = document.getElementById("status-text");

  if (!latest) {
    dot.className  = "status-dot offline";
    text.textContent = "No positions yet — Louie hasn't set off yet.";
    return;
  }

  const lastSeen   = new Date(latest.timestamp);
  const hoursAgo   = (Date.now() - lastSeen.getTime()) / 3_600_000;
  const timeStr    = formatRelativeTime(lastSeen);
  const battery    = latest.battery_pct != null ? ` · 🔋 ${Math.round(latest.battery_pct)}%` : "";
  const cityStr    = latest.city ? ` · 📍 ${latest.city}` : "";

  if (hoursAgo < 1) {
    dot.className    = "status-dot live";
    text.textContent = `Last seen ${timeStr}${cityStr}${battery}`;
  } else if (hoursAgo < STALE_THRESHOLD_HOURS) {
    dot.className    = "status-dot stale";
    text.textContent = `Last seen ${timeStr}${cityStr}${battery}`;
  } else {
    dot.className    = "status-dot offline";
    text.textContent = `Last seen ${timeStr}${cityStr}${battery} — might be off-grid`;
  }
}

// ── Stats bar ─────────────────────────────────────────────────────────────────

function updateStats() {
  // Count unique cities visited
  const uniqueCities = deduplicateCities(positions).length;
  document.getElementById("stat-stops").textContent   = uniqueCities || "0";

  // Rough distance in miles from route
  const miles = computeRouteMiles(positions);
  document.getElementById("stat-miles").textContent   = miles > 0 ? miles.toLocaleString() : "0";

  document.getElementById("stat-stories").textContent = posts.length || "0";

  // Battery from latest position
  const bat = latest && latest.battery_pct != null
    ? `${Math.round(latest.battery_pct)}%`
    : "—";
  document.getElementById("stat-battery").textContent = bat;
}

function computeRouteMiles(pts) {
  if (pts.length < 2) return 0;
  let totalKm = 0;
  for (let i = 1; i < pts.length; i++) {
    totalKm += haversineKm(pts[i - 1], pts[i]);
  }
  return Math.round(totalKm * 0.621371);
}

function haversineKm(a, b) {
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sin2 = Math.sin(dLat / 2) ** 2 +
               Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(sin2));
}

function toRad(deg) { return deg * Math.PI / 180; }

// ── Map rendering ─────────────────────────────────────────────────────────────

/**
 * Return the display [lat, lng] for a position.
 * Prefers city-snapped coordinates; falls back to raw GPS.
 */
function displayCoords(pos) {
  return (pos.city_lat != null && pos.city_lng != null)
    ? [pos.city_lat, pos.city_lng]
    : [pos.lat, pos.lng];
}

/**
 * Collapse consecutive positions in the same city into one entry so we don't
 * stack dozens of pins on the same spot. Each unique consecutive city = one pin.
 * Positions with no city info are kept as-is.
 */
function deduplicateCities(pts) {
  const result = [];
  let lastCity = undefined;
  for (const p of pts) {
    if (p.city == null || p.city !== lastCity) {
      result.push(p);
      lastCity = p.city;
    } else {
      // Same city as previous — update the entry so the timestamp stays current
      result[result.length - 1] = p;
    }
  }
  return result;
}

function renderMap() {
  if (positions.length === 0) {
    document.getElementById("map-no-data").style.display = "";
    document.querySelector(".map-wrapper").style.display  = "none";
    return;
  }

  // Deduplicate to unique city stops for clean map rendering
  const stops    = deduplicateCities(positions);
  const latlngs  = stops.map(displayCoords);

  // Route polyline connecting city centres
  L.polyline(latlngs, {
    color:     "#3b93a7",
    weight:    3,
    opacity:   0.85,
    dashArray: null,
  }).addTo(map);

  // City stop markers — labelled dot for each unique city
  stops.forEach((stop, i) => {
    const coord    = displayCoords(stop);
    const isFirst  = i === 0;
    const isLast   = i === stops.length - 1;
    const cityName = stop.city || null;
    const timeStr  = formatRelativeTime(new Date(stop.timestamp));

    if (isLast) {
      // Current position — rubber duck SVG + city label
      const duckSvg = `<svg class="duck-marker" viewBox="0 0 108 85" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <ellipse cx="46" cy="67" rx="44" ry="22" fill="#FFD93D"/>
        <circle cx="70" cy="38" r="24" fill="#FFD93D"/>
        <path d="M90 31 L107 28 Q109 37 107 44 L90 43Z" fill="#FF8C38"/>
        <line x1="90" y1="37" x2="107" y2="36" stroke="#D4692A" stroke-width="1.2" opacity="0.45"/>
        <circle cx="80" cy="27" r="5.5" fill="#1a1a1a"/>
        <circle cx="81.5" cy="25.5" r="2" fill="white"/>
        <path d="M14 64 Q32 54 50 64" stroke="#E6B800" stroke-width="2.5" fill="none" stroke-linecap="round" opacity="0.6"/>
      </svg>`;
      const duckHtml = cityName
        ? `<div class="duck-pin">${duckSvg}<span class="city-pin-label city-pin-label--current">${cityName}</span></div>`
        : duckSvg;

      L.marker(coord, {
        icon: L.divIcon({
          html:       duckHtml,
          className:  "",
          iconSize:   null,
          iconAnchor: [18, 29],
        }),
      })
        .addTo(map)
        .bindPopup(buildLatestPopup(), { maxWidth: 260 });

    } else if (isFirst) {
      // Start marker — green dot + city label
      const startHtml = cityName
        ? `<div class="city-pin city-pin--start">
             <div class="city-pin-dot city-pin-dot--start"></div>
             <span class="city-pin-label">${cityName}</span>
           </div>`
        : `<div class="start-marker"></div>`;

      L.marker(coord, {
        icon: L.divIcon({
          html:       startHtml,
          className:  "",
          iconSize:   null,
          iconAnchor: [7, 7],
        }),
      })
        .addTo(map)
        .bindTooltip(`Louie's journey began here 🦆`, { direction: "top" });

    } else {
      // Intermediate city stop — teal dot + label
      const stopHtml = cityName
        ? `<div class="city-pin">
             <div class="city-pin-dot"></div>
             <span class="city-pin-label">${cityName}</span>
           </div>`
        : `<div class="city-pin">
             <div class="city-pin-dot"></div>
           </div>`;

      L.marker(coord, {
        icon: L.divIcon({
          html:       stopHtml,
          className:  "",
          iconSize:   null,
          iconAnchor: [7, 7],
        }),
      })
        .addTo(map)
        .bindPopup(
          `<b>${cityName || "Unknown location"}</b><br>Louie passed through ${timeStr}`,
          { maxWidth: 200 }
        );
    }
  });

  // Fit map to all city stops
  map.fitBounds(L.latLngBounds(latlngs).pad(0.15));
}

function buildLatestPopup() {
  if (!latest) return "<b>🦆 Louie</b>";
  const timeStr  = formatRelativeTime(new Date(latest.timestamp));
  const bat      = latest.battery_pct != null ? `<br>🔋 ${Math.round(latest.battery_pct)}%` : "";
  const cityLine = latest.city ? `<br>📍 ${latest.city}` : "";
  return `<b>🦆 Louie</b>${cityLine}<br>Last seen ${timeStr}${bat}`;
}

// ── Blog posts ────────────────────────────────────────────────────────────────

function renderPosts() {
  const loading = document.getElementById("posts-loading");
  const empty   = document.getElementById("posts-empty");
  const grid    = document.getElementById("posts-grid");

  loading.style.display = "none";

  if (posts.length === 0) {
    empty.style.display = "";
    return;
  }

  const template = document.getElementById("post-card-template");

  posts.forEach((post, i) => {
    const card     = template.content.cloneNode(true);
    const article  = card.querySelector("article");

    // Photo
    const img         = card.querySelector(".post-photo-img");
    const placeholder = card.querySelector(".post-photo-placeholder");
    if (post.photo_url) {
      // Convert Google Drive view URL to direct thumbnail if needed
      img.src = convertDriveUrl(post.photo_url);
      img.alt = `Photo by ${post.name}`;
      img.addEventListener("load", () => img.classList.add("loaded"));
      img.addEventListener("error", () => {
        img.style.display = "none";
      });
    } else {
      img.style.display = "none";
    }

    // Meta
    card.querySelector(".post-number").textContent  = `#${posts.length - i}`;
    card.querySelector(".post-location").textContent = `📍 ${post.location || "Unknown location"}`;
    card.querySelector(".post-story").textContent    = post.story || "No story shared.";
    card.querySelector(".post-name").textContent     = post.name  || "Anonymous";
    card.querySelector(".post-date").textContent     = formatDate(new Date(post.timestamp));

    grid.appendChild(card);
  });
}

/**
 * Converts a Google Drive "view" or "open" URL to a thumbnail URL
 * that can be used directly in an <img> tag without auth.
 *
 * Google Form photo uploads land as Drive view links like:
 *   https://drive.google.com/open?id=FILE_ID
 *   https://drive.google.com/file/d/FILE_ID/view
 */
function convertDriveUrl(url) {
  if (!url) return "";

  // Extract file ID from various Drive URL formats
  let fileId = null;

  const openMatch = url.match(/[?&]id=([^&]+)/);
  if (openMatch) fileId = openMatch[1];

  const fileMatch = url.match(/\/file\/d\/([^/]+)/);
  if (fileMatch) fileId = fileMatch[1];

  if (fileId) {
    // Use Google's thumbnail endpoint — no auth needed for public Drive files
    return `https://drive.google.com/thumbnail?id=${fileId}&sz=w800`;
  }

  return url;  // Return as-is if we can't parse it
}

// ── Offline state ─────────────────────────────────────────────────────────────

function renderOfflineState() {
  const dot  = document.getElementById("status-dot");
  const text = document.getElementById("status-text");
  dot.className    = "status-dot offline";
  text.textContent = "Can't reach tracking server — check back soon.";

  document.getElementById("posts-loading").style.display = "none";
  document.getElementById("posts-empty").style.display   = "";
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function formatRelativeTime(date) {
  const diff    = Date.now() - date.getTime();
  const mins    = Math.floor(diff / 60_000);
  const hours   = Math.floor(diff / 3_600_000);
  const days    = Math.floor(diff / 86_400_000);

  if (mins   < 2)   return "just now";
  if (mins   < 60)  return `${mins}m ago`;
  if (hours  < 24)  return `${hours}h ago`;
  if (days   < 30)  return `${days}d ago`;
  return formatDate(date);
}

function formatDate(date) {
  if (isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
