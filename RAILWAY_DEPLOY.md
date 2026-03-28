# Railway Deploy

This project is already prepared for Railway with:

- `railway.json`
- `npm start`
- `node backend/setup-db.js` as the pre-deploy command
- `/api/health` as the healthcheck
- support for `MYSQLHOST`, `MYSQLPORT`, `MYSQLUSER`, `MYSQLPASSWORD`, and `MYSQLDATABASE`

## 1. Push this project to GitHub

Create an empty GitHub repository, then run these commands from the project root:

```powershell
& "C:\Program Files\Git\cmd\git.exe" add .
& "C:\Program Files\Git\cmd\git.exe" commit -m "Prepare Railway deployment"
& "C:\Program Files\Git\cmd\git.exe" branch -M main
& "C:\Program Files\Git\cmd\git.exe" remote set-url origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
& "C:\Program Files\Git\cmd\git.exe" push -u origin main
```

## 2. Create the Railway project

1. Open Railway.
2. Create a new project.
3. Choose `Deploy from GitHub repo`.
4. Select your repository.

## 3. Add MySQL

1. In the same Railway project, add a `MySQL` service.
2. Wait until the database service is ready.

## 4. Set the web service variables

In the web service `Variables` tab, add:

```text
NODE_ENV=production
MYSQLHOST=${{MySQL.MYSQLHOST}}
MYSQLPORT=${{MySQL.MYSQLPORT}}
MYSQLUSER=${{MySQL.MYSQLUSER}}
MYSQLPASSWORD=${{MySQL.MYSQLPASSWORD}}
MYSQLDATABASE=${{MySQL.MYSQLDATABASE}}
GEMINI_API_KEY=YOUR_GEMINI_API_KEY
GEMINI_MODEL=gemini-2.5-flash
```

If your MySQL service has a different name, replace `MySQL` with that exact Railway service name.

## 5. Deploy

Railway will use the config in `railway.json`:

- builder: `RAILPACK`
- start command: `npm start`
- pre-deploy command: `node backend/setup-db.js`
- healthcheck path: `/api/health`

## 6. Make it public

1. Open the web service in Railway.
2. Go to `Settings` -> `Networking`.
3. Click `Generate Domain`.

## 7. Test the public site

Open:

- `https://YOUR-DOMAIN/api/health`
- `https://YOUR-DOMAIN`
- `https://YOUR-DOMAIN/news`

Expected health result:

```json
{"ok":true,"db":"connected","mode":"mysql"}
```

## Important

- The website cannot stay online from your laptop when the laptop is off.
- For 24/7 access, Railway (or another cloud host) is required.
- The current Git remote in this repo is still a placeholder and must be changed to your real GitHub repo URL.
