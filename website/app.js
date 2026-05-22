/**
 * Where's Louie? — Frontend App
 * ===============================
 * Fetches data from Google Apps Script, renders the route map and blog grid.
 *
 * ⚠️  CONFIGURE THIS:
 * Replace the APPS_SCRIPT_URL below with your deployed Apps Script Web App URL.
 */

const APPS_SCRIPT_URL = "https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID_HERE/exec";

// Google Form URL for submitting stories (update after creating your form)
const GOOGLE_FORM_URL = "https://forms.gle/YOUR_FORM_LINK_HERE";

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
    text.textContent = "No positions yet — Louie hasn't been spotted on the mesh.";
    return;
  }

  const lastSeen   = new Date(latest.timestamp);
  const hoursAgo   = (Date.now() - lastSeen.getTime()) / 3_600_000;
  const timeStr    = formatRelativeTime(lastSeen);
  const battery    = latest.battery_pct != null ? ` · 🔋 ${Math.round(latest.battery_pct)}%` : "";

  if (hoursAgo < 1) {
    dot.className    = "status-dot live";
    text.textContent = `Last seen ${timeStr}${battery}`;
  } else if (hoursAgo < STALE_THRESHOLD_HOURS) {
    dot.className    = "status-dot stale";
    text.textContent = `Last seen ${timeStr}${battery}`;
  } else {
    dot.className    = "status-dot offline";
    text.textContent = `Last seen ${timeStr}${battery} — might be off-grid`;
  }
}

// ── Stats bar ─────────────────────────────────────────────────────────────────

function updateStats() {
  // Number of community stops = approved posts
  document.getElementById("stat-stops").textContent   = posts.length || "0";

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

function renderMap() {
  if (positions.length === 0) {
    document.getElementById("map-no-data").style.display = "";
    document.querySelector(".map-wrapper").style.display  = "none";
    return;
  }

  const latlngs = positions.map(p => [p.lat, p.lng]);

  // Route polyline
  L.polyline(latlngs, {
    color:     "#3b93a7",
    weight:    3,
    opacity:   0.85,
    dashArray: null,
  }).addTo(map);

  // Start marker (green dot)
  L.marker(latlngs[0], {
    icon: L.divIcon({
      html:      '<div class="start-marker"></div>',
      className: "",
      iconSize:  [14, 14],
      iconAnchor:[7, 7],
    }),
  })
    .bindTooltip("Louie's journey began here 🦆", { direction: "top" })
    .addTo(map);

  // Community stop markers (yellow numbered)
  posts.forEach((post, i) => {
    // Find the closest position to the post's timestamp for the map pin
    // Since posts don't have lat/lng directly, we skip map pinning unless
    // a position is close in time. Show them as timeline markers below.
    // For now just number them near the current route centroid (future: geocode location name).
  });

  // Current / latest position — duck emoji marker
  const currentPos = latlngs[latlngs.length - 1];
  const duckIcon = L.divIcon({
    html:      '<div class="duck-marker">🦆</div>',
    className: "",
    iconSize:  [36, 36],
    iconAnchor:[18, 36],
  });

  const duckMarker = L.marker(currentPos, { icon: duckIcon })
    .addTo(map)
    .bindPopup(buildLatestPopup(), { maxWidth: 260 });

  // Fit map to route
  map.fitBounds(L.latLngBounds(latlngs).pad(0.15));
}

function buildLatestPopup() {
  if (!latest) return "<b>🦆 Louie</b>";
  const timeStr = formatRelativeTime(new Date(latest.timestamp));
  const bat     = latest.battery_pct != null ? `<br>🔋 ${Math.round(latest.battery_pct)}%` : "";
  const alt     = latest.altitude    != null ? `<br>⛰ ${latest.altitude}m alt` : "";
  return `
    <b>🦆 Louie</b><br>
    Last seen ${timeStr}${bat}${alt}
  `;
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
