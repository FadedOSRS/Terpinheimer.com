# Terpinheimer — clan site

Static site for **Terpinheimer** (OSRS): home page pulls **Wise Old Man** group stats; member pages use **RuneProfile** (`#/hiscores/Player Name`).

## Requirements

- **Node.js 18+** (uses built-in `fetch`)

## Run locally

```bash
npm install
npm start
```

Open **http://localhost:5173** (or the port printed in the terminal).

**Important:** Open the site through this dev server, not as a `file://` page. The server proxies:

- `/rp-api/*` → `https://api.runeprofile.com` (avoids CORS on member profiles)
- `/rs-item/<id>` → item names (Jagex catalogue, then OSRSBox, then OSRS Wiki)

If port **5173** is busy:

```bash
set PORT=8080
npm start
```

(On PowerShell: `$env:PORT=8080; npm start`.)

## Upload to GitHub

### 1. Install Git (if `git` is not recognized)

- Download **Git for Windows**: [git-scm.com/download/win](https://git-scm.com/download/win)  
- Run the installer; keep the default that adds Git to your **PATH**.  
- **Close and reopen** PowerShell / Cursor’s terminal, then check:

```powershell
git --version
```

### 2. Create the repository on GitHub

1. Log in at [github.com](https://github.com) → **+** → **New repository**.  
2. Choose a name (e.g. `terpinheimer-site`).  
3. Leave it **empty**: **no** README, **no** .gitignore, **no** license (you already have those locally).  
4. Click **Create repository**.  
5. Copy the HTTPS URL GitHub shows (e.g. `https://github.com/YOUR_USER/terpinheimer-site.git`).

### 3. Push this project from your PC

In **PowerShell** (folder = this project, e.g. `Website 3.0`):

```powershell
cd "C:\Users\zackt\OneDrive\Desktop\Cursor\Website 3.0"
git init
git add -A
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USER/YOUR_REPO.git
git push -u origin main
```

Replace `YOUR_USER/YOUR_REPO` with your real GitHub username and repo name.

GitHub may ask you to sign in: use a **Personal Access Token** as the password (not your GitHub account password). Create one under **GitHub → Settings → Developer settings → Personal access tokens**.

### Easier option: GitHub Desktop

1. Install [GitHub Desktop](https://desktop.github.com/).  
2. **File → Add local repository** → choose the `Website 3.0` folder. If it says “not a git repo”, choose **create a repository** there.  
3. **Publish repository** on GitHub (uncheck “Keep this code private” if you want it public).

## Deploy (e.g. Render / Railway)

1. Push this repo to GitHub.
2. Create a **Web Service** with **Node**.
3. **Build:** `npm install`
4. **Start:** `npm start`
5. Let the host set **`PORT`** (already read in `dev-server.mjs`).

No build step is required beyond installing dependencies. If you use **Render**, you can connect the repo and use the included `render.yaml` (optional auto-config).

## Project layout

| Path | Purpose |
|------|---------|
| `index.html` | Page shell |
| `css/styles.css` | Styles |
| `js/app.js` | Routing, WOM + RuneProfile + UI |
| `dev-server.mjs` | Static files + `/rp-api` + `/rs-item` |
| `assets/terpinheimer-logo.png` | Brand images |

## Configuration (in code)

- **Wise Old Man group:** `WOM_GROUP_ID` in `js/app.js`
- **RuneProfile API:** requested via `/rp-api` when same-origin

After changing Discord links, update the `https://discord.gg/` placeholders in `index.html` (see `data-discord-link`).
