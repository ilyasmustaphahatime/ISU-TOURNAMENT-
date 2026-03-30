const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const dotenv = require("dotenv");
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const mysql = require("mysql2/promise");
const { z } = require("zod");

const candidateEnvPaths = [
  path.resolve(process.cwd(), ".env"),
  path.resolve(__dirname, ".env")
];
const PUBLIC_DIR = path.resolve(__dirname, "..", "public");

for (const envPath of candidateEnvPaths) {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
    break;
  }
}

const TeamSchema = z.object({
  team_number: z.coerce.number().int().nonnegative(),
  team_name: z.string().trim().min(1).max(100),
  captain_name: z.string().trim().max(100).optional().nullable().transform((value) => value || null)
});

const TeamUpdateSchema = z.object({
  team_name: z.string().trim().min(1).max(100),
  captain_name: z.string().trim().max(100).optional().nullable().transform((value) => value || null)
});

const PlayerSchema = z.object({
  player_number: z.coerce.number().int().positive(),
  player_name: z.string().trim().min(1).max(100),
  position: z.string().trim().min(1).max(50),
  player_team: z.coerce.number().int().positive()
});

const PlayerKeySchema = z.object({
  player_number: z.coerce.number().int().positive(),
  player_team: z.coerce.number().int().positive()
});

const MatchSchema = z.object({
  match_id: z.coerce.number().int().positive(),
  match_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  match_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
  home_team: z.coerce.number().int().positive(),
  away_team: z.coerce.number().int().positive(),
  referee_id: z.preprocess(
    (value) => (value === "" || value === null || value === undefined ? null : Number(value)),
    z.number().int().positive().nullable()
  ),
  home_goals: z.coerce.number().int().nonnegative(),
  away_goals: z.coerce.number().int().nonnegative(),
  status: z.enum(["scheduled", "played", "postponed", "cancelled"])
});

const TeamOfSeasonSchema = z.object({
  tos_id: z.coerce.number().int().positive(),
  team_number: z.coerce.number().int().positive(),
  team_name: z.string().trim().min(1).max(100)
});

const StatSchema = z.object({
  match_id: z.coerce.number().int().positive(),
  player_number: z.coerce.number().int().positive(),
  player_team: z.coerce.number().int().positive(),
  state: z.string().trim().min(1).max(50).optional().default("played"),
  goals: z.coerce.number().int().nonnegative(),
  assists: z.coerce.number().int().nonnegative(),
  yellow_cards: z.coerce.number().int().nonnegative(),
  red_cards: z.coerce.number().int().nonnegative(),
  clean_sheets: z.coerce.number().int().nonnegative()
});

const WeeklyNewsSchema = z.object({
  news_id: z.preprocess(
    (value) => (value === "" || value === null || value === undefined ? null : Number(value)),
    z.number().int().positive().nullable()
  ).optional(),
  week_label: z.string().trim().min(1).max(100),
  headline: z.string().trim().min(1).max(180),
  summary: z.string().trim().min(1).max(320),
  body: z.string().trim().min(1).max(8000),
  published_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  featured_team_number: z.preprocess(
    (value) => (value === "" || value === null || value === undefined ? null : Number(value)),
    z.number().int().positive().nullable()
  )
});

const SpotlightAwardTypeSchema = z.enum([
  "best_player_of_week",
  "best_goalkeeper",
  "best_team_of_week",
  "best_team_of_month"
]);

const SpotlightAwardSchema = z.object({
  honor_type: SpotlightAwardTypeSchema,
  player_number: z.preprocess(
    (value) => (value === "" || value === null || value === undefined ? null : Number(value)),
    z.number().int().positive().nullable()
  ),
  player_team: z.preprocess(
    (value) => (value === "" || value === null || value === undefined ? null : Number(value)),
    z.number().int().positive().nullable()
  ),
  team_number: z.preprocess(
    (value) => (value === "" || value === null || value === undefined ? null : Number(value)),
    z.number().int().positive().nullable()
  ),
  title: z.string().trim().max(120).optional().nullable().transform((value) => value || null),
  description: z.string().trim().max(500).optional().nullable().transform((value) => value || null)
}).superRefine((entry, ctx) => {
  if (isPlayerSpotlightAwardType(entry.honor_type) && !entry.player_number) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "This player award needs a player number.",
      path: ["player_number"]
    });
  }

  if (isPlayerSpotlightAwardType(entry.honor_type) && !entry.player_team) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "This player award also needs the team number.",
      path: ["player_team"]
    });
  }

  if (!isPlayerSpotlightAwardType(entry.honor_type) && !entry.team_number) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "This award needs a team number.",
      path: ["team_number"]
    });
  }
});

const PlayerLoginSchema = z.object({
  username: z.string().trim().min(1).max(140),
  code: z.string().trim().regex(/^\d+$/)
});

const AdminLoginSchema = z.object({
  username: z.string().trim().min(1).max(100),
  password: z.string().min(1).max(200)
});

const ChatQuestionSchema = z.object({
  message: z.string().trim().min(1).max(500)
});

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);
const port = Number(process.env.PORT) || 3000;
const PLAYER_SESSION_COOKIE = "player_session";
const ADMIN_SESSION_COOKIE = "admin_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 12;
const ORGANIZER_NAMES = ["abraham", "abubakar", "nanaknawme", "muzakir", "joy", "bas"];
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_API_BASE = process.env.GEMINI_API_BASE || "https://generativelanguage.googleapis.com/v1beta";
const unavailableDbCodes = new Set([
  "ECONNREFUSED",
  "ENOTFOUND",
  "ETIMEDOUT",
  "PROTOCOL_CONNECTION_LOST",
  "ER_ACCESS_DENIED_ERROR",
  "ER_BAD_DB_ERROR",
  "ER_NO_SUCH_TABLE"
]);

const fallbackTeams = [];

const datasetQueries = {
  teams: "SELECT team_number, team_name, captain_name FROM teams ORDER BY team_number ASC",
  players: "SELECT player_number, player_name, position, player_team FROM players ORDER BY player_team ASC, player_number ASC, player_name ASC",
  team_members: "SELECT team_number, team_name, player_number, player_name, position FROM team_members_view ORDER BY team_number ASC, player_number ASC",
  team_of_season: "SELECT tos_id, team_number, team_name FROM team_of_the_season ORDER BY tos_id ASC",
  fixtures: "SELECT match_id, match_date, match_time, home_team, away_team, referee_name, home_goals, away_goals, status FROM fixtures_view ORDER BY match_date ASC, match_time ASC",
  stats: `
    SELECT
      s.stat_id,
      s.match_id,
      p.player_team,
      t.team_name,
      p.player_number,
      p.player_name,
      s.state,
      s.goals,
      s.assists,
      s.yellow_cards,
      s.red_cards,
      s.clean_sheets
    FROM stats s
    JOIN players p ON s.player_id = p.player_id
    JOIN teams t ON p.player_team = t.team_number
    ORDER BY s.match_id ASC, p.player_team ASC, p.player_number ASC
  `,
  league_table: "SELECT team_number, team_name, P, W, D, L, GF, GA, GD, Pts FROM league_table",
  top_goals: "SELECT player_number, player_name, position, team_name, total_goals FROM top_goals WHERE total_goals > 0",
  top_assists: "SELECT player_number, player_name, position, team_name, total_assists FROM top_assists WHERE total_assists > 0",
  yellow_cards: "SELECT player_number, player_name, position, team_name, total_yellow_cards FROM yellow_cards WHERE total_yellow_cards > 0",
  red_cards: "SELECT player_number, player_name, position, team_name, total_red_cards FROM red_cards WHERE total_red_cards > 0",
  top_clean_sheets: `
    SELECT player_number, player_name, position, team_name, total_clean_sheets
    FROM top_clean_sheets
    WHERE total_clean_sheets > 0
  `,
  weekly_news: `
    SELECT
      n.news_id,
      n.week_label,
      n.headline,
      n.summary,
      n.body,
      n.published_on,
      n.featured_team_number,
      t.team_name AS featured_team_name,
      n.created_at,
      n.updated_at
    FROM weekly_news n
    LEFT JOIN teams t ON n.featured_team_number = t.team_number
    ORDER BY n.published_on DESC, n.news_id DESC
  `,
  spotlight_awards: `
    SELECT
      a.honor_type,
      a.player_id,
      p.player_name,
      p.player_number,
      p.position,
      p.player_team AS player_team_number,
      pt.team_name AS player_team_name,
      a.team_number,
      tt.team_name,
      a.title,
      a.description,
      a.updated_at
    FROM spotlight_awards a
    LEFT JOIN players p ON a.player_id = p.player_id
    LEFT JOIN teams pt ON p.player_team = pt.team_number
    LEFT JOIN teams tt ON a.team_number = tt.team_number
    ORDER BY FIELD(a.honor_type, 'best_player_of_week', 'best_goalkeeper', 'best_team_of_week', 'best_team_of_month')
  `
};

let pool;
let demoModeReason = null;
const playerSessions = new Map();
const adminSessions = new Map();
const rateLimitStores = new Map();
const organizerAccountConfig = loadOrganizerAccounts();
const organizerAccounts = organizerAccountConfig.accounts;
const organizerAccountsUsingDefaults = organizerAccountConfig.usingDefault;

function asyncHandler(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

function rememberDemoMode(error) {
  demoModeReason = String(error?.message || error || "Database unavailable");
}

function buildDefaultOrganizerAccounts() {
  return new Map(
    ORGANIZER_NAMES.map((name) => {
      const normalizedName = normalizeIdentifier(name);
      return [
        normalizedName,
        {
          username: name,
          normalizedUsername: normalizedName,
          password: `${normalizedName}123`
        }
      ];
    })
  );
}

function loadOrganizerAccounts() {
  const raw = process.env.ORGANIZER_ACCOUNTS_JSON;
  if (!raw) {
    return { accounts: buildDefaultOrganizerAccounts(), usingDefault: true };
  }

  try {
    const parsed = JSON.parse(raw);
    const sourceEntries = Array.isArray(parsed)
      ? parsed
      : Object.entries(parsed).map(([username, password]) => ({ username, password }));
    const accounts = new Map();

    for (const entry of sourceEntries) {
      const username = String(entry?.username || "").trim();
      const password = String(entry?.password || "");
      const normalizedUsername = normalizeIdentifier(username);

      if (!normalizedUsername || !password) {
        continue;
      }

      accounts.set(normalizedUsername, {
        username,
        normalizedUsername,
        password
      });
    }

    if (!accounts.size) {
      throw new Error("No valid organizer accounts were found.");
    }

    return { accounts, usingDefault: false };
  } catch (error) {
    console.warn(`Could not parse ORGANIZER_ACCOUNTS_JSON. Falling back to default organizer accounts. ${error.message}`);
    return { accounts: buildDefaultOrganizerAccounts(), usingDefault: true };
  }
}

function normalizeIdentifier(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function buildPlayerUsername(player) {
  return `${normalizeIdentifier(player.player_name)}${player.player_number}`;
}

function getOrganizerAccount(username) {
  return organizerAccounts.get(normalizeIdentifier(username)) || null;
}

function isPlayerSpotlightAwardType(honorType) {
  return honorType === "best_player_of_week" || honorType === "best_goalkeeper";
}

function isGoalkeeperPosition(position) {
  const normalized = String(position || "").trim().toLowerCase();
  return normalized === "gk" || normalized.includes("keeper");
}

function getSpotlightTitle(honorType) {
  switch (honorType) {
    case "best_player_of_week":
      return "Best Player Of The Week";
    case "best_goalkeeper":
      return "Best Goalkeeper";
    case "best_team_of_week":
      return "Best Team Of The Week";
    case "best_team_of_month":
      return "Best Team Of The Month";
    default:
      return "Tournament Spotlight";
  }
}

function includesAny(text, phrases) {
  return phrases.some((phrase) => text.includes(phrase));
}

function formatChatList(rows, formatter) {
  return rows.map((row, index) => `${index + 1}. ${formatter(row)}`).join("\n");
}

function formatFixtureLine(fixture) {
  return `${fixture.match_date} ${String(fixture.match_time || "").slice(0, 5)} - ${fixture.home_team_name} vs ${fixture.away_team_name}`;
}

function formatStandingLine(row) {
  return `${row.team_name}: ${row.Pts} pts, ${row.W}W-${row.D}D-${row.L}L, GD ${row.GD}`;
}

function pickBestEntityMatch(question, entities, valueGetter) {
  const normalizedQuestion = normalizeIdentifier(question);
  let bestMatch = null;

  for (const entity of entities) {
    const rawValue = valueGetter(entity);
    const normalizedValue = normalizeIdentifier(rawValue);

    if (!normalizedValue) {
      continue;
    }

    if (normalizedQuestion.includes(normalizedValue)) {
      if (!bestMatch || normalizedValue.length > normalizeIdentifier(valueGetter(bestMatch)).length) {
        bestMatch = entity;
      }
    }
  }

  return bestMatch;
}

async function loadChatDirectory() {
  const [teams, players] = await Promise.all([
    query("SELECT team_number, team_name, captain_name FROM teams ORDER BY team_number ASC"),
    query(`
      SELECT
        p.player_number,
        p.player_name,
        p.position,
        p.player_team,
        t.team_name
      FROM players p
      JOIN teams t ON p.player_team = t.team_number
      ORDER BY p.player_team ASC, p.player_number ASC, p.player_name ASC
    `)
  ]);

  return { teams, players };
}

function findTeamFromQuestion(question, teams) {
  const numberMatch = question.match(/\bteam\s*(\d+)\b/i) || question.match(/\b(\d+)\b/);
  if (numberMatch) {
    const teamByNumber = teams.find((team) => team.team_number === Number(numberMatch[1]));
    if (teamByNumber) {
      return teamByNumber;
    }
  }

  return pickBestEntityMatch(question, teams, (team) => team.team_name);
}

function findPlayerFromQuestion(question, players, preferredTeamNumber = null) {
  const scopedPlayers = preferredTeamNumber
    ? players.filter((player) => player.player_team === preferredTeamNumber)
    : players;

  return (
    pickBestEntityMatch(question, scopedPlayers, (player) => player.player_name) ||
    (!preferredTeamNumber ? null : pickBestEntityMatch(question, players, (player) => player.player_name))
  );
}

async function answerTournamentQuestion(message) {
  const question = String(message || "").trim();
  const lower = question.toLowerCase();
  const { teams, players } = await loadChatDirectory();
  const team = findTeamFromQuestion(question, teams);
  const player = findPlayerFromQuestion(question, players, team?.team_number ?? null);

  if (!question) {
    return "Ask me about teams, players, captains, standings, fixtures, top scorers, or tournament news.";
  }

  if (/\b(hello|hi|hey|help)\b/i.test(lower) || lower.includes("what can you do")) {
    return [
      "I can answer questions about this tournament from the live database.",
      "Try asking:",
      "1. List all teams",
      "2. Who is the captain of morocco giants?",
      "3. Show the players of Asia FCB",
      "4. Which team does Hamza play for?",
      "5. Show the league table",
      "6. Who are the top scorers?",
      "7. Who has the most clean sheets?"
    ].join("\n");
  }

  if (includesAny(lower, ["list all teams", "show all teams", "what teams", "registered teams", "teams list"])) {
    return `There are ${teams.length} teams in the tournament:\n${formatChatList(teams, (entry) => `Team ${entry.team_number} - ${entry.team_name}`)}`;
  }

  if (includesAny(lower, ["captain", "captain name"]) && team) {
    return `The captain of ${team.team_name} is ${team.captain_name || "not set yet"}.`;
  }

  if (team && includesAny(lower, ["players", "members", "squad", "roster", "who plays for"])) {
    const roster = players.filter((entry) => entry.player_team === team.team_number);
    if (!roster.length) {
      return `${team.team_name} does not have any players added yet.`;
    }

    return `${team.team_name} has ${roster.length} players:\n${formatChatList(roster, (entry) => `#${entry.player_number} ${entry.player_name} - ${entry.position}`)}`;
  }

  if (player && includesAny(lower, ["what team", "which team", "play for", "plays for", "belongs to"])) {
    return `${player.player_name} plays for ${player.team_name} as ${player.position}, wearing jersey #${player.player_number}.`;
  }

  if (player && includesAny(lower, ["position", "role"])) {
    return `${player.player_name} plays as ${player.position} for ${player.team_name} and wears jersey #${player.player_number}.`;
  }

  if (includesAny(lower, ["top scorer", "top scorers", "top goals", "goal leaders", "who scored"])) {
    const rows = await query("SELECT player_number, player_name, team_name, total_goals FROM top_goals WHERE total_goals > 0 LIMIT 5");
    if (!rows.length) {
      return "There are no goal statistics yet.";
    }

    return `Current top scorers:\n${formatChatList(rows, (entry) => `${entry.player_name} (${entry.team_name}) - ${entry.total_goals} goals`)}`;
  }

  if (includesAny(lower, ["top assists", "assist leaders", "most assists"])) {
    const rows = await query("SELECT player_number, player_name, team_name, total_assists FROM top_assists WHERE total_assists > 0 LIMIT 5");
    if (!rows.length) {
      return "There are no assist statistics yet.";
    }

    return `Current assist leaders:\n${formatChatList(rows, (entry) => `${entry.player_name} (${entry.team_name}) - ${entry.total_assists} assists`)}`;
  }

  if (includesAny(lower, ["yellow cards", "most yellow", "yellow card leaders"])) {
    const rows = await query("SELECT player_name, team_name, total_yellow_cards FROM yellow_cards WHERE total_yellow_cards > 0 LIMIT 5");
    if (!rows.length) {
      return "There are no yellow card records yet.";
    }

    return `Yellow card standings:\n${formatChatList(rows, (entry) => `${entry.player_name} (${entry.team_name}) - ${entry.total_yellow_cards} yellow cards`)}`;
  }

  if (includesAny(lower, ["red cards", "most red", "red card leaders"])) {
    const rows = await query("SELECT player_name, team_name, total_red_cards FROM red_cards WHERE total_red_cards > 0 LIMIT 5");
    if (!rows.length) {
      return "There are no red card records yet.";
    }

    return `Red card standings:\n${formatChatList(rows, (entry) => `${entry.player_name} (${entry.team_name}) - ${entry.total_red_cards} red cards`)}`;
  }

  if (includesAny(lower, ["clean sheet", "clean sheets", "top clean sheets", "goalkeeper clean sheets"])) {
    const rows = await query("SELECT player_name, team_name, total_clean_sheets FROM top_clean_sheets WHERE total_clean_sheets > 0 LIMIT 5");
    if (!rows.length) {
      return "There are no clean sheet records yet.";
    }

    return `Clean sheet leaders:\n${formatChatList(rows, (entry) => `${entry.player_name} (${entry.team_name}) - ${entry.total_clean_sheets} clean sheets`)}`;
  }

  if (includesAny(lower, ["best goalkeeper", "goalkeeper award", "top goalkeeper"])) {
    const rows = await query(`${datasetQueries.spotlight_awards} LIMIT 10`);
    const goalkeeper = rows.find((entry) => entry.honor_type === "best_goalkeeper");
    if (!goalkeeper) {
      return "The best goalkeeper award has not been published yet.";
    }

    return `${goalkeeper.title}: ${goalkeeper.player_name || "No selection yet"}${goalkeeper.player_team_name ? ` from ${goalkeeper.player_team_name}` : ""}.`;
  }

  if (includesAny(lower, ["league table", "standings", "table", "ranking"])) {
    const rows = await query("SELECT team_number, team_name, P, W, D, L, GF, GA, GD, Pts FROM league_table ORDER BY Pts DESC, GD DESC, GF DESC, team_name ASC");
    if (!rows.length) {
      return "The league table is empty right now.";
    }

    if (team) {
      const standing = rows.find((entry) => entry.team_number === team.team_number);
      if (!standing) {
        return `${team.team_name} is not in the league table yet.`;
      }

      return `${team.team_name} currently has ${standing.Pts} points with a ${standing.W}W-${standing.D}D-${standing.L}L record, ${standing.GF} goals for, ${standing.GA} against, and goal difference ${standing.GD}.`;
    }

    return `Current league table:\n${formatChatList(rows.slice(0, 6), (entry) => formatStandingLine(entry))}`;
  }

  if (includesAny(lower, ["fixture", "fixtures", "match", "matches", "schedule", "next game"])) {
    let rows;

    if (team) {
      rows = await query(
        `
          SELECT
            m.match_date,
            m.match_time,
            th.team_name AS home_team_name,
            ta.team_name AS away_team_name,
            m.status
          FROM matches m
          JOIN teams th ON m.home_team = th.team_number
          JOIN teams ta ON m.away_team = ta.team_number
          WHERE (m.home_team = ? OR m.away_team = ?) AND m.status = 'scheduled'
          ORDER BY m.match_date ASC, m.match_time ASC
          LIMIT 5
        `,
        [team.team_number, team.team_number]
      );

      if (!rows.length) {
        return `There are no scheduled fixtures yet for ${team.team_name}.`;
      }

      return `Next fixtures for ${team.team_name}:\n${formatChatList(rows, (entry) => formatFixtureLine(entry))}`;
    }

    rows = await query(
      `
        SELECT
          m.match_date,
          m.match_time,
          th.team_name AS home_team_name,
          ta.team_name AS away_team_name,
          m.status
        FROM matches m
        JOIN teams th ON m.home_team = th.team_number
        JOIN teams ta ON m.away_team = ta.team_number
        WHERE m.status = 'scheduled'
        ORDER BY m.match_date ASC, m.match_time ASC
        LIMIT 5
      `
    );

    if (!rows.length) {
      return "There are no scheduled fixtures in the tournament yet.";
    }

    return `Upcoming tournament fixtures:\n${formatChatList(rows, (entry) => formatFixtureLine(entry))}`;
  }

  if (includesAny(lower, ["player of the week", "team of the week", "team of the month", "spotlight"])) {
    const rows = await query(datasetQueries.spotlight_awards);
    if (!rows.length) {
      return "No spotlight awards have been published yet.";
    }

    return rows
      .map((entry) => {
        const subject = entry.team_name || entry.player_name || "No selection yet";
        return `${entry.title}: ${subject}`;
      })
      .join("\n");
  }

  if (includesAny(lower, ["weekly news", "news", "latest news", "updates"])) {
    const rows = await query(`
      SELECT week_label, headline, published_on
      FROM weekly_news
      ORDER BY published_on DESC, news_id DESC
      LIMIT 3
    `);

    if (!rows.length) {
      return "There are no weekly news posts yet.";
    }

    return `Latest weekly news:\n${formatChatList(rows, (entry) => `${entry.week_label} - ${entry.headline} (${entry.published_on})`)}`;
  }

  if (team) {
    const rosterCount = players.filter((entry) => entry.player_team === team.team_number).length;
    return `${team.team_name} is Team ${team.team_number}. Captain: ${team.captain_name || "not set yet"}. Registered players: ${rosterCount}.`;
  }

  if (player) {
    return `${player.player_name} plays for ${player.team_name} as ${player.position}, jersey #${player.player_number}.`;
  }

  return "I couldn't match that question yet. Try asking about a team, a player, the league table, fixtures, top scorers, or weekly news.";
}

function formatGeminiRows(title, rows, formatter, emptyText = "None") {
  if (!rows.length) {
    return `${title}:\n${emptyText}`;
  }

  return `${title}:\n${rows.map((row) => formatter(row)).join("\n")}`;
}

async function buildGeminiTournamentContext() {
  const [teams, players, standings, fixtures, topGoals, topAssists, topCleanSheets, weeklyNews, awards] = await Promise.all([
    query("SELECT team_number, team_name, captain_name FROM teams ORDER BY team_number ASC"),
    query(`
      SELECT
        p.player_number,
        p.player_name,
        p.position,
        p.player_team,
        t.team_name
      FROM players p
      JOIN teams t ON p.player_team = t.team_number
      ORDER BY p.player_team ASC, p.player_number ASC, p.player_name ASC
    `),
    query("SELECT team_number, team_name, P, W, D, L, GF, GA, GD, Pts FROM league_table ORDER BY Pts DESC, GD DESC, GF DESC, team_name ASC LIMIT 10"),
    query(`
      SELECT
        m.match_date,
        m.match_time,
        m.status,
        th.team_name AS home_team_name,
        ta.team_name AS away_team_name,
        m.home_goals,
        m.away_goals
      FROM matches m
      JOIN teams th ON m.home_team = th.team_number
      JOIN teams ta ON m.away_team = ta.team_number
      ORDER BY m.match_date ASC, m.match_time ASC
      LIMIT 12
    `),
    query("SELECT player_name, team_name, total_goals FROM top_goals WHERE total_goals > 0 ORDER BY total_goals DESC, player_name ASC LIMIT 5"),
    query("SELECT player_name, team_name, total_assists FROM top_assists WHERE total_assists > 0 ORDER BY total_assists DESC, player_name ASC LIMIT 5"),
    query("SELECT player_name, team_name, total_clean_sheets FROM top_clean_sheets WHERE total_clean_sheets > 0 ORDER BY total_clean_sheets DESC, player_name ASC LIMIT 5"),
    query("SELECT week_label, headline, published_on FROM weekly_news ORDER BY published_on DESC, news_id DESC LIMIT 5"),
    query(datasetQueries.spotlight_awards)
  ]);

  return [
    "ISU Football Tournament live database snapshot.",
    formatGeminiRows("Teams", teams, (entry) => `Team ${entry.team_number}: ${entry.team_name} | Captain: ${entry.captain_name || "Not set"}`),
    formatGeminiRows("Players", players, (entry) => `Team ${entry.player_team} ${entry.team_name} | #${entry.player_number} ${entry.player_name} | ${entry.position}`),
    formatGeminiRows("League table", standings, (entry) => `${entry.team_name} | ${entry.Pts} pts | ${entry.W}W-${entry.D}D-${entry.L}L | GD ${entry.GD}`),
    formatGeminiRows("Fixtures", fixtures, (entry) => `${entry.match_date} ${String(entry.match_time || "").slice(0, 5)} | ${entry.home_team_name} vs ${entry.away_team_name} | ${entry.status}${entry.status === "played" ? ` | ${entry.home_goals}-${entry.away_goals}` : ""}`),
    formatGeminiRows("Top goals", topGoals, (entry) => `${entry.player_name} (${entry.team_name}) - ${entry.total_goals}`),
    formatGeminiRows("Top assists", topAssists, (entry) => `${entry.player_name} (${entry.team_name}) - ${entry.total_assists}`),
    formatGeminiRows("Top clean sheets", topCleanSheets, (entry) => `${entry.player_name} (${entry.team_name}) - ${entry.total_clean_sheets}`),
    formatGeminiRows("Weekly news", weeklyNews, (entry) => `${entry.week_label} | ${entry.headline} | ${entry.published_on}`),
    formatGeminiRows("Spotlight awards", awards, (entry) => `${entry.title}: ${entry.team_name || entry.player_name || "No selection yet"}`)
  ].join("\n\n");
}

function extractGeminiText(payload) {
  const candidates = Array.isArray(payload?.candidates) ? payload.candidates : [];

  for (const candidate of candidates) {
    const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
    const text = parts
      .map((part) => (typeof part?.text === "string" ? part.text : ""))
      .join("")
      .trim();

    if (text) {
      return text;
    }
  }

  return "";
}

async function answerTournamentQuestionWithGemini(message) {
  const context = await buildGeminiTournamentContext();
  const response = await fetch(`${GEMINI_API_BASE}/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": GEMINI_API_KEY
    },
    body: JSON.stringify({
      system_instruction: {
        parts: [
          {
            text: [
              "You are Gemini inside the ISU Football Tournament website.",
              "Answer only from the provided tournament data.",
              "If the answer is not in the data, clearly say you do not have that information yet.",
              "Keep answers concise, accurate, and friendly.",
              "When useful, mention team name, team number, jersey number, and position.",
              "",
              context
            ].join("\n")
          }
        ]
      },
      contents: [
        {
          role: "user",
          parts: [{ text: message }]
        }
      ],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 400
      }
    }),
    signal: AbortSignal.timeout(15000)
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    throw createHttpError(payload?.error?.message || `Gemini request failed with status ${response.status}.`, 502);
  }

  const answer = extractGeminiText(payload);
  if (answer) {
    return answer;
  }

  if (payload?.promptFeedback?.blockReason) {
    return `Gemini could not answer that request because it was blocked: ${payload.promptFeedback.blockReason}.`;
  }

  throw createHttpError("Gemini returned an empty response.", 502);
}

async function getChatAnswer(message) {
  if (!GEMINI_API_KEY) {
    return answerTournamentQuestion(message);
  }

  try {
    return await answerTournamentQuestionWithGemini(message);
  } catch (error) {
    console.error("Gemini chat failed, falling back to local tournament answers.", error);
    return answerTournamentQuestion(message);
  }
}

function isDatabaseUnavailable(error) {
  if (!error) return false;

  if (String(error.message || error).startsWith("Missing database environment variables:")) {
    return true;
  }

  return unavailableDbCodes.has(error.code);
}

function createHttpError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function createRateLimiter({ name, windowMs, max, message }) {
  const store = rateLimitStores.get(name) || new Map();
  rateLimitStores.set(name, store);

  return (req, res, next) => {
    const now = Date.now();
    const key = String(req.ip || req.headers["x-forwarded-for"] || "unknown");
    const current = store.get(key);

    if (!current || current.resetAt <= now) {
      store.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    if (current.count >= max) {
      return res.status(429).json({ error: message });
    }

    current.count += 1;
    next();
  };
}

function mapDatabaseError(error) {
  if (error.code === "ER_DUP_ENTRY") {
    throw createHttpError("This record already exists.", 409);
  }

  if (error.code === "ER_ROW_IS_REFERENCED_2" || error.code === "ER_NO_REFERENCED_ROW_2") {
    throw createHttpError("This change conflicts with related tournament data.", 400);
  }

  if (isDatabaseUnavailable(error)) {
    throw createHttpError("Database is unavailable. Check MySQL and try again.", 503);
  }

  throw error;
}

function resolveDatabaseConfig() {
  return {
    host: process.env.DB_HOST || process.env.MYSQLHOST,
    port: Number(process.env.DB_PORT || process.env.MYSQLPORT || 3306),
    user: process.env.DB_USER || process.env.MYSQLUSER,
    password: process.env.DB_PASSWORD ?? process.env.MYSQLPASSWORD ?? "",
    database: process.env.DB_NAME || process.env.MYSQLDATABASE
  };
}

function getPool() {
  const config = resolveDatabaseConfig();
  const missing = ["host", "user", "database"].filter((key) => !config[key]);

  if (missing.length > 0) {
    throw new Error(`Missing database environment variables: ${missing.join(", ")}`);
  }

  if (!pool) {
    pool = mysql.createPool({
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      database: config.database,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0
    });
  }

  return pool;
}

async function query(sql, params = []) {
  const [rows] = await getPool().execute(sql, params);
  return rows;
}

async function pingDatabase() {
  const connection = await getPool().getConnection();
  connection.release();
}

function listFallbackTeams() {
  return [...fallbackTeams].sort((a, b) => a.team_number - b.team_number);
}

function insertFallbackTeam(team) {
  if (fallbackTeams.some((entry) => entry.team_number === team.team_number)) {
    throw createHttpError("Team number already exists", 409);
  }

  if (fallbackTeams.some((entry) => entry.team_name === team.team_name)) {
    throw createHttpError("Team name already exists", 409);
  }

  fallbackTeams.push({
    team_number: team.team_number,
    team_name: team.team_name,
    captain_name: team.captain_name ?? null
  });
}

function deleteFallbackTeam(teamNumber) {
  const index = fallbackTeams.findIndex((entry) => entry.team_number === teamNumber);

  if (index === -1) {
    return { affectedRows: 0 };
  }

  fallbackTeams.splice(index, 1);
  return { affectedRows: 1 };
}

function cleanupExpiredSessions(store) {
  const now = Date.now();

  for (const [token, session] of store.entries()) {
    if (session.expiresAt <= now) {
      store.delete(token);
    }
  }
}

function parseCookies(header = "") {
  return header
    .split(";")
    .map((cookie) => cookie.trim())
    .filter(Boolean)
    .reduce((accumulator, cookie) => {
      const separatorIndex = cookie.indexOf("=");
      const key = separatorIndex >= 0 ? cookie.slice(0, separatorIndex) : cookie;
      const value = separatorIndex >= 0 ? cookie.slice(separatorIndex + 1) : "";

      accumulator[key] = decodeURIComponent(value);
      return accumulator;
    }, {});
}

function setSessionCookie(res, cookieName, token) {
  const secureFlag = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `${cookieName}=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}${secureFlag}`
  );
}

function clearSessionCookie(res, cookieName) {
  const secureFlag = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `${cookieName}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${secureFlag}`
  );
}

function createSession(store, payload) {
  cleanupExpiredSessions(store);
  const token = crypto.randomUUID();

  store.set(token, {
    ...payload,
    expiresAt: Date.now() + SESSION_TTL_MS
  });

  return token;
}

function getSession(store, cookieName, req) {
  cleanupExpiredSessions(store);

  const token = parseCookies(req.headers.cookie || "")[cookieName];
  if (!token) {
    return null;
  }

  const session = store.get(token);
  if (!session) {
    return null;
  }

  if (session.expiresAt <= Date.now()) {
    store.delete(token);
    return null;
  }

  session.expiresAt = Date.now() + SESSION_TTL_MS;
  return { token, ...session };
}

function getPlayerSession(req) {
  return getSession(playerSessions, PLAYER_SESSION_COOKIE, req);
}

function getAdminSession(req) {
  return getSession(adminSessions, ADMIN_SESSION_COOKIE, req);
}

function requireAdmin(req, res) {
  const session = getAdminSession(req);
  if (!session) {
    res.status(401).json({ error: "Please log in as organizer to update tournament data." });
    return null;
  }

  return session;
}

async function fetchDatasetRows(name) {
  const sql = datasetQueries[name];

  if (!sql) {
    throw createHttpError("Unknown dataset", 404);
  }

  try {
    return await query(sql);
  } catch (error) {
    if (name === "teams" && isDatabaseUnavailable(error)) {
      rememberDemoMode(error);
      return listFallbackTeams();
    }

    throw error;
  }
}

async function getPlayerProfile(playerId) {
  const rows = await query(
    `
      SELECT
        p.player_id,
        p.player_number,
        p.player_name,
        p.position,
        p.player_team,
        t.team_name
      FROM players p
      JOIN teams t ON p.player_team = t.team_number
      WHERE p.player_id = ?
      LIMIT 1
    `,
    [playerId]
  );

  return rows[0] || null;
}

async function getPlayerByTeamAndNumber(playerTeam, playerNumber) {
  const rows = await query(
    `
      SELECT
        p.player_id,
        p.player_number,
        p.player_name,
        p.position,
        p.player_team,
        t.team_name
      FROM players p
      JOIN teams t ON p.player_team = t.team_number
      WHERE p.player_team = ? AND p.player_number = ?
      LIMIT 1
    `,
    [playerTeam, playerNumber]
  );

  return rows[0] || null;
}

async function findPlayerForLogin(username, playerNumber) {
  const rows = await query(
    `
      SELECT
        p.player_id,
        p.player_number,
        p.player_name,
        p.position,
        p.player_team,
        t.team_name
      FROM players p
      JOIN teams t ON p.player_team = t.team_number
      WHERE p.player_number = ?
      ORDER BY p.player_team ASC, p.player_id ASC
    `,
    [playerNumber]
  );

  const expectedUsername = normalizeIdentifier(username);
  const matches = rows.filter((player) => buildPlayerUsername(player) === expectedUsername);
  return matches.length === 1 ? matches[0] : null;
}

async function getAuthenticatedPlayer(req, res) {
  const session = getPlayerSession(req);
  if (!session) {
    res.status(401).json({ error: "Please log in as a player to see tournament updates." });
    return null;
  }

  const player = await getPlayerProfile(session.playerId);
  if (!player) {
    playerSessions.delete(session.token);
    clearSessionCookie(res, PLAYER_SESSION_COOKIE);
    res.status(401).json({ error: "Your player session is no longer valid. Please log in again." });
    return null;
  }

  return { session, player };
}

async function buildPlayerUpdates(player) {
  const [upcomingFixtures, recentResults, leagueRows, teamMembers, topScorers, topAssists, teamOfSeasonRows] = await Promise.all([
    query(
      `
        SELECT
          m.match_id,
          m.match_date,
          m.match_time,
          th.team_name AS home_team,
          ta.team_name AS away_team,
          m.status
        FROM matches m
        JOIN teams th ON m.home_team = th.team_number
        JOIN teams ta ON m.away_team = ta.team_number
        WHERE (m.home_team = ? OR m.away_team = ?) AND m.status = 'scheduled'
        ORDER BY m.match_date ASC, m.match_time ASC
        LIMIT 5
      `,
      [player.player_team, player.player_team]
    ),
    query(
      `
        SELECT
          m.match_id,
          m.match_date,
          m.match_time,
          th.team_name AS home_team,
          ta.team_name AS away_team,
          m.home_goals,
          m.away_goals,
          m.status
        FROM matches m
        JOIN teams th ON m.home_team = th.team_number
        JOIN teams ta ON m.away_team = ta.team_number
        WHERE (m.home_team = ? OR m.away_team = ?) AND m.status = 'played'
        ORDER BY m.match_date DESC, m.match_time DESC
        LIMIT 5
      `,
      [player.player_team, player.player_team]
    ),
    query(
      `
        SELECT team_number, team_name, P, W, D, L, GF, GA, GD, Pts
        FROM league_table
        WHERE team_number = ?
        LIMIT 1
      `,
      [player.player_team]
    ),
    query(
      `
        SELECT player_number, player_name, position
        FROM team_members_view
        WHERE team_number = ?
        ORDER BY player_number ASC
      `,
      [player.player_team]
    ),
    query("SELECT player_number, player_name, team_name, total_goals FROM top_goals WHERE total_goals > 0 LIMIT 5"),
    query("SELECT player_number, player_name, team_name, total_assists FROM top_assists WHERE total_assists > 0 LIMIT 5"),
    query(
      `
        SELECT tos_id, team_number, team_name
        FROM team_of_the_season
        WHERE team_number = ?
        LIMIT 1
      `,
      [player.player_team]
    )
  ]);

  return {
    player,
    upcomingFixtures,
    recentResults,
    leagueRow: leagueRows[0] || null,
    teamMembers,
    topScorers,
    topAssists,
    teamOfSeason: teamOfSeasonRows[0] || null
  };
}

async function getTeamByNumber(teamNumber) {
  const rows = await query(
    `
      SELECT team_number, team_name, captain_name
      FROM teams
      WHERE team_number = ?
      LIMIT 1
    `,
    [teamNumber]
  );

  return rows[0] || null;
}

async function createTeam(team) {
  await query(
    `
      INSERT INTO teams (team_number, team_name, captain_name)
      VALUES (?, ?, ?)
    `,
    [team.team_number, team.team_name, team.captain_name]
  );
}

async function upsertTeam(team) {
  await query(
    `
      INSERT INTO teams (team_number, team_name, captain_name)
      VALUES (?, ?, ?)
      ON DUPLICATE KEY UPDATE
        team_name = VALUES(team_name),
        captain_name = VALUES(captain_name)
    `,
    [team.team_number, team.team_name, team.captain_name]
  );
}

async function updateTeam(teamNumber, team) {
  const existingTeam = await getTeamByNumber(teamNumber);
  if (!existingTeam) {
    throw createHttpError("Team not found.", 404);
  }

  await query(
    `
      UPDATE teams
      SET team_name = ?, captain_name = ?
      WHERE team_number = ?
    `,
    [team.team_name, team.captain_name, teamNumber]
  );
}

async function upsertPlayer(player) {
  const existingPlayer = await getPlayerByTeamAndNumber(player.player_team, player.player_number);
  let playerId = existingPlayer?.player_id ?? null;

  if (playerId) {
    await query(
      `
        UPDATE players
        SET player_name = ?, position = ?, player_team = ?
        WHERE player_id = ?
      `,
      [player.player_name, player.position, player.player_team, playerId]
    );
  } else {
    const result = await query(
      `
        INSERT INTO players (player_number, player_name, position, player_team)
        VALUES (?, ?, ?, ?)
      `,
      [player.player_number, player.player_name, player.position, player.player_team]
    );

    playerId = result.insertId ?? null;
  }

  if (!playerId) {
    throw createHttpError("Could not resolve the saved player record.", 500);
  }

  await query(
    `
      INSERT INTO team_members (team_number, player_id)
      VALUES (?, ?)
      ON DUPLICATE KEY UPDATE
        team_number = VALUES(team_number)
    `,
    [player.player_team, playerId]
  );
}

async function upsertMatch(match) {
  await query(
    `
      INSERT INTO matches (
        match_id,
        match_date,
        match_time,
        home_team,
        away_team,
        referee_id,
        home_goals,
        away_goals,
        status
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        match_date = VALUES(match_date),
        match_time = VALUES(match_time),
        home_team = VALUES(home_team),
        away_team = VALUES(away_team),
        referee_id = VALUES(referee_id),
        home_goals = VALUES(home_goals),
        away_goals = VALUES(away_goals),
        status = VALUES(status)
    `,
    [
      match.match_id,
      match.match_date,
      match.match_time.length === 5 ? `${match.match_time}:00` : match.match_time,
      match.home_team,
      match.away_team,
      match.referee_id,
      match.home_goals,
      match.away_goals,
      match.status
    ]
  );
}

async function upsertTeamOfSeason(entry) {
  await query(
    `
      INSERT INTO team_of_the_season (tos_id, team_number, team_name)
      VALUES (?, ?, ?)
      ON DUPLICATE KEY UPDATE
        team_number = VALUES(team_number),
        team_name = VALUES(team_name)
    `,
    [entry.tos_id, entry.team_number, entry.team_name]
  );
}

async function upsertStat(stat) {
  const player = await getPlayerByTeamAndNumber(stat.player_team, stat.player_number);
  if (!player) {
    throw createHttpError("Player not found for that team and jersey number.", 404);
  }

  if (stat.clean_sheets > 0 && !isGoalkeeperPosition(player.position)) {
    throw createHttpError("Clean sheets can only be assigned to goalkeeper records.", 400);
  }

  const matchRows = await query(
    `
      SELECT home_team, away_team
      FROM matches
      WHERE match_id = ?
      LIMIT 1
    `,
    [stat.match_id]
  );

  const match = matchRows[0];
  if (!match) {
    throw createHttpError("Match not found.", 404);
  }

  if (match.home_team !== stat.player_team && match.away_team !== stat.player_team) {
    throw createHttpError("That player does not belong to either team in this match.", 400);
  }

  await query(
    `
      INSERT INTO stats (
        match_id,
        player_id,
        state,
        goals,
        assists,
        yellow_cards,
        red_cards,
        clean_sheets
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        state = VALUES(state),
        goals = VALUES(goals),
        assists = VALUES(assists),
        yellow_cards = VALUES(yellow_cards),
        red_cards = VALUES(red_cards),
        clean_sheets = VALUES(clean_sheets)
    `,
    [
      stat.match_id,
      player.player_id,
      stat.state,
      stat.goals,
      stat.assists,
      stat.yellow_cards,
      stat.red_cards,
      stat.clean_sheets
    ]
  );
}

async function saveWeeklyNews(entry) {
  const params = [
    entry.week_label,
    entry.headline,
    entry.summary,
    entry.body,
    entry.published_on,
    entry.featured_team_number ?? null
  ];

  if (entry.news_id) {
    await query(
      `
        INSERT INTO weekly_news (
          news_id,
          week_label,
          headline,
          summary,
          body,
          published_on,
          featured_team_number
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          week_label = VALUES(week_label),
          headline = VALUES(headline),
          summary = VALUES(summary),
          body = VALUES(body),
          published_on = VALUES(published_on),
          featured_team_number = VALUES(featured_team_number)
      `,
      [entry.news_id, ...params]
    );

    return entry.news_id;
  }

  const result = await query(
    `
      INSERT INTO weekly_news (
        week_label,
        headline,
        summary,
        body,
        published_on,
        featured_team_number
      )
      VALUES (?, ?, ?, ?, ?, ?)
    `,
    params
  );

  return result.insertId ?? null;
}

async function upsertSpotlightAward(entry) {
  const spotlightPlayer =
    isPlayerSpotlightAwardType(entry.honor_type)
      ? await getPlayerByTeamAndNumber(entry.player_team, entry.player_number)
      : null;

  if (isPlayerSpotlightAwardType(entry.honor_type) && !spotlightPlayer) {
    throw createHttpError("Player not found for that team and jersey number.", 404);
  }

  if (entry.honor_type === "best_goalkeeper" && !isGoalkeeperPosition(spotlightPlayer?.position)) {
    throw createHttpError("Best goalkeeper must point to a goalkeeper record.", 400);
  }

  const normalizedEntry = {
    ...entry,
    player_id: isPlayerSpotlightAwardType(entry.honor_type) ? spotlightPlayer?.player_id ?? null : null,
    team_number: isPlayerSpotlightAwardType(entry.honor_type) ? null : entry.team_number ?? null,
    title: entry.title || getSpotlightTitle(entry.honor_type)
  };

  await query(
    `
      INSERT INTO spotlight_awards (
        honor_type,
        player_id,
        team_number,
        title,
        description
      )
      VALUES (?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        player_id = VALUES(player_id),
        team_number = VALUES(team_number),
        title = VALUES(title),
        description = VALUES(description)
    `,
    [
      normalizedEntry.honor_type,
      normalizedEntry.player_id,
      normalizedEntry.team_number,
      normalizedEntry.title,
      normalizedEntry.description
    ]
  );
}

async function deletePlayer(playerTeam, playerNumber) {
  const player = await getPlayerByTeamAndNumber(playerTeam, playerNumber);
  if (!player) {
    return 0;
  }

  const result = await query("DELETE FROM players WHERE player_id = ?", [player.player_id]);
  return result.affectedRows ?? 0;
}

async function deleteStat(matchId, playerTeam, playerNumber) {
  const player = await getPlayerByTeamAndNumber(playerTeam, playerNumber);
  if (!player) {
    return 0;
  }

  const result = await query(
    "DELETE FROM stats WHERE match_id = ? AND player_id = ?",
    [matchId, player.player_id]
  );
  return result.affectedRows ?? 0;
}

async function deleteById(table, column, id) {
  const result = await query(`DELETE FROM ${table} WHERE ${column} = ?`, [id]);
  return result.affectedRows ?? 0;
}

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(morgan("dev"));
app.use(express.json());

app.use(express.static(PUBLIC_DIR));

app.get("/api/health", asyncHandler(async (req, res) => {
  try {
    await pingDatabase();
    res.json({ ok: true, db: "connected", mode: "mysql" });
  } catch (error) {
    rememberDemoMode(error);
    res.json({ ok: true, db: "demo", mode: "in-memory", reason: demoModeReason });
  }
}));

app.get("/api/teams", asyncHandler(async (req, res) => {
  const rows = await fetchDatasetRows("teams");
  res.json(rows);
}));

app.get("/api/datasets/:name", asyncHandler(async (req, res) => {
  const rows = await fetchDatasetRows(req.params.name);
  res.json(rows);
}));

app.get("/api/news/weekly", asyncHandler(async (req, res) => {
  const rows = await fetchDatasetRows("weekly_news");
  res.json(rows);
}));

app.get("/api/news/honors", asyncHandler(async (req, res) => {
  const rows = await fetchDatasetRows("spotlight_awards");
  res.json(rows);
}));

app.post("/api/chat/ask", asyncHandler(async (req, res) => {
  const parsed = ChatQuestionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid chat question.", details: parsed.error.flatten() });
  }

  const answer = await getChatAnswer(parsed.data.message);
  res.json({ ok: true, answer, provider: GEMINI_API_KEY ? "gemini" : "local" });
}));

app.post("/api/player/login", asyncHandler(async (req, res) => {
  const parsed = PlayerLoginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid login details.", details: parsed.error.flatten() });
  }

  const { username, code } = parsed.data;
  const playerNumber = Number(code);
  const player = await findPlayerForLogin(username, playerNumber);

  if (!player) {
    return res.status(401).json({ error: "Player username or code is incorrect." });
  }

  const expectedUsername = buildPlayerUsername(player);
  if (normalizeIdentifier(username) !== expectedUsername || String(player.player_number) !== code) {
    return res.status(401).json({ error: "Player username or code is incorrect." });
  }

  const token = createSession(playerSessions, { playerId: player.player_id });
  setSessionCookie(res, PLAYER_SESSION_COOKIE, token);

  res.json({
    ok: true,
    player,
    login: {
      username: expectedUsername,
      code: String(player.player_number)
    },
    message: `Welcome back, ${player.player_name}.`
  });
}));

app.post("/api/player/logout", asyncHandler(async (req, res) => {
  const session = getPlayerSession(req);
  if (session) {
    playerSessions.delete(session.token);
  }

  clearSessionCookie(res, PLAYER_SESSION_COOKIE);
  res.json({ ok: true });
}));

app.get("/api/player/me", asyncHandler(async (req, res) => {
  const auth = await getAuthenticatedPlayer(req, res);
  if (!auth) {
    return;
  }

  res.json({ player: auth.player });
}));

app.get("/api/player/updates", asyncHandler(async (req, res) => {
  const auth = await getAuthenticatedPlayer(req, res);
  if (!auth) {
    return;
  }

  const updates = await buildPlayerUpdates(auth.player);
  res.json(updates);
}));

app.post(["/api/admin/login", "/api/organizer/login"], asyncHandler(async (req, res) => {
  const parsed = AdminLoginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid organizer login details.", details: parsed.error.flatten() });
  }

  const { username, password } = parsed.data;
  const account = getOrganizerAccount(username);
  if (!account || normalizeIdentifier(password) !== account.password) {
    return res.status(401).json({ error: "Organizer username or password is incorrect." });
  }

  const token = createSession(adminSessions, { username: account.username });
  setSessionCookie(res, ADMIN_SESSION_COOKIE, token);

  res.json({
    ok: true,
    organizer: { username: account.username },
    admin: { username: account.username }
  });
}));

app.post(["/api/admin/logout", "/api/organizer/logout"], asyncHandler(async (req, res) => {
  const session = getAdminSession(req);
  if (session) {
    adminSessions.delete(session.token);
  }

  clearSessionCookie(res, ADMIN_SESSION_COOKIE);
  res.json({ ok: true });
}));

app.get(["/api/admin/me", "/api/organizer/me"], asyncHandler(async (req, res) => {
  const session = requireAdmin(req, res);
  if (!session) {
    return;
  }

  res.json({
    organizer: { username: session.username },
    admin: { username: session.username }
  });
}));

app.get(["/api/admin/teams/:team_number", "/api/organizer/teams/:team_number"], asyncHandler(async (req, res) => {
  if (!requireAdmin(req, res)) return;

  const teamNumber = Number(req.params.team_number);
  if (!Number.isInteger(teamNumber)) {
    return res.status(400).json({ error: "Invalid team number." });
  }

  try {
    const team = await getTeamByNumber(teamNumber);
    if (!team) {
      return res.status(404).json({ error: "Team not found." });
    }

    res.json({ ok: true, team });
  } catch (error) {
    mapDatabaseError(error);
  }
}));

app.post(["/api/admin/teams", "/api/organizer/teams"], asyncHandler(async (req, res) => {
  if (!requireAdmin(req, res)) return;

  const parsed = TeamSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid team details.", details: parsed.error.flatten() });
  }

  try {
    await createTeam(parsed.data);
    res.status(201).json({ ok: true, message: "Team added successfully." });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ error: "Team already exists. Load it first if you want to update it." });
    }

    mapDatabaseError(error);
  }
}));

app.put(["/api/admin/teams/:team_number", "/api/organizer/teams/:team_number"], asyncHandler(async (req, res) => {
  if (!requireAdmin(req, res)) return;

  const teamNumber = Number(req.params.team_number);
  if (!Number.isInteger(teamNumber)) {
    return res.status(400).json({ error: "Invalid team number." });
  }

  const parsed = TeamUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid team update details.", details: parsed.error.flatten() });
  }

  try {
    await updateTeam(teamNumber, parsed.data);
    res.json({ ok: true, message: "Team updated successfully." });
  } catch (error) {
    mapDatabaseError(error);
  }
}));

app.delete(["/api/admin/teams/:team_number", "/api/organizer/teams/:team_number"], asyncHandler(async (req, res) => {
  if (!requireAdmin(req, res)) return;

  const teamNumber = Number(req.params.team_number);
  if (!Number.isInteger(teamNumber)) {
    return res.status(400).json({ error: "Invalid team number." });
  }

  try {
    const affectedRows = await deleteById("teams", "team_number", teamNumber);
    res.json({ ok: true, affectedRows, message: "Team delete request completed." });
  } catch (error) {
    mapDatabaseError(error);
  }
}));

app.post(["/api/admin/players", "/api/organizer/players"], asyncHandler(async (req, res) => {
  if (!requireAdmin(req, res)) return;

  const parsed = PlayerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid player details.", details: parsed.error.flatten() });
  }

  try {
    await upsertPlayer(parsed.data);
    res.json({ ok: true, message: "Player saved successfully." });
  } catch (error) {
    mapDatabaseError(error);
  }
}));

app.delete(["/api/admin/players/:player_team/:player_number", "/api/organizer/players/:player_team/:player_number"], asyncHandler(async (req, res) => {
  if (!requireAdmin(req, res)) return;

  const playerTeam = Number(req.params.player_team);
  const playerNumber = Number(req.params.player_number);
  if (!Number.isInteger(playerTeam) || !Number.isInteger(playerNumber)) {
    return res.status(400).json({ error: "Invalid player number." });
  }

  try {
    const affectedRows = await deletePlayer(playerTeam, playerNumber);
    res.json({ ok: true, affectedRows, message: "Player delete request completed." });
  } catch (error) {
    mapDatabaseError(error);
  }
}));

app.post(["/api/admin/matches", "/api/organizer/matches"], asyncHandler(async (req, res) => {
  if (!requireAdmin(req, res)) return;

  const parsed = MatchSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid match details.", details: parsed.error.flatten() });
  }

  try {
    await upsertMatch(parsed.data);
    res.json({ ok: true, message: "Match saved successfully." });
  } catch (error) {
    mapDatabaseError(error);
  }
}));

app.delete(["/api/admin/matches/:match_id", "/api/organizer/matches/:match_id"], asyncHandler(async (req, res) => {
  if (!requireAdmin(req, res)) return;

  const matchId = Number(req.params.match_id);
  if (!Number.isInteger(matchId)) {
    return res.status(400).json({ error: "Invalid match id." });
  }

  try {
    const affectedRows = await deleteById("matches", "match_id", matchId);
    res.json({ ok: true, affectedRows, message: "Match delete request completed." });
  } catch (error) {
    mapDatabaseError(error);
  }
}));

app.post(["/api/admin/team-of-season", "/api/organizer/team-of-season"], asyncHandler(async (req, res) => {
  if (!requireAdmin(req, res)) return;

  const parsed = TeamOfSeasonSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid team-of-season details.", details: parsed.error.flatten() });
  }

  try {
    await upsertTeamOfSeason(parsed.data);
    res.json({ ok: true, message: "Team of the season entry saved successfully." });
  } catch (error) {
    mapDatabaseError(error);
  }
}));

app.post(["/api/admin/stats", "/api/organizer/stats"], asyncHandler(async (req, res) => {
  if (!requireAdmin(req, res)) return;

  const parsed = StatSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid stat details.", details: parsed.error.flatten() });
  }

  try {
    await upsertStat(parsed.data);
    res.json({ ok: true, message: "Stat line saved successfully." });
  } catch (error) {
    mapDatabaseError(error);
  }
}));

app.delete(["/api/admin/stats/:match_id/:player_team/:player_number", "/api/organizer/stats/:match_id/:player_team/:player_number"], asyncHandler(async (req, res) => {
  if (!requireAdmin(req, res)) return;

  const matchId = Number(req.params.match_id);
  const playerTeam = Number(req.params.player_team);
  const playerNumber = Number(req.params.player_number);
  if (!Number.isInteger(matchId) || !Number.isInteger(playerTeam) || !Number.isInteger(playerNumber)) {
    return res.status(400).json({ error: "Invalid stat key." });
  }

  try {
    const affectedRows = await deleteStat(matchId, playerTeam, playerNumber);
    res.json({ ok: true, affectedRows, message: "Stat line delete request completed." });
  } catch (error) {
    mapDatabaseError(error);
  }
}));

app.delete(["/api/admin/team-of-season/:tos_id", "/api/organizer/team-of-season/:tos_id"], asyncHandler(async (req, res) => {
  if (!requireAdmin(req, res)) return;

  const tosId = Number(req.params.tos_id);
  if (!Number.isInteger(tosId)) {
    return res.status(400).json({ error: "Invalid team-of-season id." });
  }

  try {
    const affectedRows = await deleteById("team_of_the_season", "tos_id", tosId);
    res.json({ ok: true, affectedRows, message: "Team of the season delete request completed." });
  } catch (error) {
    mapDatabaseError(error);
  }
}));

app.post(["/api/admin/news/weekly", "/api/organizer/news/weekly"], asyncHandler(async (req, res) => {
  if (!requireAdmin(req, res)) return;

  const parsed = WeeklyNewsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid weekly news details.", details: parsed.error.flatten() });
  }

  try {
    const newsId = await saveWeeklyNews(parsed.data);
    res.json({
      ok: true,
      news_id: newsId,
      message: parsed.data.news_id ? "Weekly news updated successfully." : "Weekly news published successfully."
    });
  } catch (error) {
    mapDatabaseError(error);
  }
}));

app.delete(["/api/admin/news/weekly/:news_id", "/api/organizer/news/weekly/:news_id"], asyncHandler(async (req, res) => {
  if (!requireAdmin(req, res)) return;

  const newsId = Number(req.params.news_id);
  if (!Number.isInteger(newsId)) {
    return res.status(400).json({ error: "Invalid weekly news id." });
  }

  try {
    const affectedRows = await deleteById("weekly_news", "news_id", newsId);
    res.json({ ok: true, affectedRows, message: "Weekly news delete request completed." });
  } catch (error) {
    mapDatabaseError(error);
  }
}));

app.post(["/api/admin/news/honors", "/api/organizer/news/honors"], asyncHandler(async (req, res) => {
  if (!requireAdmin(req, res)) return;

  const parsed = SpotlightAwardSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid spotlight award details.", details: parsed.error.flatten() });
  }

  try {
    await upsertSpotlightAward(parsed.data);
    res.json({ ok: true, message: "Spotlight award saved successfully." });
  } catch (error) {
    mapDatabaseError(error);
  }
}));

app.delete(["/api/admin/news/honors/:honor_type", "/api/organizer/news/honors/:honor_type"], asyncHandler(async (req, res) => {
  if (!requireAdmin(req, res)) return;

  const parsed = SpotlightAwardTypeSchema.safeParse(req.params.honor_type);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid spotlight award type." });
  }

  try {
    const affectedRows = await deleteById("spotlight_awards", "honor_type", parsed.data);
    res.json({ ok: true, affectedRows, message: "Spotlight award delete request completed." });
  } catch (error) {
    mapDatabaseError(error);
  }
}));

app.post("/api/teams", asyncHandler(async (req, res) => {
  if (!requireAdmin(req, res)) return;

  const parsed = TeamSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid team details.", details: parsed.error.flatten() });
  }

  try {
    await upsertTeam(parsed.data);
    res.status(201).json({ ok: true, mode: "mysql" });
  } catch (error) {
    if (!isDatabaseUnavailable(error)) throw error;
    rememberDemoMode(error);
    insertFallbackTeam(parsed.data);
    res.status(201).json({ ok: true, mode: "in-memory" });
  }
}));

app.delete("/api/teams/:team_number", asyncHandler(async (req, res) => {
  if (!requireAdmin(req, res)) return;

  const teamNumber = Number(req.params.team_number);
  if (!Number.isInteger(teamNumber)) return res.status(400).json({ error: "Invalid team_number" });

  try {
    const result = await query("DELETE FROM teams WHERE team_number = ?", [teamNumber]);
    res.json({ ok: true, affectedRows: result.affectedRows ?? 0, mode: "mysql" });
  } catch (error) {
    if (!isDatabaseUnavailable(error)) throw error;
    rememberDemoMode(error);
    const result = deleteFallbackTeam(teamNumber);
    res.json({ ok: true, affectedRows: result.affectedRows, mode: "in-memory" });
  }
}));

app.use("/api", (req, res) => {
  res.status(404).json({
    error: "API route not found. Restart the server so it loads the latest backend code."
  });
});

app.get("/news", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "news.html"));
});

app.get("*", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || "Internal server error" });
});

const server = app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`Port ${port} is already in use. Set PORT in your .env to a free port and try again.`);
    process.exitCode = 1;
    return;
  }

  console.error("Failed to start server:", error);
  process.exitCode = 1;
});
