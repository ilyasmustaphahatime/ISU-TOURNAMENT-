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

const PlayerSchema = z.object({
  player_number: z.coerce.number().int().positive(),
  player_name: z.string().trim().min(1).max(100),
  position: z.string().trim().min(1).max(50),
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
  state: z.string().trim().min(1).max(50).optional().default("played"),
  goals: z.coerce.number().int().nonnegative(),
  assists: z.coerce.number().int().nonnegative(),
  yellow_cards: z.coerce.number().int().nonnegative(),
  red_cards: z.coerce.number().int().nonnegative()
});

const PlayerLoginSchema = z.object({
  username: z.string().trim().min(1).max(140),
  code: z.string().trim().regex(/^\d+$/)
});

const AdminLoginSchema = z.object({
  username: z.string().trim().min(1).max(100),
  password: z.string().min(1).max(200)
});

const app = express();
const port = Number(process.env.PORT) || 3000;
const PLAYER_SESSION_COOKIE = "player_session";
const ADMIN_SESSION_COOKIE = "admin_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 12;
const ORGANIZER_NAMES = ["abraham", "abubakar", "nanaknawme", "muzakir", "joy", "bas"];
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
  players: "SELECT player_number, player_name, position, player_team FROM players ORDER BY player_number ASC",
  team_members: "SELECT team_number, team_name, player_number, player_name, position FROM team_members_view ORDER BY team_number ASC, player_number ASC",
  team_of_season: "SELECT tos_id, team_number, team_name FROM team_of_the_season ORDER BY tos_id ASC",
  fixtures: "SELECT match_id, match_date, match_time, home_team, away_team, referee_name, home_goals, away_goals, status FROM fixtures_view ORDER BY match_date ASC, match_time ASC",
  stats: "SELECT stat_id, match_id, player_number, state, goals, assists, yellow_cards, red_cards FROM stats ORDER BY match_id ASC, player_number ASC",
  league_table: "SELECT team_number, team_name, P, W, D, L, GF, GA, GD, Pts FROM league_table",
  top_goals: "SELECT player_number, player_name, position, team_name, total_goals FROM top_goals WHERE total_goals > 0",
  top_assists: "SELECT player_number, player_name, position, team_name, total_assists FROM top_assists WHERE total_assists > 0",
  yellow_cards: "SELECT player_number, player_name, position, team_name, total_yellow_cards FROM yellow_cards WHERE total_yellow_cards > 0",
  red_cards: "SELECT player_number, player_name, position, team_name, total_red_cards FROM red_cards WHERE total_red_cards > 0"
};

let pool;
let demoModeReason = null;
const playerSessions = new Map();
const adminSessions = new Map();
const organizerAccounts = new Map(
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

function asyncHandler(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

function rememberDemoMode(error) {
  demoModeReason = String(error?.message || error || "Database unavailable");
}

function normalizeIdentifier(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function buildPlayerUsername(player) {
  return `${normalizeIdentifier(player.player_name)}${player.player_number}`;
}

function getOrganizerAccount(username) {
  return organizerAccounts.get(normalizeIdentifier(username)) || null;
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

async function getPlayerProfile(playerNumber) {
  const rows = await query(
    `
      SELECT
        p.player_number,
        p.player_name,
        p.position,
        p.player_team,
        t.team_name
      FROM players p
      JOIN teams t ON p.player_team = t.team_number
      WHERE p.player_number = ?
      LIMIT 1
    `,
    [playerNumber]
  );

  return rows[0] || null;
}

async function getAuthenticatedPlayer(req, res) {
  const session = getPlayerSession(req);
  if (!session) {
    res.status(401).json({ error: "Please log in as a player to see tournament updates." });
    return null;
  }

  const player = await getPlayerProfile(session.playerNumber);
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

async function upsertPlayer(player) {
  await query(
    `
      INSERT INTO players (player_number, player_name, position, player_team)
      VALUES (?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        player_name = VALUES(player_name),
        position = VALUES(position),
        player_team = VALUES(player_team)
    `,
    [player.player_number, player.player_name, player.position, player.player_team]
  );

  await query(
    `
      INSERT INTO team_members (team_number, player_number)
      VALUES (?, ?)
      ON DUPLICATE KEY UPDATE
        team_number = VALUES(team_number)
    `,
    [player.player_team, player.player_number]
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
  await query(
    `
      INSERT INTO stats (
        match_id,
        player_number,
        state,
        goals,
        assists,
        yellow_cards,
        red_cards
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        state = VALUES(state),
        goals = VALUES(goals),
        assists = VALUES(assists),
        yellow_cards = VALUES(yellow_cards),
        red_cards = VALUES(red_cards)
    `,
    [
      stat.match_id,
      stat.player_number,
      stat.state,
      stat.goals,
      stat.assists,
      stat.yellow_cards,
      stat.red_cards
    ]
  );
}

async function deleteStat(matchId, playerNumber) {
  const result = await query(
    "DELETE FROM stats WHERE match_id = ? AND player_number = ?",
    [matchId, playerNumber]
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

app.use(express.static(path.join(__dirname, "..", "public")));

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

app.post("/api/player/login", asyncHandler(async (req, res) => {
  const parsed = PlayerLoginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid login details.", details: parsed.error.flatten() });
  }

  const { username, code } = parsed.data;
  const playerNumber = Number(code);
  const player = await getPlayerProfile(playerNumber);

  if (!player) {
    return res.status(401).json({ error: "Player username or code is incorrect." });
  }

  const expectedUsername = buildPlayerUsername(player);
  if (normalizeIdentifier(username) !== expectedUsername || String(player.player_number) !== code) {
    return res.status(401).json({ error: "Player username or code is incorrect." });
  }

  const token = createSession(playerSessions, { playerNumber: player.player_number });
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

app.post(["/api/admin/teams", "/api/organizer/teams"], asyncHandler(async (req, res) => {
  if (!requireAdmin(req, res)) return;

  const parsed = TeamSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid team details.", details: parsed.error.flatten() });
  }

  try {
    await upsertTeam(parsed.data);
    res.json({ ok: true, message: "Team saved successfully." });
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

app.delete(["/api/admin/players/:player_number", "/api/organizer/players/:player_number"], asyncHandler(async (req, res) => {
  if (!requireAdmin(req, res)) return;

  const playerNumber = Number(req.params.player_number);
  if (!Number.isInteger(playerNumber)) {
    return res.status(400).json({ error: "Invalid player number." });
  }

  try {
    const affectedRows = await deleteById("players", "player_number", playerNumber);
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

app.delete(["/api/admin/stats/:match_id/:player_number", "/api/organizer/stats/:match_id/:player_number"], asyncHandler(async (req, res) => {
  if (!requireAdmin(req, res)) return;

  const matchId = Number(req.params.match_id);
  const playerNumber = Number(req.params.player_number);
  if (!Number.isInteger(matchId) || !Number.isInteger(playerNumber)) {
    return res.status(400).json({ error: "Invalid stat key." });
  }

  try {
    const affectedRows = await deleteStat(matchId, playerNumber);
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

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "index.html"));
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
