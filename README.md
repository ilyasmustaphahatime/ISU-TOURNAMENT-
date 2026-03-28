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
Recommended path: Railway with a Railway MySQL service.

1. Push this project to GitHub.
2. Create a Railway project.
3. Add a MySQL database service in the same Railway project.
4. Add a web service from this GitHub repo.
5. In the web service, set `NODE_ENV=production`.
6. In the web service, connect the database variables from the MySQL service so the app receives `MYSQLHOST`, `MYSQLPORT`, `MYSQLUSER`, `MYSQLPASSWORD`, and `MYSQLDATABASE`.
7. If you want the website chat to use Gemini in production, also set `GEMINI_API_KEY` and optionally `GEMINI_MODEL` in the Railway web service.
8. Railway will read [railway.json](railway.json), so it will:
   - start with `npm start`
   - run `node backend/setup-db.js` before deploy
   - use `/api/health` as the health check
9. Open the web service `Settings` -> `Networking`, then click `Generate Domain`.
10. Open the generated public URL and test `/api/health`.

The app now supports both local `DB_*` variables and hosted `MYSQL*` variables.
The included [railway.json](railway.json) is set up for a single web service deployment.

## Notes
- If `/api/health` shows `mode: "in-memory"`, the app is running but MySQL credentials are still wrong or the DB was not set up yet.
- Player login format: username = player name + player number, code = player number.
- Organizer usernames: `abraham`, `abubakar`, `nanaknawme`, `muzakir`, `joy`, `bas`
- Organizer password format: `name + 123`
- If `GEMINI_API_KEY` is not set, the chat box falls back to the local tournament answer engine.
- If port `5000` is busy, change `PORT` in [backend/.env](backend/.env).
- For a public deploy, generate the Railway domain after the service is healthy so players can open the site from that URL.

