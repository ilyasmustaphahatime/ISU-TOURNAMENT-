-- Production-safe update for Best Goalkeeper and Clean Sheets
-- Run this on an existing database if you need the schema change without a full rebuild.

USE football_db;

ALTER TABLE stats
ADD COLUMN IF NOT EXISTS clean_sheets INT DEFAULT 0 AFTER red_cards;

DROP VIEW IF EXISTS top_clean_sheets;
CREATE VIEW top_clean_sheets AS
SELECT
    p.player_number,
    p.player_name,
    p.position,
    t.team_name,
    COALESCE(SUM(s.clean_sheets), 0) AS total_clean_sheets
FROM players p
JOIN teams t ON p.player_team = t.team_number
LEFT JOIN stats s ON p.player_id = s.player_id
WHERE LOWER(p.position) LIKE '%keeper%' OR LOWER(p.position) = 'gk'
GROUP BY p.player_id, p.player_number, p.player_name, p.position, t.team_name
HAVING COALESCE(SUM(s.clean_sheets), 0) > 0
ORDER BY total_clean_sheets DESC, p.player_name ASC;
