# ISU Football Tournament

## Prerequisites
- Node.js installed
- MySQL Server running

## Role scenarios
- Scenario 1: Players log in from the entry page with `player name + player number` as the username, and `player number` as the code.
- Scenario 2: Organizers log in from the entry page with one of these usernames: `abraham`, `abubakar`, `nanaknawme`, `muzakir`, `joy`, `bas`. The password format is `name + 123`.

## Configure the database
Copy [.env.example](.env.example) to `backend/.env` or `.env`, then set your real MySQL password:

```env
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=root
DB_PASSWORD=YOUR_PASSWORD
DB_NAME=football_db
PORT=5000
GEMINI_API_KEY=YOUR_GEMINI_API_KEY
GEMINI_MODEL=gemini-2.5-flash
```

## Install dependencies
At the project root:

```powershell
npm install
```

If PowerShell blocks `npm`, use:

```powershell
npm.cmd install
```

## Create the database
From the project root:

```powershell
.\setup-db.cmd
```

This creates a clean `football_db` database with empty tables and views so organizers can add the tournament data from the website.
On managed MySQL hosts, the script can also run against an existing database when the user does not have permission to create databases.

## Run the project
From the project root:

```powershell
.\run.cmd
```

Then open:
- Frontend: `http://localhost:5000`
- API health check: `http://localhost:5000/api/health`
- Teams API: `http://localhost:5000/api/teams`

## Optional npm commands
If you prefer package scripts:

```powershell
npm.cmd run setup-db
npm.cmd run dev
```

## Public hosting
Recommended free path: Render for the web service + Aiven MySQL for the database.

The app now supports:

- local `DB_*` variables
- hosted `MYSQL*` variables
- `DATABASE_URL`
- optional hosted SSL variables for managed MySQL providers

Use:

- [render.yaml](render.yaml) for the Render web service blueprint
- [RENDER_AIVEN_DEPLOY.md](RENDER_AIVEN_DEPLOY.md) for the full free-hosting walkthrough

Legacy paid Railway setup is still documented in [RAILWAY_DEPLOY.md](RAILWAY_DEPLOY.md).

## Notes
- If `/api/health` shows `mode: "in-memory"`, the app is running but MySQL credentials are still wrong or the DB was not set up yet.
- Player login format: username = player name + player number, code = player number.
- Organizer usernames: `abraham`, `abubakar`, `nanaknawme`, `muzakir`, `joy`, `bas`
- Organizer password format: `name + 123`
- If `GEMINI_API_KEY` is not set, the chat box falls back to the local tournament answer engine.
- If port `5000` is busy, change `PORT` in [backend/.env](backend/.env).
- For a managed MySQL host that requires TLS, set `DB_SSL=true`. If you do not have a CA cert ready yet, you can start with `DB_SSL_REJECT_UNAUTHORIZED=false` and tighten it later.
