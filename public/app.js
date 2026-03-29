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
    error.details = data?.details;
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

function putJSON(url, body) {
  return requestJSON(url, {
    method: "PUT",
    body: JSON.stringify(body)
  });
}

function deleteJSON(url) {
  return requestJSON(url, { method: "DELETE" });
}

const DATASETS = [
  { id: "teams", label: "Teams", description: "Registered clubs and their captains." },
  { id: "players", label: "Players", description: "All players and the team number they belong to." },
  { id: "team_members", label: "Team Members", description: "Team-by-team member list with positions." },
  { id: "team_of_season", label: "Team Of Season", description: "Current team of the season selections." },
  { id: "fixtures", label: "Fixtures", description: "Match schedule, referees, scorelines, and status." },
  { id: "stats", label: "Match Stats", description: "Per-match player stat lines used for goals, assists, and cards." },
  { id: "league_table", label: "League Table", description: "Standings with points, wins, draws, and goal difference." },
  { id: "top_goals", label: "Top Goals", description: "Leading goal scorers across the tournament." },
  { id: "top_assists", label: "Top Assists", description: "Assist leaders across the tournament." },
  { id: "yellow_cards", label: "Yellow Cards", description: "Players with the most yellow cards." },
  { id: "red_cards", label: "Red Cards", description: "Players with the most red cards." }
];

const HIGHLIGHT_CARDS = [
  {
    id: "top_goals",
    title: "Top Goals",
    metric: "Goals",
    valueKey: "total_goals",
    iconClass: "goals",
    icon: `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 2 3 7v10l9 5 9-5V7l-9-5Zm0 3.2 5.8 3.2v6.5L12 18 6.2 14.9V8.4L12 5.2Z"/>
      </svg>
    `
  },
  {
    id: "top_assists",
    title: "Top Assists",
    metric: "Assists",
    valueKey: "total_assists",
    iconClass: "assists",
    icon: `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 12h8.2l-2.6-2.6L12 8l5 5-5 5-1.4-1.4 2.6-2.6H5v-2Z"/>
      </svg>
    `
  },
  {
    id: "yellow_cards",
    title: "Yellow Cards",
    metric: "Cards",
    valueKey: "total_yellow_cards",
    iconClass: "yellow",
    icon: `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="7" y="3" width="10" height="18" rx="2" ry="2"/>
      </svg>
    `
  },
  {
    id: "red_cards",
    title: "Red Cards",
    metric: "Cards",
    valueKey: "total_red_cards",
    iconClass: "red",
    icon: `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="7" y="3" width="10" height="18" rx="2" ry="2"/>
      </svg>
    `
  }
];

const datasetMap = Object.fromEntries(DATASETS.map((dataset) => [dataset.id, dataset]));
const ROLE_CONFIG = {
  player: {
    label: "Player",
    userLabel: "Username",
    secretLabel: "Code",
    userPlaceholder: "",
    secretPlaceholder: "",
    secretType: "password"
  },
  organizer: {
    label: "Organizer",
    userLabel: "Username",
    secretLabel: "Password",
    userPlaceholder: "",
    secretPlaceholder: "",
    secretType: "password"
  }
};

const state = {
  activeDatasetId: "teams",
  entryRole: "player",
  role: null,
  player: null,
  organizer: null,
  chatSeeded: false,
  loadedTeamNumber: null
};

function escapeHtml(value) {
  const replacements = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  };

  return String(value).replace(/[&<>"']/g, (character) => replacements[character]);
}

function formatLabel(value) {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatCellValue(value) {
  if (value === null || value === undefined) {
    return "";
  }

  return escapeHtml(value);
}

function formatMatchLine(fixture) {
  return `${fixture.home_team} vs ${fixture.away_team}`;
}

function renderListItems(items, renderItem, emptyMessage) {
  if (!items.length) {
    return `<div class="muted">${escapeHtml(emptyMessage)}</div>`;
  }

  return `<div class="list">${items.map(renderItem).join("")}</div>`;
}

function readInputValue(id) {
  const element = document.getElementById(id);
  return element ? element.value.trim() : "";
}

function clearForm(formId) {
  const form = document.getElementById(formId);
  if (!form) {
    return;
  }

  form.reset();

  if (formId === "adminMatchForm") {
    document.getElementById("matchStatusInput").value = "scheduled";
    document.getElementById("homeGoalsInput").value = "0";
    document.getElementById("awayGoalsInput").value = "0";
    return;
  }

  if (formId === "adminStatsForm") {
    document.getElementById("statStateInput").value = "played";
    document.getElementById("statGoalsInput").value = "0";
    document.getElementById("statAssistsInput").value = "0";
    document.getElementById("statYellowInput").value = "0";
    document.getElementById("statRedInput").value = "0";
    return;
  }

  if (formId === "adminTeamForm") {
    document.getElementById("adminTeamLookupForm")?.reset();
    setTeamEditorMode();
  }
}

function setTeamEditorMode(team = null) {
  const editorState = document.getElementById("teamEditorState");
  const updateButton = document.getElementById("updateTeamButton");
  const hiddenTarget = document.getElementById("teamUpdateTargetInput");
  const teamNumberInput = document.getElementById("teamNumberInput");
  const lookupInput = document.getElementById("loadTeamNumberInput");
  const loadedTeamNumber = team?.team_number ?? null;

  state.loadedTeamNumber = loadedTeamNumber;

  if (editorState) {
    editorState.textContent = loadedTeamNumber
      ? `Update mode. Team ${loadedTeamNumber} is loaded. Change the details below, then click Update Loaded Team.`
      : "Create mode. Add a new team here.";
  }

  if (updateButton) {
    updateButton.disabled = !loadedTeamNumber;
  }

  if (hiddenTarget) {
    hiddenTarget.value = loadedTeamNumber ? String(loadedTeamNumber) : "";
  }

  if (teamNumberInput) {
    teamNumberInput.readOnly = Boolean(loadedTeamNumber);
  }

  if (lookupInput && loadedTeamNumber) {
    lookupInput.value = String(loadedTeamNumber);
  }
}

function fillTeamForm(team) {
  const teamNumberInput = document.getElementById("teamNumberInput");
  const teamNameInput = document.getElementById("teamNameInput");
  const captainNameInput = document.getElementById("captainNameInput");

  if (teamNumberInput) {
    teamNumberInput.value = team.team_number;
  }

  if (teamNameInput) {
    teamNameInput.value = team.team_name || "";
  }

  if (captainNameInput) {
    captainNameInput.value = team.captain_name || "";
  }

  setTeamEditorMode(team);
}

function formatChatText(value) {
  return escapeHtml(value || "").replace(/\n/g, "<br />");
}

function appendChatMessage(role, text) {
  const messages = document.getElementById("chatMessages");
  if (!messages) {
    return;
  }

  const message = document.createElement("article");
  message.className = `chat-message ${role}`;
  message.innerHTML = `
    <div class="chat-message-role">${role === "assistant" ? "Gemini" : "You"}</div>
    <div class="chat-message-body">${formatChatText(text)}</div>
  `;

  messages.appendChild(message);
  messages.scrollTop = messages.scrollHeight;
}

function setChatLoading(isLoading) {
  const submit = document.getElementById("chatSubmit");
  const input = document.getElementById("chatInput");

  if (submit) {
    submit.disabled = isLoading;
    submit.textContent = isLoading ? "Thinking..." : "Ask";
  }

  if (input) {
    input.disabled = isLoading;
  }
}

function seedChatWelcome() {
  if (state.chatSeeded) {
    return;
  }

  appendChatMessage(
    "assistant",
    [
      "Ask Gemini about the ISU Football Tournament.",
      "It can answer questions about teams, players, captains, standings, fixtures, top scorers, and weekly news."
    ].join("\n")
  );
  state.chatSeeded = true;
}

function setChatOpen(isOpen) {
  const panel = document.getElementById("chatPanel");
  const toggle = document.getElementById("chatToggle");
  const shell = document.getElementById("chatbotShell");

  if (!panel || !toggle || !shell || shell.classList.contains("hidden")) {
    return;
  }

  panel.classList.toggle("hidden", !isOpen);
  toggle.setAttribute("aria-expanded", String(isOpen));

  if (isOpen) {
    seedChatWelcome();
    document.getElementById("chatInput")?.focus();
  }
}

async function askTournamentAssistant(message) {
  const question = String(message || "").trim();
  if (!question) {
    return;
  }

  appendChatMessage("user", question);
  setChatLoading(true);

  try {
    const response = await postJSON("/api/chat/ask", { message: question });
    appendChatMessage("assistant", response.answer || "I could not find an answer yet.");
  } catch (error) {
    appendChatMessage("assistant", `I could not answer that right now: ${error.message}`);
  } finally {
    setChatLoading(false);
    const input = document.getElementById("chatInput");
    if (input) {
      input.value = "";
      input.focus();
    }
  }
}

function renderDatasetButtons() {
  const nav = document.getElementById("datasetNav");

  nav.innerHTML = DATASETS.map((dataset) => {
    const activeClass = dataset.id === state.activeDatasetId ? " active" : "";
    return `<button class="btn dataset-btn${activeClass}" type="button" data-dataset="${dataset.id}">${dataset.label}</button>`;
  }).join("");
}

function renderTable(container, rows, emptyMessage) {
  if (!Array.isArray(rows) || !rows.length) {
    container.innerHTML = `<div class="empty-state">${escapeHtml(emptyMessage)}</div>`;
    return;
  }

  const columns = Object.keys(rows[0]);
  const header = `
    <div class="trow dynamic head" style="--cols:${columns.length}">
      ${columns.map((column) => `<div>${escapeHtml(formatLabel(column))}</div>`).join("")}
    </div>
  `;

  const body = rows
    .map((row) => `
      <div class="trow dynamic" style="--cols:${columns.length}">
        ${columns.map((column) => `<div>${formatCellValue(row[column])}</div>`).join("")}
      </div>
    `)
    .join("");

  container.innerHTML = `<div class="table-scroll"><div class="table">${header}${body}</div></div>`;
}

function renderTeamsDeck(container, rows, emptyMessage) {
  if (!Array.isArray(rows) || !rows.length) {
    container.innerHTML = `<div class="empty-state">${escapeHtml(emptyMessage)}</div>`;
    return;
  }

  container.innerHTML = `
    <div class="team-card-grid">
      ${rows
        .map((team) => `
          <article class="team-card">
            <div class="team-card-head">
              <div>
                <div class="team-card-kicker">Team ${formatCellValue(team.team_number)}</div>
                <h3>${formatCellValue(team.team_name)}</h3>
              </div>
              <span class="team-card-pill">Club</span>
            </div>
            <div class="team-card-meta">
              <span class="team-card-label">Captain</span>
              <strong>${formatCellValue(team.captain_name || "Not set yet")}</strong>
            </div>
          </article>
        `)
        .join("")}
    </div>
  `;
}

function renderTeamMembersDeck(container, rows, emptyMessage) {
  if (!Array.isArray(rows) || !rows.length) {
    container.innerHTML = `<div class="empty-state">${escapeHtml(emptyMessage)}</div>`;
    return;
  }

  const teams = rows.reduce((accumulator, row) => {
    const key = `${row.team_number}::${row.team_name}`;
    if (!accumulator.has(key)) {
      accumulator.set(key, {
        team_number: row.team_number,
        team_name: row.team_name,
        members: []
      });
    }

    accumulator.get(key).members.push(row);
    return accumulator;
  }, new Map());

  container.innerHTML = `
    <div class="team-card-grid">
      ${[...teams.values()]
        .map((team) => `
          <article class="team-card team-members-card">
            <div class="team-card-head">
              <div>
                <div class="team-card-kicker">Team ${formatCellValue(team.team_number)}</div>
                <h3>${formatCellValue(team.team_name)}</h3>
              </div>
              <span class="team-card-pill">${escapeHtml(team.members.length)} players</span>
            </div>
            <div class="team-player-grid">
              ${team.members
                .map((member) => `
                  <article class="team-player-chip">
                    <div class="team-player-number">#${formatCellValue(member.player_number)}</div>
                    <div class="team-player-name">${formatCellValue(member.player_name)}</div>
                    <div class="team-player-position">${formatCellValue(member.position)}</div>
                  </article>
                `)
                .join("")}
            </div>
          </article>
        `)
        .join("")}
    </div>
  `;
}

function renderHighlightCards(results) {
  const container = document.getElementById("highlightGrid");
  if (!container) {
    return;
  }

  container.innerHTML = HIGHLIGHT_CARDS.map((card) => {
    const payload = results[card.id];
    const topRow = payload?.rows?.[0];
    const value = topRow ? Number(topRow[card.valueKey] ?? 0) : 0;
    const hasRealStats = Boolean(topRow) && value > 0;
    const primary = hasRealStats ? topRow.player_name : "No data yet";
    const secondary = hasRealStats
      ? `${topRow.team_name} • ${card.metric}: ${value}`
      : `No ${card.title.toLowerCase()} data yet.`;
    const badge = payload?.error ? "Unavailable" : hasRealStats ? `${payload?.rows?.length || 0} rows` : "Waiting for stats";

    return `
      <button class="highlight-card ${card.iconClass}" type="button" data-highlight="${card.id}">
        <div class="highlight-icon">${card.icon}</div>
        <div class="highlight-copy">
          <div class="highlight-topline">${escapeHtml(card.title)}</div>
          <div class="highlight-name">${escapeHtml(primary)}</div>
          <div class="highlight-meta">${escapeHtml(secondary)}</div>
        </div>
        <div class="highlight-badge">${escapeHtml(badge)}</div>
      </button>
    `;
  }).join("");
}

function renderLeagueTableCards(container, rows, emptyMessage) {
  if (!Array.isArray(rows) || !rows.length) {
    container.innerHTML = `<div class="empty-state">${escapeHtml(emptyMessage)}</div>`;
    return;
  }

  const columns = [
    { key: "rank", label: "Rank" },
    { key: "team", label: "Team" },
    { key: "P", label: "P" },
    { key: "W", label: "W" },
    { key: "D", label: "D" },
    { key: "L", label: "L" },
    { key: "GF", label: "GF" },
    { key: "GA", label: "GA" },
    { key: "GD", label: "GD" },
    { key: "Pts", label: "Pts" }
  ];

  container.innerHTML = `
    <div class="league-table-shell">
      <div class="league-table-head">
        ${columns.map((column) => `<div>${escapeHtml(column.label)}</div>`).join("")}
      </div>
      ${rows
        .map((row, index) => {
          const rank = index + 1;
          const accentClass = rank === 1 ? " top-one" : rank === 2 ? " top-two" : rank === 3 ? " top-three" : "";
          const gd = Number(row.GD ?? 0);
          const gdClass = gd > 0 ? " positive" : gd < 0 ? " negative" : "";

          return `
            <article class="league-row${accentClass}">
              <div class="league-row-grid">
                <div class="league-rank-cell">
                  <div class="league-rank-pill">#${escapeHtml(rank)}</div>
                </div>
                <div class="league-team-cell">
                  <div class="league-team-line">
                    <strong>${formatCellValue(row.team_name)}</strong>
                    <span class="league-team-number">Team ${formatCellValue(row.team_number)}</span>
                  </div>
                  <div class="league-team-record">${formatCellValue(row.W)}W - ${formatCellValue(row.D)}D - ${formatCellValue(row.L)}L record</div>
                </div>
                <div class="league-stat-cell">
                  <span class="league-mobile-label">P</span>
                  <strong>${formatCellValue(row.P)}</strong>
                </div>
                <div class="league-stat-cell">
                  <span class="league-mobile-label">W</span>
                  <strong>${formatCellValue(row.W)}</strong>
                </div>
                <div class="league-stat-cell">
                  <span class="league-mobile-label">D</span>
                  <strong>${formatCellValue(row.D)}</strong>
                </div>
                <div class="league-stat-cell">
                  <span class="league-mobile-label">L</span>
                  <strong>${formatCellValue(row.L)}</strong>
                </div>
                <div class="league-stat-cell">
                  <span class="league-mobile-label">GF</span>
                  <strong>${formatCellValue(row.GF)}</strong>
                </div>
                <div class="league-stat-cell">
                  <span class="league-mobile-label">GA</span>
                  <strong>${formatCellValue(row.GA)}</strong>
                </div>
                <div class="league-stat-cell${gdClass}">
                  <span class="league-mobile-label">GD</span>
                  <strong>${formatCellValue(row.GD)}</strong>
                </div>
                <div class="league-points-cell">
                  <span class="league-mobile-label">Pts</span>
                  <strong>${formatCellValue(row.Pts)}</strong>
                </div>
              </div>
            </article>
          `;
        })
        .join("")}
    </div>
  `;
}

async function loadLeagueSection() {
  const section = document.getElementById("leagueSection");
  const metaEl = document.getElementById("leagueMeta");
  const tableEl = document.getElementById("leaguePreview");

  if (!section || !metaEl || !tableEl) {
    return;
  }

  metaEl.innerHTML = `<span class="muted">Loading league table...</span>`;
  tableEl.innerHTML = `<div class="empty-state">Loading league table...</div>`;

  try {
    const rows = await getJSON("/api/datasets/league_table");
    metaEl.innerHTML = `<span class="pill neutral">${rows.length} team${rows.length === 1 ? "" : "s"}</span>`;
    renderLeagueTableCards(tableEl, rows, "No league table data available yet.");
  } catch (error) {
    metaEl.innerHTML = `<span class="muted">Could not load league table.</span>`;
    tableEl.innerHTML = `<div class="empty-state">Failed to load league table: ${escapeHtml(error.message)}</div>`;
  }
}

function setAppVisibility(signedIn) {
  document.getElementById("authScreen").classList.toggle("hidden", signedIn);
  document.getElementById("appShell").classList.toggle("hidden", !signedIn);
  document.getElementById("chatbotShell")?.classList.toggle("hidden", !signedIn);

  if (!signedIn) {
    document.getElementById("chatPanel")?.classList.add("hidden");
    document.getElementById("chatToggle")?.setAttribute("aria-expanded", "false");
  }
}

function updateTopbarSession() {
  const badge = document.getElementById("sessionBadge");
  const subtitle = document.getElementById("dashboardSubtitle");

  if (state.role === "player" && state.player) {
    badge.textContent = `Player | ${state.player.player_name}`;
    badge.classList.remove("hidden");
    subtitle.textContent = "Player tournament dashboard";
    return;
  }

  if (state.role === "organizer" && state.organizer) {
    badge.textContent = `Organizer | ${state.organizer.username}`;
    badge.classList.remove("hidden");
    subtitle.textContent = "Organizer tournament dashboard";
    return;
  }

  badge.textContent = "";
  badge.classList.add("hidden");
  subtitle.textContent = "Tournament dashboard";
}

function applyRoleVisibility() {
  const playerSection = document.getElementById("playerSection");
  const organizerSection = document.getElementById("organizerSection");
  const datasetSection = document.getElementById("datasetSection");
  const highlightsSection = document.getElementById("highlightsSection");
  const leagueSection = document.getElementById("leagueSection");

  playerSection.classList.toggle("hidden", state.role !== "player");
  organizerSection.classList.toggle("hidden", state.role !== "organizer");
  datasetSection.classList.toggle("hidden", !state.role);
  highlightsSection.classList.toggle("hidden", !state.role);
  leagueSection.classList.toggle("hidden", !state.role);
}

function setEntryRole(role, options = {}) {
  const config = ROLE_CONFIG[role] || ROLE_CONFIG.player;
  const message = options.message || "";
  const entryMessage = document.getElementById("entryMessage");

  state.entryRole = role;
  document.querySelectorAll("[data-role]").forEach((button) => {
    button.classList.toggle("active", button.dataset.role === role);
  });

  document.getElementById("loginUserLabel").textContent = config.userLabel;
  document.getElementById("loginSecretLabel").textContent = config.secretLabel;
  document.getElementById("entryUsername").placeholder = config.userPlaceholder;
  document.getElementById("entrySecret").placeholder = config.secretPlaceholder;
  document.getElementById("entrySecret").type = config.secretType;
  document.getElementById("entrySubmit").textContent = `Enter As ${config.label}`;

  if (message) {
    entryMessage.textContent = message;
    entryMessage.classList.remove("hidden");
  } else {
    entryMessage.textContent = "";
    entryMessage.classList.add("hidden");
  }

  if (options.resetForm !== false) {
    document.getElementById("entryLoginForm").reset();
  }
}

function renderPlayerDashboard(updates) {
  const dashboard = document.getElementById("playerDashboard");
  const authMessage = document.getElementById("playerAuthMessage");
  const standing = updates.leagueRow;
  const seasonBadge = updates.teamOfSeason
    ? `<span class="pill neutral">Team of the season</span>`
    : `<span class="pill neutral">Tracking live tournament status</span>`;

  state.player = updates.player;
  authMessage.innerHTML = `${seasonBadge}<span class="status-text">${escapeHtml(updates.player.team_name)}</span>`;

  dashboard.innerHTML = `
    <div class="portal-grid">
      <section class="portal-panel">
        <h3>${escapeHtml(updates.player.player_name)}</h3>
        <div class="muted">Player #${escapeHtml(updates.player.player_number)} - ${escapeHtml(updates.player.position)}</div>
        <div class="stat-strip">
          <div class="stat-chip">
            <span class="stat-label">Team</span>
            <strong>${escapeHtml(updates.player.team_name)}</strong>
          </div>
          <div class="stat-chip">
            <span class="stat-label">Played</span>
            <strong>${standing ? escapeHtml(standing.P) : "-"}</strong>
          </div>
          <div class="stat-chip">
            <span class="stat-label">Points</span>
            <strong>${standing ? escapeHtml(standing.Pts) : "-"}</strong>
          </div>
          <div class="stat-chip">
            <span class="stat-label">Goal Diff</span>
            <strong>${standing ? escapeHtml(standing.GD) : "-"}</strong>
          </div>
        </div>
      </section>

      <section class="portal-panel">
        <h3>Upcoming Fixtures</h3>
        ${renderListItems(
          updates.upcomingFixtures,
          (fixture) => `
            <article class="list-item">
              <div class="item-title">${escapeHtml(formatMatchLine(fixture))}</div>
              <div class="item-subtitle">${escapeHtml(fixture.match_date)} at ${escapeHtml(fixture.match_time)}</div>
            </article>
          `,
          "No scheduled fixtures for your team yet."
        )}
      </section>

      <section class="portal-panel">
        <h3>Recent Results</h3>
        ${renderListItems(
          updates.recentResults,
          (fixture) => `
            <article class="list-item">
              <div class="item-title">${escapeHtml(formatMatchLine(fixture))}</div>
              <div class="item-subtitle">${escapeHtml(fixture.home_goals)} - ${escapeHtml(fixture.away_goals)} on ${escapeHtml(fixture.match_date)}</div>
            </article>
          `,
          "No completed matches for your team yet."
        )}
      </section>

      <section class="portal-panel">
        <h3>Your Team Members</h3>
        ${renderListItems(
          updates.teamMembers,
          (member) => `
            <article class="list-item">
              <div class="item-title">#${escapeHtml(member.player_number)} ${escapeHtml(member.player_name)}</div>
              <div class="item-subtitle">${escapeHtml(member.position)}</div>
            </article>
          `,
          "No team members found."
        )}
      </section>

      <section class="portal-panel">
        <h3>Top Goal Scorers</h3>
        ${renderListItems(
          updates.topScorers,
          (entry) => `
            <article class="list-item">
              <div class="item-title">${escapeHtml(entry.player_name)}</div>
              <div class="item-subtitle">${escapeHtml(entry.team_name)} - Goals: ${escapeHtml(entry.total_goals)}</div>
            </article>
          `,
          "No scorer data available."
        )}
      </section>

      <section class="portal-panel">
        <h3>Top Assists</h3>
        ${renderListItems(
          updates.topAssists,
          (entry) => `
            <article class="list-item">
              <div class="item-title">${escapeHtml(entry.player_name)}</div>
              <div class="item-subtitle">${escapeHtml(entry.team_name)} - Assists: ${escapeHtml(entry.total_assists)}</div>
            </article>
          `,
          "No assist data available."
        )}
      </section>
    </div>
  `;

  updateTopbarSession();
}

function renderOrganizerMessage(message) {
  const el = document.getElementById("organizerMessage");

  if (state.organizer) {
    el.innerHTML = `<span class="pill neutral">Organizer access</span><span class="status-text">${escapeHtml(state.organizer.username)}</span><span class="admin-note">${escapeHtml(message)}</span>`;
    return;
  }

  el.textContent = message;
}

async function loadHealth() {
  const healthEl = document.getElementById("health");
  if (!healthEl) {
    return;
  }

  try {
    const health = await getJSON("/api/health");
    const mode = health.mode ? `<span class="status-text">${escapeHtml(health.mode)}</span>` : "";
    healthEl.innerHTML = `<span class="pill">${escapeHtml(health.db)}</span>${mode}`;
  } catch (error) {
    healthEl.textContent = `DB not connected: ${error.message}`;
  }
}

async function loadDataset(datasetId = state.activeDatasetId) {
  const dataset = datasetMap[datasetId] || datasetMap.teams;
  const tableEl = document.getElementById("datasetTable");
  const metaEl = document.getElementById("datasetMeta");

  state.activeDatasetId = dataset.id;
  document.getElementById("datasetTitle").textContent = dataset.label;
  document.getElementById("datasetDescription").textContent = dataset.description;
  renderDatasetButtons();

  metaEl.innerHTML = `<span class="muted">Loading ${escapeHtml(dataset.label.toLowerCase())}...</span>`;
  tableEl.innerHTML = `<div class="empty-state">Loading ${escapeHtml(dataset.label.toLowerCase())}...</div>`;

  try {
    const rows = await getJSON(`/api/datasets/${dataset.id}`);
    metaEl.innerHTML = `<span class="pill neutral">${rows.length} row${rows.length === 1 ? "" : "s"}</span>`;
    if (dataset.id === "teams") {
      renderTeamsDeck(tableEl, rows, `No ${dataset.label.toLowerCase()} available.`);
      return;
    }

    if (dataset.id === "team_members") {
      renderTeamMembersDeck(tableEl, rows, `No ${dataset.label.toLowerCase()} available.`);
      return;
    }

    if (dataset.id === "league_table") {
      renderLeagueTableCards(tableEl, rows, `No ${dataset.label.toLowerCase()} available.`);
      return;
    }

    renderTable(tableEl, rows, `No ${dataset.label.toLowerCase()} available.`);
  } catch (error) {
    metaEl.innerHTML = `<span class="muted">Could not load ${escapeHtml(dataset.label.toLowerCase())}.</span>`;
    tableEl.innerHTML = `<div class="empty-state">Failed to load ${escapeHtml(dataset.label.toLowerCase())}: ${escapeHtml(error.message)}</div>`;
  }
}

async function loadHighlights() {
  const requests = await Promise.all(
    HIGHLIGHT_CARDS.map(async (card) => {
      try {
        const rows = await getJSON(`/api/datasets/${card.id}`);
        return [card.id, { rows }];
      } catch (error) {
        return [card.id, { rows: [], error: error.message }];
      }
    })
  );

  renderHighlightCards(Object.fromEntries(requests));
}

async function loadPlayerPortal() {
  if (state.role !== "player") {
    return;
  }

  try {
    const updates = await getJSON("/api/player/updates");
    renderPlayerDashboard(updates);
  } catch (error) {
    if (error.status === 401) {
      await logoutCurrentUser("Your player session expired. Please log in again.");
      return;
    }

    document.getElementById("playerAuthMessage").textContent = `Player updates unavailable: ${error.message}`;
    document.getElementById("playerDashboard").innerHTML = `<div class="empty-state">Could not load player updates.</div>`;
  }
}

async function loadSignedInViews() {
  const tasks = [loadHealth(), loadDataset(state.activeDatasetId), loadHighlights(), loadLeagueSection()];

  if (state.role === "player") {
    tasks.push(loadPlayerPortal());
  } else if (state.role === "organizer") {
    renderOrganizerMessage("You can update tournament data from this panel.");
  }

  await Promise.all(tasks);
}

function enterPlayer(player) {
  state.role = "player";
  state.player = player;
  state.organizer = null;
  setAppVisibility(true);
  applyRoleVisibility();
  updateTopbarSession();
}

function enterOrganizer(organizer) {
  state.role = "organizer";
  state.organizer = organizer;
  state.player = null;
  setAppVisibility(true);
  applyRoleVisibility();
  updateTopbarSession();
  renderOrganizerMessage("You can update tournament data from this panel.");
}

function showLoginScreen(message) {
  state.role = null;
  state.player = null;
  state.organizer = null;
  setAppVisibility(false);
  applyRoleVisibility();
  updateTopbarSession();
  document.getElementById("playerDashboard").innerHTML = "";
  document.getElementById("playerAuthMessage").textContent = "";
  document.getElementById("adminTeamForm")?.reset();
  document.getElementById("adminTeamLookupForm")?.reset();
  setTeamEditorMode();
  renderOrganizerMessage("");
  setEntryRole(state.entryRole, { message, resetForm: true });
}

async function logoutCurrentUser(message = "You have been logged out.") {
  try {
    if (state.role === "player") {
      await postJSON("/api/player/logout", {});
    } else if (state.role === "organizer") {
      await postJSON("/api/organizer/logout", {});
    }
  } catch (error) {
    // Ignore logout failures and still return to the login screen.
  }

  showLoginScreen(message);
}

async function detectExistingSession() {
  try {
    const organizerRes = await getJSON("/api/organizer/me");
    enterOrganizer(organizerRes.organizer || organizerRes.admin);
    await loadSignedInViews();
    return;
  } catch (error) {
    if (error.status !== 401) {
      console.error(error);
    }
  }

  try {
    const playerRes = await getJSON("/api/player/me");
    enterPlayer(playerRes.player);
    await loadSignedInViews();
    return;
  } catch (error) {
    if (error.status !== 401) {
      console.error(error);
    }
  }

  showLoginScreen("");
}

async function handleOrganizerMutation(config) {
  renderOrganizerMessage(config.pendingMessage || "Saving changes...");

  try {
    const response = await config.run();
    if (config.clearFormId) {
      clearForm(config.clearFormId);
    }
    await Promise.all([loadDataset(config.datasetId || state.activeDatasetId), loadHighlights(), loadLeagueSection()]);
    renderOrganizerMessage(response.message || config.successMessage);
  } catch (error) {
    if (error.status === 401) {
      await logoutCurrentUser("Your organizer session expired. Please log in again.");
      return;
    }

    renderOrganizerMessage(error.message);
  }
}

async function loadTeamForEdit(teamNumber) {
  renderOrganizerMessage(`Loading team ${teamNumber}...`);

  try {
    const response = await getJSON(`/api/organizer/teams/${encodeURIComponent(teamNumber)}`);
    fillTeamForm(response.team);
    renderOrganizerMessage(`Team ${response.team.team_number} loaded for update.`);
  } catch (error) {
    if (error.status === 401) {
      await logoutCurrentUser("Your organizer session expired. Please log in again.");
      return;
    }

    document.getElementById("adminTeamForm")?.reset();
    setTeamEditorMode();
    renderOrganizerMessage(error.message);
  }
}

document.getElementById("roleToggle")?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-role]");
  if (!button) {
    return;
  }

  setEntryRole(button.dataset.role);
});

document.getElementById("entryLoginForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();

  const username = readInputValue("entryUsername");
  const secret = readInputValue("entrySecret");
  const entryMessage = document.getElementById("entryMessage");

  entryMessage.textContent = "Signing in...";

  try {
    if (state.entryRole === "player") {
      const response = await postJSON("/api/player/login", {
        username,
        code: secret
      });
      enterPlayer(response.player);
    } else {
      const response = await postJSON("/api/organizer/login", {
        username,
        password: secret
      });
      enterOrganizer(response.organizer || response.admin);
    }

    await loadSignedInViews();
  } catch (error) {
    setEntryRole(state.entryRole, {
      resetForm: false,
      message: error.message
    });
  }
});

document.getElementById("switchUser")?.addEventListener("click", () => {
  logoutCurrentUser("Choose a role and log in again.");
});

document.getElementById("refreshPortal")?.addEventListener("click", () => loadPlayerPortal());

document.getElementById("refreshOrganizer")?.addEventListener("click", async () => {
  await Promise.all([loadHealth(), loadDataset(state.activeDatasetId), loadHighlights(), loadLeagueSection()]);
  renderOrganizerMessage("Organizer panel refreshed.");
});

document.getElementById("reloadDataset")?.addEventListener("click", () => loadDataset());

document.getElementById("openLeagueDataset")?.addEventListener("click", () => {
  loadDataset("league_table");
  document.getElementById("datasetSection")?.scrollIntoView({ behavior: "smooth", block: "start" });
});

document.getElementById("datasetNav")?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-dataset]");
  if (!button) {
    return;
  }

  loadDataset(button.dataset.dataset);
});

document.getElementById("highlightGrid")?.addEventListener("click", (event) => {
  const card = event.target.closest("[data-highlight]");
  if (!card) {
    return;
  }

  loadDataset(card.dataset.highlight);
  document.getElementById("datasetSection")?.scrollIntoView({ behavior: "smooth", block: "start" });
});

document.getElementById("organizerPanel")?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-clear-form]");
  if (!button) {
    return;
  }

  clearForm(button.dataset.clearForm);
});

document.getElementById("adminTeamLookupForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  await loadTeamForEdit(readInputValue("loadTeamNumberInput"));
});

document.getElementById("adminTeamForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();

  await handleOrganizerMutation({
    pendingMessage: "Adding team...",
    successMessage: "Team added successfully.",
    clearFormId: "adminTeamForm",
    datasetId: "teams",
    run: () =>
      postJSON("/api/organizer/teams", {
        team_number: readInputValue("teamNumberInput"),
        team_name: readInputValue("teamNameInput"),
        captain_name: readInputValue("captainNameInput")
      })
  });
});

document.getElementById("updateTeamButton")?.addEventListener("click", async () => {
  const teamNumber = state.loadedTeamNumber || readInputValue("teamUpdateTargetInput");
  if (!teamNumber) {
    renderOrganizerMessage("Load an existing team first before updating it.");
    return;
  }

  await handleOrganizerMutation({
    pendingMessage: `Updating team ${teamNumber}...`,
    successMessage: "Team updated successfully.",
    clearFormId: "adminTeamForm",
    datasetId: "teams",
    run: () =>
      putJSON(`/api/organizer/teams/${encodeURIComponent(teamNumber)}`, {
        team_name: readInputValue("teamNameInput"),
        captain_name: readInputValue("captainNameInput")
      })
  });
});

document.getElementById("adminTeamDeleteForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();

  await handleOrganizerMutation({
    pendingMessage: "Deleting team...",
    successMessage: "Team deleted successfully.",
    datasetId: "teams",
    run: () => deleteJSON(`/api/organizer/teams/${encodeURIComponent(readInputValue("deleteTeamNumberInput"))}`)
  });
});

document.getElementById("adminPlayerForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();

  await handleOrganizerMutation({
    pendingMessage: "Saving player...",
    successMessage: "Player saved successfully.",
    clearFormId: "adminPlayerForm",
    datasetId: "players",
    run: () =>
      postJSON("/api/organizer/players", {
        player_number: readInputValue("playerNumberAdminInput"),
        player_name: readInputValue("playerNameAdminInput"),
        position: readInputValue("playerPositionInput"),
        player_team: readInputValue("playerTeamInput")
      })
  });
});

document.getElementById("adminPlayerDeleteForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();

  await handleOrganizerMutation({
    pendingMessage: "Deleting player...",
    successMessage: "Player deleted successfully.",
    datasetId: "players",
    run: () =>
      deleteJSON(
        `/api/organizer/players/${encodeURIComponent(readInputValue("deletePlayerTeamInput"))}/${encodeURIComponent(
          readInputValue("deletePlayerNumberInput")
        )}`
      )
  });
});

document.getElementById("adminMatchForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();

  await handleOrganizerMutation({
    pendingMessage: "Saving match...",
    successMessage: "Match saved successfully.",
    clearFormId: "adminMatchForm",
    datasetId: "fixtures",
    run: () =>
      postJSON("/api/organizer/matches", {
        match_id: readInputValue("matchIdInput"),
        match_date: readInputValue("matchDateInput"),
        match_time: readInputValue("matchTimeInput"),
        home_team: readInputValue("homeTeamInput"),
        away_team: readInputValue("awayTeamInput"),
        referee_id: readInputValue("refereeIdInput"),
        home_goals: readInputValue("homeGoalsInput"),
        away_goals: readInputValue("awayGoalsInput"),
        status: readInputValue("matchStatusInput")
      })
  });
});

document.getElementById("adminMatchDeleteForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();

  await handleOrganizerMutation({
    pendingMessage: "Deleting match...",
    successMessage: "Match deleted successfully.",
    datasetId: "fixtures",
    run: () => deleteJSON(`/api/organizer/matches/${encodeURIComponent(readInputValue("deleteMatchIdInput"))}`)
  });
});

document.getElementById("adminTosForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();

  await handleOrganizerMutation({
    pendingMessage: "Saving team-of-season entry...",
    successMessage: "Team-of-season entry saved successfully.",
    clearFormId: "adminTosForm",
    datasetId: "team_of_season",
    run: () =>
      postJSON("/api/organizer/team-of-season", {
        tos_id: readInputValue("tosIdInput"),
        team_number: readInputValue("tosTeamNumberInput"),
        team_name: readInputValue("tosTeamNameInput")
      })
  });
});

document.getElementById("adminTosDeleteForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();

  await handleOrganizerMutation({
    pendingMessage: "Deleting team-of-season entry...",
    successMessage: "Team-of-season entry deleted successfully.",
    datasetId: "team_of_season",
    run: () => deleteJSON(`/api/organizer/team-of-season/${encodeURIComponent(readInputValue("deleteTosIdInput"))}`)
  });
});

document.getElementById("adminStatsForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();

  await handleOrganizerMutation({
    pendingMessage: "Saving stat line...",
    successMessage: "Stat line saved successfully.",
    clearFormId: "adminStatsForm",
    datasetId: "stats",
    run: () =>
      postJSON("/api/organizer/stats", {
        match_id: readInputValue("statMatchIdInput"),
        player_team: readInputValue("statPlayerTeamInput"),
        player_number: readInputValue("statPlayerNumberInput"),
        state: readInputValue("statStateInput") || "played",
        goals: readInputValue("statGoalsInput"),
        assists: readInputValue("statAssistsInput"),
        yellow_cards: readInputValue("statYellowInput"),
        red_cards: readInputValue("statRedInput")
      })
  });
});

document.getElementById("adminStatsDeleteForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();

  await handleOrganizerMutation({
    pendingMessage: "Deleting stat line...",
    successMessage: "Stat line deleted successfully.",
    datasetId: "stats",
    run: () =>
      deleteJSON(
        `/api/organizer/stats/${encodeURIComponent(readInputValue("deleteStatMatchIdInput"))}/${encodeURIComponent(
          readInputValue("deleteStatPlayerTeamInput")
        )}/${encodeURIComponent(readInputValue("deleteStatPlayerNumberInput"))}`
      )
  });
});

document.getElementById("chatToggle")?.addEventListener("click", () => {
  const panel = document.getElementById("chatPanel");
  setChatOpen(panel?.classList.contains("hidden"));
});

document.getElementById("chatClose")?.addEventListener("click", () => {
  setChatOpen(false);
});

document.getElementById("chatSuggestions")?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-question]");
  if (!button) {
    return;
  }

  setChatOpen(true);
  askTournamentAssistant(button.dataset.question);
});

document.getElementById("chatForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const input = document.getElementById("chatInput");
  await askTournamentAssistant(input?.value || "");
});

const authScreen = document.getElementById("authScreen");
if (authScreen) {
  const resetAuthMotion = () => {
    authScreen.style.setProperty("--auth-mouse-x", "50%");
    authScreen.style.setProperty("--auth-mouse-y", "50%");
    authScreen.style.setProperty("--auth-shift-x", "0");
    authScreen.style.setProperty("--auth-shift-y", "0");
  };

  authScreen.addEventListener("pointermove", (event) => {
    const bounds = authScreen.getBoundingClientRect();
    const x = (event.clientX - bounds.left) / bounds.width;
    const y = (event.clientY - bounds.top) / bounds.height;
    const shiftX = (x - 0.5) * 2;
    const shiftY = (y - 0.5) * 2;

    authScreen.style.setProperty("--auth-mouse-x", `${(x * 100).toFixed(2)}%`);
    authScreen.style.setProperty("--auth-mouse-y", `${(y * 100).toFixed(2)}%`);
    authScreen.style.setProperty("--auth-shift-x", shiftX.toFixed(3));
    authScreen.style.setProperty("--auth-shift-y", shiftY.toFixed(3));
  });

  authScreen.addEventListener("pointerleave", resetAuthMotion);
  resetAuthMotion();
}

renderDatasetButtons();
setEntryRole("player");
setTeamEditorMode();
detectExistingSession();
