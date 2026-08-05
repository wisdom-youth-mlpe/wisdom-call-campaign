# Wisdom Call Campaign

Standalone call-campaign app extracted from the Tharbiya registration project. Callers log in, work through a member list, dial via tap-to-call, record a call status (6 Malayalam options) with optional remarks, and send/copy WhatsApp messages. All data lives in a Google Sheet — no database.

- **Frontend:** React (CRA), mobile-first UI → `frontend/`
- **Backend:** Express + Google Sheets API → `backend/`
- **Production:** `https://calls.wisdommlpe.site` (Docker + Traefik, deployed by GitHub Actions)

## Google Sheet setup (required before first run)

1. Create a new Google Sheet and note its ID (from the URL).
2. Share it as **Editor** with the service-account email (the `GOOGLE_AUTH_EMAIL` value).
3. Create a tab named **`ExecutiveList`** (exact name, case-sensitive) with this header row:

   | A | B | C | D | E | F | G | H | I | J | K | L |
   |---|---|---|---|---|---|---|---|---|---|---|---|
   | Zone | Name | Mobile | Participated | Status | Role | Executive | AltMobile | CallStatus | CallRemarks | CheckIn | CheckInTime |

   - Paste the people list from **row 2** down, filling **A (Zone), B (Name), C (Mobile)**. H (AltMobile) is used as a fallback when C is empty. Leave D–G and I–L blank.
   - Do **not** put `Leave` in column E — those rows are hidden from the app.
   - Cell **`S1`** holds the default WhatsApp message (can be set from the app), **`T1`** an optional image URL.
   - The app writes call responses to **I (status)** and **J (remarks)**.
4. Create a tab named **`admin`** with headers `username` (A1) / `password` (B1), and caller accounts from row 2 (plain text).

## Backend

```bash
cd backend
cp .env.example .env   # fill in values
npm install
node app.js            # runs on port 5001
```

`.env` values: `SPREADSHEET_ID` (the new sheet), `GOOGLE_AUTH_EMAIL`, `GOOGLE_AUTH_PRIVATE_KEY`, `JWT_SECRET` (fresh value — don't reuse another app's), `ADMIN_USERNAME`, `ADMIN_PASSWORD`.

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
