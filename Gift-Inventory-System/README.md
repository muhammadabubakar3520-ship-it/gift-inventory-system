# Gift Inventory & Shop Sales Management — full-stack (React + Node.js + MongoDB Atlas)

The same app as the last HTML file (same screens, same design, same rules), rebuilt as a real web application:

- **Frontend:** React 19 + Vite + React Router (`frontend/`). Deploy on **Vercel**.
- **Backend:** Node.js + Express REST API, JWT sign-in, bcrypt password hashes, Socket.IO live sync (`backend/`). Deploy on **Render**.
- **Database:** **MongoDB Atlas** with Mongoose. It is the **only** place where data is kept: shops, promoters, gifts, stock, sales, proof photos, audit log.

Nothing is stored in the browser (no localStorage / IndexedDB data). The browser keeps only the sign-in token of that device.

```
Computer / phone A ─▶ React frontend (Vercel) ─▶ Express API (Render) ─▶ MongoDB Atlas
                                                       ▲      │ Socket.IO "data changed"
Computer / phone B ─▶ React frontend (Vercel) ─────────┘      ▼ (other screens reload)
```

- A saves something → the API writes it to MongoDB → every other open screen gets a Socket.IO event within about 1 second and reloads that data from the API.
- If the live connection is blocked (some networks), screens check every 20 seconds instead. The top bar shows **Live** or **Auto-refresh**.

---

## 1. What is in the project

```
Gift-Inventory-System/
├── frontend/                 React + Vite app (admin dashboard /admin, promoter app /app)
│   ├── public/               icons, manifest, vendor libraries (Chart.js, jsPDF, SheetJS, jsQR)
│   ├── src/
│   │   ├── components/       DataTable, Modal, Icon, Toasts, BusyButton, admin/* (forms, filter bar, charts…)
│   │   ├── pages/            LoginPage, admin/* (Dashboard, Shops, Gifts, Inventory, Sales, Reports…), promoter/*
│   │   ├── layouts/          AdminLayout (sidebar, top bar)
│   │   ├── services/         api.js (the ONE place that talks to the backend, uses VITE_API_URL)
│   │   ├── hooks/            useApi, usePaged
│   │   ├── context/          AuthContext, SyncContext (Socket.IO), LookupsContext, PageMetaContext
│   │   ├── utils/            formatting, Excel, PDF, QR scanner, shared business rules (analytics, import rules…)
│   │   ├── assets/css/       the original stylesheets (unchanged design)
│   │   ├── App.jsx           routes
│   │   └── main.jsx
│   ├── package.json, vite.config.js, vercel.json, .env.example
├── backend/
│   ├── src/
│   │   ├── config/           env.js (settings from environment variables), db.js (Mongoose connection)
│   │   ├── models/           Mongoose schemas: User, City, Market, Shop, Gift, ShopInventory, Transaction, …
│   │   ├── controllers/      business rules + endpoints (auth, shops, gifts, inventory, transactions, reports, …)
│   │   ├── routes/           mounts every endpoint on Express with authentication + role checks
│   │   ├── middleware/       JWT auth, role check, input validation, rate limits, errors
│   │   ├── services/         engine.js (core rules), store.js (MongoDB read/write), seed.js, socket.js
│   │   ├── shared/           business rules shared with the frontend (analytics, import rules, reports, DOS)
│   │   ├── seed/             starting data (promoters with fixed logins as HASHES only, shops, gifts, models, brands)
│   │   ├── app.js            Express app (Helmet, CORS, JSON, routes)
│   │   └── server.js         start-up
│   ├── test/                 automated tests (real MongoDB)
│   ├── package.json, .env.example
├── render.yaml               Render Blueprint for the backend
├── .gitignore
└── README.md
```

---

## 2. Set up MongoDB Atlas (once, about 10 minutes)

1. **Create an account:** go to <https://www.mongodb.com/cloud/atlas/register> and sign up (Google sign-in works).
2. **Create a cluster:**
   - Click **Create** (or **Build a Database**).
   - Choose a plan. **Free (M0)** is fine to start (512 MB). See the storage note below.
   - Provider: AWS. Region: **Singapore (ap-southeast-1)** or **Mumbai (ap-south-1)**, close to Pakistan and to the Render region.
   - Name it, for example `gift-inventory`, and click **Create Deployment**.
3. **Create a database user:**
   - Atlas shows "Connect to your cluster" → *Create a database user*. Or go to **Security → Database Access → Add New Database User**.
   - Method: **Password**. Username e.g. `gift_app`. Click **Autogenerate Secure Password** and **copy it** somewhere safe.
   - Role: **Read and write to any database** (built-in role `readWrite`). Save.
4. **Allow network access:**
   - Go to **Security → Network Access → Add IP Address**.
   - For local testing click **Add Current IP Address**.
   - For Render, add Render's outbound IP addresses (Render dashboard → your service → **Connect → Outbound**), **or** choose **Allow access from anywhere (0.0.0.0/0)**. Render's free/starter plans have no fixed IP, so `0.0.0.0/0` is the usual choice; the database is then protected by the user name + strong password.
5. **Copy the connection string:**
   - Go to **Database → Clusters → Connect → Drivers** (Node.js).
   - Copy the string; it looks like `mongodb+srv://gift_app:<db_password>@gift-inventory.abcde.mongodb.net/?retryWrites=true&w=majority&appName=gift-inventory`.
   - Replace `<db_password>` with the password from step 3.
   - Add the database name after `.net/`: `...mongodb.net/gift_inventory?retryWrites=true&w=majority`.
     If you leave the name out, the app uses `gift_inventory`.
6. **Put it into `backend/.env`** as `MONGODB_URI=...` (next section). **Never** put it in the code, the frontend or GitHub.

> **Storage note:** sale proof photos are stored in MongoDB too. The app shrinks each photo (max 1600 px, JPEG), usually to about 0.2–0.5 MB, so one sale with two photos uses about 0.5–1 MB.
> - The free M0 cluster (512 MB) therefore holds roughly 500–1,000 sales with photos.
> - For daily use, move to a paid tier (Flex or a dedicated cluster) before it fills up: Atlas → your cluster → **Upgrade**. The data stays.
> - Settings → Data & Backup shows the database size.

---

## 3. Run it on your computer

You need **Node.js 20 or newer** (22 recommended) from <https://nodejs.org>.

**Backend** (first terminal):
```bash
cd backend
cp .env.example .env        # Windows: copy .env.example .env
# open .env and fill in MONGODB_URI, JWT_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD
npm install
npm run dev
```
- You should see `[db] connected to MongoDB` and `Gift Inventory API on port 5000`.
- Check <http://localhost:5000/api/health>: it should show `{"ok":true,"database":"ok",...}`.
- Make a JWT secret with: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`

**Frontend** (second terminal):
```bash
cd frontend
cp .env.example .env        # contains VITE_API_URL=http://localhost:5000/api
npm install
npm run dev
```
Open <http://localhost:5173>.

**First start with an empty database:** the backend creates everything once.
- The admin account from `ADMIN_EMAIL` / `ADMIN_PASSWORD`.
- The starting data:
  - 7 promoters, each with their fixed login;
  - 7 shops (PK413451 … PK413423), assigned to their promoters, with QR codes;
  - 4 gifts, 35 units each, with 5 of each gift in every shop;
  - phone models and brands.

It never changes a database that already has data. Set `SEED_DATA=false` to start empty.

**Who signs in where:**
- Admin: sign in with `ADMIN_EMAIL` / `ADMIN_PASSWORD` → admin dashboard (`/admin`).
- Promoters: sign in with their fixed email + password (e.g. `WasifAli@company.com`) → promoter app (`/app`). Same sign-in page.

---

## 4. Move your existing data from the HTML file (only if you already recorded sales)

1. On the device that has the data, open your last HTML file → **Settings → Data & Backup → Download full backup**. You get a `gift-inventory-backup-YYYY-MM-DD.json` file with all data and photos.
2. In the new app, sign in as admin → **Settings → Data & Backup → Move data in / Restore** → choose the file → **Restore backup** → confirm.
   - This **replaces** all data in MongoDB with the backup.
   - Everyone signs in again afterwards. Passwords stay the same.
   - The admin from `ADMIN_EMAIL` / `ADMIN_PASSWORD` can always sign in.
3. If several devices have data, restore the one with the most complete data. A restore replaces; it does not merge.

---

## 5. Upload to GitHub

`.gitignore` already keeps out `node_modules/`, `.env`, `.env.local`, `dist/` and logs. So your passwords and secrets never go to GitHub.

**With Git (recommended):**
```bash
cd Gift-Inventory-System
git init
git add .
git status            # check: NO .env files in the list (only .env.example)
git commit -m "Gift Inventory full-stack app"
git branch -M main
git remote add origin https://github.com/<your-user>/gift-inventory-system.git
git push -u origin main
```
(Create the empty repository first on github.com → **New repository** → name `gift-inventory-system` → **Private** → *Create*.)

**Without Git:**
- On the new repository page, click **uploading an existing file**.
- Drag in the **contents** of the `Gift-Inventory-System` folder: `frontend/`, `backend/`, `render.yaml`, `.gitignore`, `README.md`.
- Do **not** upload `node_modules` or any `.env` file.

---

## 6. Deploy the backend on Render

**Option A — Blueprint (uses `render.yaml`):**
1. On <https://render.com> click **New → Blueprint**, connect GitHub and choose the repository.
2. Render asks for the secret values. Enter:
   - `MONGODB_URI` — the Atlas connection string from section 2;
   - `FRONTEND_URL` — your Vercel address. If you don't have it yet, enter `http://localhost:5173` and change it in step 7;
   - `ADMIN_EMAIL` and `ADMIN_PASSWORD`.
   - `JWT_SECRET` is generated by Render automatically.
3. Click **Apply**. Wait until the service is **Live**.

**Option B — by hand:** **New → Web Service** → choose the repository, then set:

| Setting | Value |
|---|---|
| Root Directory | `backend` |
| Runtime | Node |
| Build Command | `npm ci --omit=dev` (or `npm install`) |
| Start Command | `npm start` |
| Health Check Path | `/api/health` |
| Instance type | Starter (always on). Free also works but sleeps after 15 minutes without visits; the first request then takes about a minute. |

Environment variables (Render → your service → **Environment**):

| Name | Value |
|---|---|
| `MONGODB_URI` | your Atlas connection string |
| `JWT_SECRET` | a long random value (at least 32 characters) |
| `FRONTEND_URL` | `https://YOUR-VERCEL-DOMAIN.vercel.app` (several: separate with commas) |
| `ADMIN_EMAIL` | admin sign-in email |
| `ADMIN_PASSWORD` | strong password (8+ characters, letters and numbers) |
| `NODE_ENV` | `production` |
| `NODE_VERSION` | `22` |
| `TRUST_PROXY` | `true` |
| `TZ` | `Asia/Karachi` |

Check: `https://<your-service>.onrender.com/api/health` → `{"ok":true,"database":"ok"}`.

---

## 7. Deploy the frontend on Vercel

1. On <https://vercel.com> click **Add New → Project** and import the GitHub repository.
2. Settings:

| Setting | Value |
|---|---|
| Root Directory | `frontend` |
| Framework Preset | Vite |
| Build Command | `npm run build` |
| Output Directory | `dist` |
| Environment Variable | `VITE_API_URL` = `https://<your-service>.onrender.com/api` |

3. Click **Deploy**. Vercel gives you an address like `https://gift-inventory-system.vercel.app`.
4. Go back to **Render → Environment** and set `FRONTEND_URL` to exactly that address (no slash at the end), then save; Render restarts. Without this, the browser blocks the API calls (CORS).
5. If you change `VITE_API_URL` later, redeploy the frontend: Vite puts the value into the build.

`frontend/vercel.json` sends every page address (e.g. `/admin/shops`) to the app, so refreshing any page works.

---

## 8. Two-device test (do this once after deploying)

1. **Computer A:** open the Vercel link, sign in as admin, go to **Gifts → Gift List**. The top bar shows **Live**.
2. **Computer / phone B:** open the same link in another browser and sign in as admin. Go to **Gifts → Gift List**.
3. **On A:** **Add gift** → name `Infinix Phone`, quantity `10` → **Create gift**.
   → B shows `Infinix Phone` with 10 within about a second, without pressing anything.
4. **On B:** edit `Infinix Phone`, set quantity `25`, save. → A shows 25.
5. Close the browser on A completely, open it again: the data is still there (it comes from MongoDB).
6. **Phone:** sign in as a promoter, record a sale. → The admin dashboard on A updates by itself.

The automated tests (section 11) check the same steps against a real MongoDB server.

---

## 9. Environment variables

**Backend (`backend/.env`, Render → Environment)**

| Name | Required | Default | Meaning |
|---|---|---|---|
| `MONGODB_URI` | yes | — | MongoDB Atlas connection string. Never in the code. |
| `JWT_SECRET` | yes | — | Signs sign-in tokens. At least 32 random characters. |
| `FRONTEND_URL` | yes (production) | `http://localhost:5173` (dev) | Address(es) of the frontend allowed by CORS, comma separated. |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | yes (first start) | — | First admin account; also the admin that can always sign in after a restore. |
| `PORT` | no | `5000` | Render sets it. |
| `NODE_ENV` | no | — | `production` on Render. |
| `SEED_DATA` | no | `true` | Load the starting data into an EMPTY database. |
| `TZ` | no | `Asia/Karachi` | Business time zone for "today" and daily/monthly reports. |
| `JWT_EXPIRES_IN` | no | `12h` | How long a sign-in lasts. |
| `ALLOW_VERCEL_PREVIEWS` | no | `false` | Also allow `https://*.vercel.app` preview addresses. |
| `MAX_PHOTO_MB` | no | `6` | Largest photo upload. |
| `RESTORE_MAX_MB` | no | `100` | Largest backup file for Restore. |
| `TRUST_PROXY` | no | `true` in production | Correct client IPs behind Render's proxy. |
| `LOGIN_RATE_LIMIT` | no | `30` | Sign-in attempts per 15 minutes per IP address. |
| `API_RATE_LIMIT` | no | `3000` | API requests per minute per IP address. |
| `BCRYPT_ROUNDS` | no | `12` | bcrypt cost for password hashes. |

**Frontend (`frontend/.env`, Vercel → Environment Variables)**

| Name | Example | Meaning |
|---|---|---|
| `VITE_API_URL` | `http://localhost:5000/api` / `https://<your-service>.onrender.com/api` | Address of the backend API. Everything starting with `VITE_` is public (visible in the browser), so never put secrets there. |

---

## 10. Database (MongoDB collections)

| Collection | Model | What it holds |
|---|---|---|
| `users` | User | admins and promoters (password **hash** only, role, status) |
| `cities`, `markets` | City, Market | locations; a market belongs to a city |
| `shops` | Shop | Shop ID (QR code), name, city, market, address, assigned promoter, status |
| `gifts` | Gift | gift catalogue and central warehouse stock |
| `shop_inventory` | ShopInventory | stock of each gift in each shop (allocated, given) |
| `transactions` | Transaction | one sale: brand, model, mobile quantity, gift, gift quantity, two proof photos, remarks, location |
| `inventory_movements` | InventoryMovement | every allocation / adjustment (audit trail of stock) |
| `brands`, `phone_models` | Brand, PhoneModel | mobile brands and models (SKU) |
| `audit_logs` | AuditLog | who did what and when |
| `stored_files` | StoredFile | proof photos and gift images (binary) |
| `counters`, `settings`, `locks` | Counter, Setting, WriteLock | number sequences (SHP-0001, TXN-0000001 …), data revision, settings, the write lock |

**Fields and references:**
- Every record keeps the numeric `id` used in the app's links (e.g. `/admin/shops/PK413451`, `/api/gifts/3`).
- References between collections are numeric ids, with Mongoose `ref` and virtual populate:
  - `Shop.city_id` → City, `Shop.promoter_id` → User;
  - `Transaction.shop_id` → Shop, `gift_id` → Gift, `model_id` → PhoneModel.
- Indexes:
  - unique: Shop ID, Gift ID, email, user code, transaction ID, (shop, gift);
  - for lookups: shop, promoter, gift, date.
- Mongoose adds `createdAt` / `updatedAt` to every document.

**Rules kept from the original app:**
- No approval step: a submitted sale is final, and its gifts are deducted from the shop's stock at once.
- A promoter can never give more gifts than the shop has: checked on the server, one write at a time.
- Several server instances, for example during a Render deploy, take turns through a write lock in MongoDB.
- Two people editing the same shop, gift, user, brand or model: the second save is refused with a clear message ("changed on another device") instead of overwriting.

---

## 11. Tests

The backend tests start real API servers against a real MongoDB server. They cover:
- the two-device flow (add on A, see on B, edit on B, see on A) and the Socket.IO event;
- data surviving a restart, and passwords stored only as hashes;
- roles and JWT;
- CORS and Helmet headers;
- the sale with photos;
- many devices selling at once never overselling;
- Excel import, reports, and restore of an HTML-app backup.

```bash
cd backend
# needs a MongoDB server: local (mongodb://127.0.0.1:27017) or a separate Atlas TEST database
TEST_MONGODB_URI="mongodb://127.0.0.1:27017" npm test
```
Each test file uses its own database (`gift_inventory_test_*`) and drops it first. Never point `TEST_MONGODB_URI` at your live database.

---

## 12. API (REST, all under `/api`)

- **Sign in:** `POST /api/auth/login` returns a JWT. Send it as `Authorization: Bearer <token>` on every other request.
- **Who:** `admin` = admins only, `promoter` = promoters only, `signed in` = any signed-in user. The backend checks this on every request, using the user's current role and status in MongoDB.
- **Responses:**
  - Data comes back as JSON.
  - Errors come back as `{ "error": "message" }` with the right HTTP status: 400 invalid input, 401 not signed in, 403 no access, 404 not found, 409 conflict / not enough stock, 429 too many requests.
  - Files (CSV, QR PNG, backup, photos) come back as downloads.

| Method | Path | Who |
|---|---|---|
| GET | /api/health | public |
| GET | /api/sync | signed in |
| POST | /api/auth/login | public |
| GET | /api/auth/me | signed in |
| POST | /api/auth/logout | signed in |
| GET | /api/masters/cities | admin |
| POST | /api/masters/cities | admin |
| PUT | /api/masters/cities/:id | admin |
| DELETE | /api/masters/cities/:id | admin |
| GET | /api/masters/markets | admin |
| POST | /api/masters/markets | admin |
| PUT | /api/masters/markets/:id | admin |
| DELETE | /api/masters/markets/:id | admin |
| GET | /api/shops | admin |
| GET | /api/shops/export.csv | admin |
| GET | /api/shops/qr-sheet | admin |
| GET | /api/shops/:id/qr.png | admin |
| POST | /api/shops/:id/qr/regenerate | admin |
| POST | /api/shops/qr/log | admin |
| GET | /api/shops/:id | admin |
| POST | /api/shops | admin |
| PUT | /api/shops/:id | admin |
| PATCH | /api/shops/:id/status | admin |
| POST | /api/shops/bulk-assign | admin |
| POST | /api/shops/delete-preview | admin |
| POST | /api/shops/delete | admin |
| GET | /api/users | admin |
| GET | /api/users/:id | admin |
| POST | /api/users | admin |
| PUT | /api/users/:id | admin |
| PATCH | /api/users/:id/status | admin |
| GET | /api/promoters/performance | admin |
| GET | /api/promoters/:id/performance | admin |
| GET | /api/brands | admin |
| POST | /api/brands | admin |
| PUT | /api/brands/:id | admin |
| PATCH | /api/brands/:id/status | admin |
| GET | /api/promoter/brands | promoter |
| GET | /api/models | admin |
| POST | /api/models | admin |
| PUT | /api/models/:id | admin |
| PATCH | /api/models/:id/status | admin |
| GET | /api/gifts | admin |
| GET | /api/gifts/categories | admin |
| GET | /api/gifts/:id | admin |
| POST | /api/gifts | admin |
| PUT | /api/gifts/:id | admin |
| POST | /api/gifts/:id/stock | admin |
| PATCH | /api/gifts/:id/status | admin |
| POST | /api/gifts/:id/image | admin |
| GET | /api/inventory | admin |
| GET | /api/inventory/export.csv | admin |
| POST | /api/inventory/allocate | admin |
| POST | /api/inventory/adjust | admin |
| GET | /api/inventory/movements | admin |
| GET | /api/inventory/movements/export.csv | admin |
| GET | /api/inventory/dos | admin |
| GET | /api/inventory/dos/export.csv | admin |
| GET | /api/transactions | admin |
| GET | /api/transactions/export | admin |
| GET | /api/transactions/export.csv | admin |
| GET | /api/transactions/:code | admin |
| GET | /api/files/transactions/:code/photo | signed in |
| GET | /api/files/transactions/:code/mobile-photo | signed in |
| GET | /api/files/gifts/:code/image | signed in |
| GET | /api/promoter/shops/:code | promoter |
| GET | /api/promoter/shops | promoter |
| POST | /api/promoter/transactions | promoter |
| GET | /api/promoter/transactions | promoter |
| GET | /api/promoter/transactions/:code | promoter |
| GET | /api/promoter/summary | promoter |
| GET | /api/promoter/sales | promoter |
| GET | /api/promoter/gifts | promoter |
| GET | /api/sales/summary | admin |
| GET | /api/reports/dashboard | admin |
| GET | /api/reports/:type | admin |
| POST | /api/import/:type | admin |
| GET | /api/settings | admin |
| PUT | /api/settings | admin |
| GET | /api/audit | admin |
| GET | /api/audit/actions | admin |
| GET | /api/audit/export.csv | admin |
| GET | /api/system/info | admin |
| GET | /api/system/backup | admin |
| POST | /api/system/restore | admin |

Real-time: Socket.IO on the same server (path `/socket.io`, auth `{ token }`). Event `data:changed` `{ v, client, at }` carries no business data.

---

## 13. Security

- **Passwords:**
  - Hashed with **bcrypt** before they are stored. Plain-text passwords are never stored.
  - The promoters' fixed logins in `backend/src/seed/promoter-logins.json` are one-way PBKDF2 hashes. They are upgraded to bcrypt at the first sign-in.
  - Passwords are fixed: there is no change-password screen, as in the last HTML version.
- **Sign-in:**
  - JWT (HS256), signed with `JWT_SECRET`, expires after 12 h.
  - Deactivating a user ends their sign-ins at once.
  - Sign-in attempts are rate-limited per IP and per email.
- **Access:** role checks are done in the backend on every request, not only in the menus.
- **Secrets:** `MONGODB_URI`, `JWT_SECRET` and the admin password live only in environment variables. `.env` files are git-ignored, and the frontend bundle contains no secrets.
- **Web protection:**
  - Helmet security headers.
  - CORS allows only `FRONTEND_URL`.
  - Input checks on every request: MongoDB operator keys such as `$where` are refused.
  - Uploads are size-limited and checked to be real JPG/PNG/WEBP images.
  - Error messages never show internal details.
- **Default password on import:** new promoters created by **Excel import** without a password get the default password `Promoter@123`, as in the original app. Always fill in the password column for new promoters.

---

## 14. Troubleshooting

| Problem | Fix |
|---|---|
| Backend stops with "MONGODB_URI is missing" / "JWT_SECRET is too short" | Fill in `backend/.env` (local) or Render → Environment. |
| `MongoServerSelectionError` / cannot connect | Atlas → Network Access: add your IP (or `0.0.0.0/0` for Render). Check the password in the connection string (special characters must be URL-encoded). |
| Browser console: "blocked by CORS policy" / API answers 403 "not allowed (CORS)" | Set `FRONTEND_URL` on Render to the exact Vercel address (https, no slash at the end) and restart. |
| First request after a while takes ~1 minute | Render free plan sleeps. Use the Starter plan. |
| The top bar shows "Auto-refresh" instead of "Live" | Your network blocks WebSockets / long polling; the app checks every 20 s instead. |
| Page refresh on Vercel shows 404 | Make sure `frontend/vercel.json` is in the repository and Root Directory is `frontend`. |
| "Your session has ended" after a restore | Expected: everyone signs in again after a restore. |
