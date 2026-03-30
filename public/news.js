function isLocalServerHost() {
  return ["localhost", "127.0.0.1"].includes(window.location.hostname);
}

function getConnectionErrorMessage() {
  if (!navigator.onLine) {
    return "Cannot reach the server. Check your internet connection and try again.";
  }

  if (isLocalServerHost()) {
    return "Cannot reach the local server. Start the project with .\\run.cmd, then refresh the page and try again.";
  }

  return "Cannot reach the server. Check your internet connection or try again later.";
}

function getInvalidResponseMessage() {
  if (isLocalServerHost()) {
    return "The local server returned an invalid response. Restart it and try again.";
  }

  return "The server returned an invalid response. Refresh the page or try again later.";
}

async function requestJSON(url, options = {}) {
  let res;
  try {
    res = await fetch(url, {
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {})
      },
      ...options
    });
  } catch (error) {
    throw new Error(getConnectionErrorMessage());
  }

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const error = new Error(data?.error || `Request failed: ${res.status}`);
    error.status = res.status;
    throw error;
  }

  if (data === null) {
    throw new Error(getInvalidResponseMessage());
  }

  return data;
}

function getJSON(url) {
  return requestJSON(url);
}

function postJSON(url, body) {
  return requestJSON(url, {
    method: "POST",
    body: JSON.stringify(body)
  });
}

function deleteJSON(url) {
  return requestJSON(url, { method: "DELETE" });
}

function escapeHtml(value) {
  const replacements = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  };

  return String(value ?? "").replace(/[&<>"']/g, (character) => replacements[character]);
}

function readInputValue(id) {
  const element = document.getElementById(id);
  return element ? element.value.trim() : "";
}

function setTodayDefault(inputId) {
  const input = document.getElementById(inputId);
  if (input && !input.value) {
    input.value = new Date().toISOString().slice(0, 10);
  }
}

function resetWeeklyNewsForm() {
  document.getElementById("weeklyNewsForm")?.reset();
  setTodayDefault("newsDateInput");
}

function resetSpotlightForm() {
  document.getElementById("spotlightAwardForm")?.reset();
  document.getElementById("honorTypeInput").value = "best_player_of_week";
  syncHonorFields();
}

function formatDate(value) {
  if (!value) {
    return "";
  }

  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric"
  });
}

const HONOR_CARD_CONFIG = [
  {
    type: "best_player_of_week",
    label: "Best Player Of The Week",
    kind: "player",
    accent: "week"
  },
  {
    type: "best_goalkeeper",
    label: "Best Goalkeeper",
    kind: "player",
    accent: "goalkeeper"
  },
  {
    type: "best_team_of_week",
    label: "Best Team Of The Week",
    kind: "team",
    accent: "month"
  },
  {
    type: "best_team_of_month",
    label: "Best Team Of The Month",
    kind: "team",
    accent: "team"
  }
];

const state = {
  organizer: null
};

function setPageMessage(message) {
  const el = document.getElementById("newsPageMessage");
  if (!el) {
    return;
  }

  el.textContent = message || "";
  el.classList.toggle("hidden", !message);
}

function setEditorMessage(message) {
  const el = document.getElementById("newsEditorMessage");
  if (!el) {
    return;
  }

  el.textContent = message || "";
  el.classList.toggle("hidden", !message);
}

function updateSessionBadge() {
  const badge = document.getElementById("newsSessionBadge");
  const editorSection = document.getElementById("newsEditorSection");

  if (state.organizer) {
    badge.textContent = `Organizer | ${state.organizer.username}`;
    badge.classList.remove("hidden");
    editorSection.classList.remove("hidden");
    setPageMessage("Organizer session detected. You can publish tournament news from this page.");
    return;
  }

  badge.textContent = "";
  badge.classList.add("hidden");
  editorSection.classList.add("hidden");
  setPageMessage("Public news view. Log in as an organizer on the dashboard if you need to publish updates.");
}

function isPlayerHonorType(type) {
  return type === "best_player_of_week" || type === "best_goalkeeper";
}

function renderHonorGrid(rows) {
  const grid = document.getElementById("honorGrid");
  const honorsByType = Object.fromEntries(rows.map((row) => [row.honor_type, row]));

  grid.innerHTML = HONOR_CARD_CONFIG.map((config) => {
    const honor = honorsByType[config.type];
    if (!honor) {
      return `
        <article class="honor-card ${config.accent}">
          <div class="honor-kicker">${escapeHtml(config.label)}</div>
          <div class="honor-name">No selection yet</div>
          <div class="honor-meta">Waiting for the organizer to publish this spotlight.</div>
        </article>
      `;
    }

    const isTeamAward = config.kind === "team";
    const primaryName = isTeamAward ? honor.team_name : honor.player_name;
    const secondary = isTeamAward
      ? honor.description || "Current standout team selection."
      : `${honor.position || "Player"}${honor.player_team_name ? ` - ${honor.player_team_name}` : ""}`;

    return `
      <article class="honor-card ${config.accent}">
        <div class="honor-kicker">${escapeHtml(config.label)}</div>
        <div class="honor-title">${escapeHtml(honor.title)}</div>
        <div class="honor-name">${escapeHtml(primaryName || "No selection yet")}</div>
        <div class="honor-meta">${escapeHtml(secondary)}</div>
        <div class="honor-description">${escapeHtml(honor.description || "Official spotlight selection for this award.")}</div>
      </article>
    `;
  }).join("");
}

function syncHonorFields() {
  const type = readInputValue("honorTypeInput") || "best_player_of_week";
  const playerInput = document.getElementById("honorPlayerInput");
  const teamInput = document.getElementById("honorTeamInput");
  const helperText = document.getElementById("honorHelperText");
  const isPlayerAward = isPlayerHonorType(type);

  if (playerInput) {
    playerInput.disabled = !isPlayerAward;
    playerInput.required = isPlayerAward;
    if (!isPlayerAward) {
      playerInput.value = "";
    }
  }

  if (teamInput) {
    teamInput.disabled = false;
    teamInput.required = true;
  }

  if (helperText) {
    helperText.textContent = isPlayerAward
      ? "Player awards use a team number plus a jersey number."
      : type === "best_team_of_week"
        ? "Best team of the week uses a team number."
        : "Best team of the month uses a team number.";
  }
}

function renderNewsFeed(rows) {
  const feed = document.getElementById("newsFeed");

  if (!rows.length) {
    feed.innerHTML = `<div class="empty-state">No weekly news has been published yet.</div>`;
    return;
  }

  feed.innerHTML = rows.map((row) => {
    const teamLine = row.featured_team_name ? `Featured team: ${row.featured_team_name}` : "Tournament-wide update";
    return `
      <article class="news-article">
        <div class="news-article-topline">
          <span class="news-week-pill">${escapeHtml(row.week_label)}</span>
          <span class="news-date">${escapeHtml(formatDate(row.published_on))}</span>
        </div>
        <h3>${escapeHtml(row.headline)}</h3>
        <p class="news-summary">${escapeHtml(row.summary)}</p>
        <div class="news-body">${escapeHtml(row.body).replace(/\n/g, "<br />")}</div>
        <div class="news-footer">${escapeHtml(teamLine)}</div>
      </article>
    `;
  }).join("");
}

async function loadHonors() {
  const rows = await getJSON("/api/news/honors");
  renderHonorGrid(rows);
}

async function loadWeeklyNews() {
  const rows = await getJSON("/api/news/weekly");
  renderNewsFeed(rows);
}

async function detectOrganizerSession() {
  try {
    const response = await getJSON("/api/organizer/me");
    state.organizer = response.organizer || response.admin;
  } catch (error) {
    state.organizer = null;
  }

  updateSessionBadge();
}

async function refreshNewsPage() {
  await Promise.all([detectOrganizerSession(), loadHonors(), loadWeeklyNews()]);
}

async function handleEditorMutation(config) {
  setEditorMessage(config.pendingMessage || "Saving...");

  try {
    const response = await config.run();
    if (config.reset === "weekly") {
      resetWeeklyNewsForm();
    }
    if (config.reset === "spotlight") {
      resetSpotlightForm();
    }
    await refreshNewsPage();
    setEditorMessage(response.message || config.successMessage || "Saved successfully.");
  } catch (error) {
    if (error.status === 401) {
      state.organizer = null;
      updateSessionBadge();
      setEditorMessage("Organizer session expired. Log in again from the dashboard.");
      return;
    }

    setEditorMessage(error.message);
  }
}

document.getElementById("refreshNewsPage")?.addEventListener("click", () => {
  refreshNewsPage();
});

document.getElementById("jumpToFeed")?.addEventListener("click", () => {
  document.getElementById("weeklyNewsSection")?.scrollIntoView({ behavior: "smooth", block: "start" });
});

document.getElementById("clearWeeklyNewsForm")?.addEventListener("click", () => {
  resetWeeklyNewsForm();
});

document.getElementById("clearSpotlightForm")?.addEventListener("click", () => {
  resetSpotlightForm();
});

document.getElementById("honorTypeInput")?.addEventListener("change", () => {
  syncHonorFields();
});

document.getElementById("weeklyNewsForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();

  await handleEditorMutation({
    pendingMessage: "Publishing weekly news...",
    successMessage: "Weekly news saved successfully.",
    reset: "weekly",
    run: () => postJSON("/api/organizer/news/weekly", {
      news_id: readInputValue("newsIdInput"),
      week_label: readInputValue("newsWeekInput"),
      headline: readInputValue("newsHeadlineInput"),
      summary: readInputValue("newsSummaryInput"),
      body: readInputValue("newsBodyInput"),
      published_on: readInputValue("newsDateInput"),
      featured_team_number: readInputValue("newsFeaturedTeamInput")
    })
  });
});

document.getElementById("weeklyNewsDeleteForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();

  await handleEditorMutation({
    pendingMessage: "Deleting weekly news...",
    successMessage: "Weekly news deleted successfully.",
    run: () => deleteJSON(`/api/organizer/news/weekly/${encodeURIComponent(readInputValue("deleteNewsIdInput"))}`)
  });
});

document.getElementById("spotlightAwardForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();

  await handleEditorMutation({
    pendingMessage: "Saving spotlight award...",
    successMessage: "Spotlight award saved successfully.",
    reset: "spotlight",
    run: () => postJSON("/api/organizer/news/honors", {
      honor_type: readInputValue("honorTypeInput"),
      player_number: readInputValue("honorPlayerInput"),
      player_team: readInputValue("honorTeamInput"),
      team_number: readInputValue("honorTeamInput"),
      description: readInputValue("honorDescriptionInput")
    })
  });
});

document.getElementById("spotlightAwardDeleteForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();

  await handleEditorMutation({
    pendingMessage: "Deleting spotlight award...",
    successMessage: "Spotlight award deleted successfully.",
    run: () => deleteJSON(`/api/organizer/news/honors/${encodeURIComponent(readInputValue("deleteHonorTypeInput"))}`)
  });
});

resetWeeklyNewsForm();
resetSpotlightForm();
refreshNewsPage().catch((error) => {
  setPageMessage(error.message);
});
