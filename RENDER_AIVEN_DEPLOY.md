# Free Hosting Guide: Render + Aiven MySQL

This project can be hosted again without Railway by using:

- Render for the Node/Express web service
- Aiven for the MySQL database

This keeps the current backend architecture, so we do not need to rewrite the app away from MySQL.

## What changed in the code

The app now supports:

- normal `DB_*` variables
- hosted MySQL URLs through `DATABASE_URL`
- optional hosted SSL variables for managed databases
- Render Blueprint prompts for the required hosted MySQL credentials

The shared database config lives in `backend/db.js`.

## 1. Create the free Aiven MySQL service

1. Create an Aiven account.
2. Create a free MySQL service.
3. Wait for the service to become ready.
4. Copy these connection details from Aiven:
   - host
   - port
   - username
   - password
5. Create or use the database name `football_db`.

## 2. Load the schema into Aiven

From the project root, set the Aiven variables in PowerShell:

```powershell
$env:DB_HOST="YOUR_AIVEN_HOST"
$env:DB_PORT="YOUR_AIVEN_PORT"
$env:DB_USER="YOUR_AIVEN_USER"
$env:DB_PASSWORD="YOUR_AIVEN_PASSWORD"
$env:DB_NAME="football_db"
$env:DB_SSL="true"
$env:DB_SSL_REJECT_UNAUTHORIZED="false"
npm.cmd run setup-db
```

That creates the tables and views in the hosted MySQL database. The setup script works with managed MySQL accounts that cannot create databases, as long as the `DB_NAME` database already exists.

## 3. Restore the 7-team tournament data

If you want the old tournament data online again, import:

- `database/backups/football_db_restore_7_teams_2026-03-29.sql`

Use MySQL Workbench or the MySQL client against the Aiven MySQL service.

If the file uses `USE football_db;`, keep it as-is when your Aiven database is also named `football_db`.

## 4. Create the free Render web service

1. Push this repo to GitHub.
2. Create a Render account.
3. Click `New +` -> `Web Service`.
4. Connect your GitHub repo.
5. Render should detect the service settings from `render.yaml`.
6. When Render asks for Blueprint secret values, enter the Aiven `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, and `DB_NAME`.

If Render asks manually, use:

- Build Command: `npm ci`
- Pre-Deploy Command: `npm run setup-db`
- Start Command: `npm start`
- Health Check Path: `/api/health`

## 5. Add the Render environment variables

If you create the service from `render.yaml`, Render prompts for the required database values during setup. If you create the service manually, add these in the Render service dashboard:

```text
DB_HOST=YOUR_AIVEN_HOST
DB_PORT=YOUR_AIVEN_PORT
DB_USER=YOUR_AIVEN_USER
DB_PASSWORD=YOUR_AIVEN_PASSWORD
DB_NAME=football_db
DB_SSL=true
DB_SSL_REJECT_UNAUTHORIZED=false
NODE_ENV=production
GEMINI_MODEL=gemini-2.5-flash
GEMINI_API_KEY=YOUR_GEMINI_API_KEY
```

Notes:

- `DB_SSL=true` enables TLS for the managed MySQL service.
- `DB_SSL_REJECT_UNAUTHORIZED=false` is the quickest hosted setup for this project.
- `GEMINI_API_KEY` is optional. The site still runs without it, but the chat feature uses the local fallback answer engine.
- If you want stricter TLS validation later, you can also add:
  - `DB_SSL_CA_PEM`
  - or `DB_SSL_CA_BASE64`

## 6. Deploy

After the variables are saved:

1. Trigger the first deploy in Render.
2. Wait for the service to become healthy.
3. Open:
   - `/api/health`
   - `/`
   - `/news`

If `/api/health` returns success, the site is live again.

## 7. Future updates

After hosting is live:

- content changes go through the organizer panel
- code/design changes go through:

```powershell
git add .
git commit -m "Your update message"
git push
```

Render will redeploy the app from GitHub.

## 8. Recommended order after the site is live

1. Restore teams and players.
2. Verify organizer login.
3. Verify player login.
4. Add or restore fixtures.
5. Add stats and weekly awards.

## Troubleshooting

### Render deploy succeeds but `/api/health` fails

Check:

- `DB_HOST`
- `DB_PORT`
- `DB_USER`
- `DB_PASSWORD`
- `DB_NAME`
- `DB_SSL`

### Render starts but the data is empty

That means the web service is connected to MySQL, but the old roster was not restored yet. Import the SQL backup file.

### The app cannot connect to Aiven

Start with:

```text
DB_SSL=true
DB_SSL_REJECT_UNAUTHORIZED=false
```

Then tighten TLS later if you want certificate validation.
