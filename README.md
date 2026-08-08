# Wisdom Call Campaign

Standalone call-campaign app extracted from the Tharbiya registration project. Mentors log in and see the people assigned to them, dial via tap-to-call, record a call status (6 Malayalam options) with an optional response note, and send/copy WhatsApp messages. A report page shows completion percentage and who is left. All data lives in a Google Sheet — no database.

- **Frontend:** React (CRA), mobile-first UI → `frontend/`
- **Backend:** Express + Google Sheets API → `backend/`
- **Production:** `https://calls.wisdommlpe.site` (Docker + Traefik, deployed by GitHub Actions)

## Google Sheet setup (required before first run)

1. Create a new Google Sheet and note its ID (from the URL).
2. Share it as **Editor** with the service-account email (the `GOOGLE_AUTH_EMAIL` value).
3. Data tab (name it whatever you like and set `SHEET_TAB` in `.env`; default `Sheet1`) with this header row:

   | A | B | C | D | E | F | G |
   |---|---|---|---|---|---|---|
   | Zone | Unit | Name | Mobile Number | Call status | Call response | Mentor |

   - People from **row 2** down: fill Zone, Unit, Name, Mobile Number, and Mentor. Leave E/F blank — the app writes the call status to **E** and the free-text response to **F**.
   - **Mentor** (G) must exactly match a username in the `admin` tab. A mentor who logs in sees only the rows assigned to them; the master admin (env credentials) sees everyone.
   - Cell **`S1`** holds the default WhatsApp message (can be set from the app), **`T1`** an optional image URL.
4. Create a tab named **`admin`** with headers `username` (A1) / `password` (B1) / `name` (C1, optional), and one row per mentor from row 2 (plain text). The **name** column is shown in the app header and reports instead of the raw username; if left blank, the username is shown.
5. (Optional) Create a tab named **`super_admin`** with headers `Mobile Number` (A1) / `Name` (B1, optional), one row per overseer. Anyone whose number is listed here logs in (mobile number as both username and password, same as mentors) with **read-only, org-wide access**: they land straight on the Report page, see every zone/unit/mentor (no scoping), get the zone/unit filters and per-mentor WhatsApp reminder button, but cannot edit any call status.

## Backend

```bash
cd backend
cp .env.example .env   # fill in values
npm install
node app.js            # runs on port 5001
```

`.env` values: `SPREADSHEET_ID` (the new sheet), `SHEET_TAB` (data tab name, default `Sheet1`), `GOOGLE_AUTH_EMAIL`, `GOOGLE_AUTH_PRIVATE_KEY`, `JWT_SECRET` (fresh value — don't reuse another app's), `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `ADMIN_NAME` (optional, defaults to `Admin`).

## Frontend

```bash
cd frontend
npm install
npm start              # dev server on port 3000, API at http://localhost:5001
```

Production builds bake `REACT_APP_API_URL` at build time (set to `https://calls.wisdommlpe.site` in CI).

## Deployment

Push to `main` → `.github/workflows/deploy.yml` builds and pushes `ghcr.io/fahizkp/wisdom-call-campaign-{frontend,backend}:latest`, then SSHes to the server and runs `docker compose up -d` in `/srv/apps/wisdom-call-campaign`.

One-time setup:

1. **DNS:** A record for `calls.wisdommlpe.site` → the server IP (Traefik issues the TLS cert automatically).
2. **GitHub Actions secrets** on this repo: `SSH_HOST`, `SSH_USER`, `SSH_PRIVATE_KEY`, `SSH_PORT`, `GHCR_TOKEN`.
3. **Server:** create `/srv/apps/wisdom-call-campaign/.env` with the backend `.env` values above (the workflow ships only `docker-compose.yml`).
