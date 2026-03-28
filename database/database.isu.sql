CREATE DATABASE IF NOT EXISTS football_db;
USE football_db;

-- =========================
-- teams
-- =========================
CREATE TABLE IF NOT EXISTS teams (
    team_number INT PRIMARY KEY,
    team_name VARCHAR(100) NOT NULL UNIQUE,
    captain_name VARCHAR(100)
);

-- =========================
-- team_of_the_season
-- =========================
CREATE TABLE IF NOT EXISTS team_of_the_season (
    tos_id INT PRIMARY KEY,
    team_number INT NOT NULL,
    team_name VARCHAR(100) NOT NULL,

    CONSTRAINT fk_tos_team
        FOREIGN KEY (team_number)
        REFERENCES teams(team_number)
        ON UPDATE CASCADE
        ON DELETE CASCADE
);

-- =========================
-- players
-- =========================
CREATE TABLE IF NOT EXISTS players (
    player_id INT AUTO_INCREMENT PRIMARY KEY,
    player_number INT NOT NULL,
    player_name VARCHAR(100) NOT NULL,
    position VARCHAR(50) NOT NULL,
    player_team INT NOT NULL,

    CONSTRAINT uq_player_team_number UNIQUE (player_team, player_number),

    CONSTRAINT fk_player_team
        FOREIGN KEY (player_team)
        REFERENCES teams(team_number)
        ON UPDATE CASCADE
        ON DELETE CASCADE
);

-- =========================
-- team_members
-- =========================
CREATE TABLE IF NOT EXISTS team_members (
    team_number INT NOT NULL,
    player_id INT NOT NULL,

    PRIMARY KEY (team_number, player_id),
    UNIQUE (player_id),

    CONSTRAINT fk_team_members_team
        FOREIGN KEY (team_number)
        REFERENCES teams(team_number)
        ON UPDATE CASCADE
        ON DELETE CASCADE,

    CONSTRAINT fk_team_members_player
        FOREIGN KEY (player_id)
        REFERENCES players(player_id)
        ON UPDATE CASCADE
        ON DELETE CASCADE
);

-- =========================
-- referees
-- =========================
CREATE TABLE IF NOT EXISTS referees (
    referee_id INT PRIMARY KEY,
    referee_name VARCHAR(100) NOT NULL
);

-- =========================
-- matches
-- =========================
CREATE TABLE IF NOT EXISTS matches (
    match_id INT PRIMARY KEY,
    match_date DATE NOT NULL,
    match_time TIME NOT NULL,
    home_team INT NOT NULL,
    away_team INT NOT NULL,
    referee_id INT,
    home_goals INT DEFAULT 0,
    away_goals INT DEFAULT 0,
    status ENUM('scheduled', 'played', 'postponed', 'cancelled') DEFAULT 'scheduled',

    CONSTRAINT fk_home_team
        FOREIGN KEY (home_team)
        REFERENCES teams(team_number)
        ON UPDATE CASCADE
        ON DELETE CASCADE,

    CONSTRAINT fk_away_team
        FOREIGN KEY (away_team)
        REFERENCES teams(team_number)
        ON UPDATE CASCADE
        ON DELETE CASCADE,

    CONSTRAINT fk_match_referee
        FOREIGN KEY (referee_id)
        REFERENCES referees(referee_id)
        ON UPDATE CASCADE
        ON DELETE SET NULL
);

-- =========================
-- stats
-- =========================
CREATE TABLE IF NOT EXISTS stats (
    stat_id INT AUTO_INCREMENT PRIMARY KEY,
    match_id INT NOT NULL,
    player_id INT NOT NULL,
    state VARCHAR(50),
    goals INT DEFAULT 0,
    assists INT DEFAULT 0,
    yellow_cards INT DEFAULT 0,
    red_cards INT DEFAULT 0,

    CONSTRAINT fk_stats_match
        FOREIGN KEY (match_id)
        REFERENCES matches(match_id)
        ON UPDATE CASCADE
        ON DELETE CASCADE,

    CONSTRAINT fk_stats_player
        FOREIGN KEY (player_id)
        REFERENCES players(player_id)
        ON UPDATE CASCADE
        ON DELETE CASCADE,

    CONSTRAINT uq_match_player UNIQUE (match_id, player_id)
);

-- =========================
-- weekly_news
-- =========================
CREATE TABLE IF NOT EXISTS weekly_news (
    news_id INT AUTO_INCREMENT PRIMARY KEY,
    week_label VARCHAR(100) NOT NULL,
    headline VARCHAR(180) NOT NULL,
    summary VARCHAR(320) NOT NULL,
    body TEXT NOT NULL,
    published_on DATE NOT NULL,
    featured_team_number INT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT fk_weekly_news_team
        FOREIGN KEY (featured_team_number)
        REFERENCES teams(team_number)
        ON UPDATE CASCADE
        ON DELETE SET NULL
);

-- =========================
-- spotlight_awards
-- =========================
CREATE TABLE IF NOT EXISTS spotlight_awards (
    honor_type VARCHAR(50) PRIMARY KEY,
    player_id INT NULL,
    team_number INT NULL,
    title VARCHAR(120) NOT NULL,
    description VARCHAR(500) NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT fk_spotlight_player
        FOREIGN KEY (player_id)
        REFERENCES players(player_id)
        ON UPDATE CASCADE
        ON DELETE SET NULL,

    CONSTRAINT fk_spotlight_team
        FOREIGN KEY (team_number)
        REFERENCES teams(team_number)
        ON UPDATE CASCADE
        ON DELETE SET NULL
);

ALTER TABLE spotlight_awards
    MODIFY honor_type VARCHAR(50) NOT NULL;

DELETE FROM spotlight_awards
WHERE honor_type = 'player_of_month';

UPDATE spotlight_awards
SET honor_type = 'best_player_of_week'
WHERE honor_type = 'player_of_week';

UPDATE spotlight_awards
SET honor_type = 'best_team_of_month'
WHERE honor_type = 'team_of_month';

-- =========================
-- fixtures view
-- =========================
DROP VIEW IF EXISTS fixtures_view;
CREATE VIEW fixtures_view AS
SELECT
    m.match_id,
    m.match_date,
    m.match_time,
    th.team_name AS home_team,
    ta.team_name AS away_team,
    r.referee_name,
    m.home_goals,
    m.away_goals,
    m.status
FROM matches m
JOIN teams th ON m.home_team = th.team_number
JOIN teams ta ON m.away_team = ta.team_number
LEFT JOIN referees r ON m.referee_id = r.referee_id;

-- =========================
-- league table view
-- =========================
DROP VIEW IF EXISTS league_table;
CREATE VIEW league_table AS
SELECT
    t.team_number,
    t.team_name,
    COUNT(x.match_id) AS P,
    COALESCE(SUM(CASE WHEN x.goals_for > x.goals_against THEN 1 ELSE 0 END), 0) AS W,
    COALESCE(SUM(CASE WHEN x.goals_for = x.goals_against THEN 1 ELSE 0 END), 0) AS D,
    COALESCE(SUM(CASE WHEN x.goals_for < x.goals_against THEN 1 ELSE 0 END), 0) AS L,
    COALESCE(SUM(x.goals_for), 0) AS GF,
    COALESCE(SUM(x.goals_against), 0) AS GA,
    COALESCE(SUM(x.goals_for), 0) - COALESCE(SUM(x.goals_against), 0) AS GD,
    COALESCE(SUM(
        CASE
            WHEN x.goals_for > x.goals_against THEN 3
            WHEN x.goals_for = x.goals_against THEN 1
            ELSE 0
        END
    ), 0) AS Pts
FROM teams t
LEFT JOIN (
    SELECT
        match_id,
        home_team AS team_number,
        home_goals AS goals_for,
        away_goals AS goals_against
    FROM matches
    WHERE status = 'played'

    UNION ALL

    SELECT
        match_id,
        away_team AS team_number,
        away_goals AS goals_for,
        home_goals AS goals_against
    FROM matches
    WHERE status = 'played'
) x ON t.team_number = x.team_number
GROUP BY t.team_number, t.team_name
ORDER BY Pts DESC, GD DESC, GF DESC, team_name ASC;

-- =========================
-- top_goals
-- =========================
DROP VIEW IF EXISTS top_goals;
CREATE VIEW top_goals AS
SELECT
    p.player_number,
    p.player_name,
    p.position,
    t.team_name,
    COALESCE(SUM(s.goals), 0) AS total_goals
FROM players p
JOIN teams t ON p.player_team = t.team_number
LEFT JOIN stats s ON p.player_id = s.player_id
GROUP BY p.player_id, p.player_number, p.player_name, p.position, t.team_name
HAVING COALESCE(SUM(s.goals), 0) > 0
ORDER BY total_goals DESC, p.player_name ASC;

-- =========================
-- top_assists
-- =========================
DROP VIEW IF EXISTS top_assists;
CREATE VIEW top_assists AS
SELECT
    p.player_number,
    p.player_name,
    p.position,
    t.team_name,
    COALESCE(SUM(s.assists), 0) AS total_assists
FROM players p
JOIN teams t ON p.player_team = t.team_number
LEFT JOIN stats s ON p.player_id = s.player_id
GROUP BY p.player_id, p.player_number, p.player_name, p.position, t.team_name
HAVING COALESCE(SUM(s.assists), 0) > 0
ORDER BY total_assists DESC, p.player_name ASC;

-- =========================
-- yellow_cards
-- =========================
DROP VIEW IF EXISTS yellow_cards;
CREATE VIEW yellow_cards AS
SELECT
    p.player_number,
    p.player_name,
    p.position,
    t.team_name,
    COALESCE(SUM(s.yellow_cards), 0) AS total_yellow_cards
FROM players p
JOIN teams t ON p.player_team = t.team_number
LEFT JOIN stats s ON p.player_id = s.player_id
GROUP BY p.player_id, p.player_number, p.player_name, p.position, t.team_name
HAVING COALESCE(SUM(s.yellow_cards), 0) > 0
ORDER BY total_yellow_cards DESC, p.player_name ASC;

-- =========================
-- red_cards
-- =========================
DROP VIEW IF EXISTS red_cards;
CREATE VIEW red_cards AS
SELECT
    p.player_number,
    p.player_name,
    p.position,
    t.team_name,
    COALESCE(SUM(s.red_cards), 0) AS total_red_cards
FROM players p
JOIN teams t ON p.player_team = t.team_number
LEFT JOIN stats s ON p.player_id = s.player_id
GROUP BY p.player_id, p.player_number, p.player_name, p.position, t.team_name
HAVING COALESCE(SUM(s.red_cards), 0) > 0
ORDER BY total_red_cards DESC, p.player_name ASC;

-- =========================
-- team_members_view
-- =========================
DROP VIEW IF EXISTS team_members_view;
CREATE VIEW team_members_view AS
SELECT
    t.team_number,
    t.team_name,
    p.player_number,
    p.player_name,
    p.position
FROM team_members tm
JOIN teams t
    ON tm.team_number = t.team_number
JOIN players p
    ON tm.player_id = p.player_id
ORDER BY t.team_name, p.player_number;
