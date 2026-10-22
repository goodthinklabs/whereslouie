/**
 * Where's Louie? — Frontend
 * ==========================
 * Reads the public, already-delayed feed from the Apps Script backend.
 * Everything privacy-related (delay, privacy zones, rounding) happens on the
 * server — this file only draws what it's given. No secrets live here.
 */

const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbx1TdexzgG17vAXaXPS5fdS602bHYA7LfRb8fm847AMB_JoWQGiyPBborvPqwP_95LlmQ/exec";
const GOOGLE_FORM_URL = "https://forms.gle/kXjQrsgod1jKWhTd6";
const LOG_PREVIEW = 8;

let map;

document.addEventListener("DOMContentLoaded", async () => {
  const report = document.getElementById("report-btn");
  if (report) {
    report.href = GOOGLE_FORM_URL;
    report.target = "_blank";
    report.rel = "noopener noreferrer";
  }
  initMap();
  await loadData();
});

function initMap() {
  map = L.map("leaflet-map", { center: [39.5, -98.35], zoom: 4, scrollWheelZoom: false });
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 12,
  }).addTo(map);
}

async function loadData() {
  try {
    const res = await fetch(APPS_SCRIPT_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    const stops = data.stops || [];
    renderHeadline(data.latest, data.delay_hours);
    renderStats(data.stats, data.latest);
    renderMap(stops);
    renderLog(stops);
    renderPosts(data.posts || []);
    renderSpotted(data.spotted || []);
  } catch (err) {
    console.error("Failed to load Louie data:", err);
    renderOfflineState();
  }
}

// ── Headline ─────────────────────────────────────────────────────────────────

function renderHeadline(latest, delayHours) {
  const text = document.getElementById("status-text");
  if (!latest) {
    document.getElementById("status").classList.add("status--off");
    text.textContent = "Just getting started. First stop coming soon.";
    return;
  }
  const when = formatRelativeTime(new Date(latest.left));
  text.textContent = latest.secret
    ? `Last seen at a secret location · ${when}`
    : `Last seen in ${latest.label} · ${when}`;

  const note = document.getElementById("delay-note");
  if (note && delayHours) {
    const days = Math.max(1, Math.round(delayHours / 24));
    note.textContent = `The map runs about ${days} day${days === 1 ? "" : "s"} behind on purpose. A rep needs his privacy.`;
  }
}

// ── Stats ────────────────────────────────────────────────────────────────────

function renderStats(stats, latest) {
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set("stat-miles",  stats ? stats.miles.toLocaleString() : "0");
  set("stat-states", stats ? stats.states : "0");
  set("stat-days",   stats ? stats.days_on_road : "0");
  const mood = latest && latest.battery_mood;
  set("stat-battery", mood ? `${mood.emoji} ${mood.text}` : "—");
}

// ── Map ──────────────────────────────────────────────────────────────────────

function renderMap(stops) {
  const onMap = stops.filter(s => !s.secret && s.lat != null);
  if (!onMap.length) {
    document.getElementById("map-no-data").hidden = false;
    document.getElementById("leaflet-map").hidden = true;
    return;
  }
  const latlngs = onMap.map(s => [s.lat, s.lng]);
  L.polyline(latlngs, { color: "#111111", weight: 7, opacity: 1, lineCap: "round", lineJoin: "round" }).addTo(map);
  L.polyline(latlngs, { color: "#FFD31A", weight: 4, opacity: 1, lineCap: "round", lineJoin: "round" }).addTo(map);

  onMap.forEach((s, i) => {
    const isFirst = i === 0, isLast = i === onMap.length - 1;
    const label = escapeHtml(s.label);
    let html, anchor;
    if (isLast) {
      html = `<div class="louie-pin"><span class="face" aria-hidden="true"></span><span class="pin-label">${label}</span></div>`;
      anchor = [26, 26];
    } else {
      html = `<div class="pin-wrap"><div class="pin${isFirst ? " pin--start" : ""}"></div>${isFirst ? `<span class="pin-label">Start · ${label}</span>` : ""}</div>`;
      anchor = [7, 7];
    }
    const marker = L.marker([s.lat, s.lng], {
      icon: L.divIcon({ html, className: "", iconSize: null, iconAnchor: anchor }),
      zIndexOffset: isLast ? 1000 : 0,
    }).addTo(map);
    if (!isFirst && !isLast) marker.bindTooltip(label, { direction: "top", offset: [0, -8] });
    marker.bindPopup(`<strong>${label}</strong><br><span style="font-family:var(--mono);font-size:.8rem">${stayText(s)}</span>`);
  });
  map.fitBounds(L.latLngBounds(latlngs).pad(0.15), { maxZoom: 8 });
}

// ── Trip log ─────────────────────────────────────────────────────────────────

function renderLog(stops) {
  const list = document.getElementById("stops-list");
  if (!stops.length) { document.getElementById("log").hidden = true; return; }
  document.getElementById("log-count").textContent = `${stops.length} stop${stops.length === 1 ? "" : "s"}`;

  const items = stops.map((s, i) => ({ s, n: i + 1 })).reverse();
  list.innerHTML = items.map(({ s, n }, i) => `
    <li class="stop${s.secret ? " stop--secret" : ""}${i === 0 ? " stop--latest" : ""}"${i >= LOG_PREVIEW ? " hidden" : ""}>
      <span class="stop-n">${String(n).padStart(2, "0")}</span>
      <span class="stop-name">${escapeHtml(s.secret ? "Resting at a secret location" : s.label)}</span>
      <span class="stop-date">${stayText(s)}</span>
    </li>`).join("");

  if (items.length > LOG_PREVIEW) {
    const btn = document.createElement("button");
    btn.className = "btn btn-ghost stops-more";
    btn.textContent = `Show all ${items.length} stops`;
    btn.addEventListener("click", () => {
      list.querySelectorAll("li[hidden]").forEach(li => { li.hidden = false; });
      btn.remove();
    });
    list.after(btn);
  }
}

function stayText(s) {
  const a = formatDate(new Date(s.arrived + "T12:00:00Z"));
  const b = formatDate(new Date(s.left));
  return a === b ? a : `${a} – ${b}`;
}

// ── Field reports ────────────────────────────────────────────────────────────

function renderPosts(posts) {
  document.getElementById("posts-loading").hidden = true;
  if (!posts.length) { document.getElementById("posts-empty").hidden = false; return; }

  const grid = document.getElementById("posts-grid");
  const tpl  = document.getElementById("post-card-template");
  posts.forEach((post, i) => {
    const card = tpl.content.cloneNode(true);
    const img  = card.querySelector(".post-photo-img");
    if (post.photo_url) {
      img.src = convertDriveUrl(post.photo_url);
      img.alt = `Photo from ${post.name || "one of Louie's hosts"}`;
      img.addEventListener("error", () => { img.hidden = true; img.parentElement.hidden = true; });
    } else {
      img.hidden = true;
      img.parentElement.hidden = true;
    }
    card.querySelector(".post-number").textContent   = `Report #${posts.length - i}`;
    card.querySelector(".post-location").textContent = post.location || "Somewhere good";
    card.querySelector(".post-story").textContent    = post.story || "Quack.";
    card.querySelector(".post-name").textContent     = post.name || "Anonymous";
    card.querySelector(".post-date").textContent     = formatDate(new Date(post.timestamp + "T12:00:00Z"));
    grid.appendChild(card);
  });
}

function convertDriveUrl(url) {
  const m = url.match(/[?&]id=([^&]+)/) || url.match(/\/file\/d\/([^/]+)/);
  return m ? `https://drive.google.com/thumbnail?id=${m[1]}&sz=w800` : url;
}

// ── Spotted on LinkedIn ──────────────────────────────────────────────────────

function renderSpotted(items) {
  const grid = document.getElementById("spotted-grid");
  if (!items.length) { document.getElementById("spotted-empty").hidden = false; return; }
  grid.innerHTML = items.map(p => `
    <figure class="spot">
      <iframe src="${escapeHtml(p.embed)}" title="LinkedIn post featuring Louie" loading="lazy" allowfullscreen></iframe>
      <figcaption><span>${escapeHtml(formatDate(new Date(p.date + "T12:00:00Z")))}</span>
        <a href="${escapeHtml(p.url)}" target="_blank" rel="noopener">View on LinkedIn ↗</a></figcaption>
    </figure>`).join("");
}

// ── Offline ──────────────────────────────────────────────────────────────────

function renderOfflineState() {
  document.getElementById("status").classList.add("status--off");
  document.getElementById("status-text").textContent = "Louie's off the grid. Check back soon.";
  document.getElementById("posts-loading").hidden = true;
  document.getElementById("posts-empty").hidden = false;
  document.getElementById("map-no-data").hidden = false;
  document.getElementById("leaflet-map").hidden = true;
  document.getElementById("log").hidden = true;
  document.getElementById("spotted-empty").hidden = false;
}

// ── Utilities ────────────────────────────────────────────────────────────────

function formatRelativeTime(date) {
  const hours = Math.floor((Date.now() - date.getTime()) / 3_600_000);
  const days  = Math.floor(hours / 24);
  if (hours < 72) return `${Math.max(hours, 1)} hours ago`;
  if (days  < 30) return `${days} days ago`;
  return formatDate(date);
}

function formatDate(date) {
  if (isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
