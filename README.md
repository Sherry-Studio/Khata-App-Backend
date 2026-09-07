# Khata+ backend

REST API for the Khata+ mobile app, built to the contract in
`../Khata Mobile App/BACKEND.md`. Node + Express + TypeScript + Prisma (MongoDB).
Includes an **admin API** for user management, metrics, audit and broadcasts.

### Docs

| File | For |
| --- | --- |
| `README.md` | running / deploying this backend |
| `MOBILE_INTEGRATION.md` | swapping the app's alpha in-memory store for this API |
| `ADMIN_PANEL.md` | building the beta admin dashboard on `/admin/*` |
| `../Khata Mobile App/BACKEND.md` | the original endpoint contract |

## Quick start

```bash
cp .env.example .env      # then set DATABASE_URL (MongoDB), GEMINI_API_KEY, SMTP_*
npm install
npm run setup             # prisma db push + seed (admin account only)
npm run dev               # http://localhost:4000/api/v1
```

Requires a MongoDB replica set — MongoDB Atlas (any free M0 cluster) works out of
the box; a bare local `mongod` does not (Prisma needs transactions).

The seed creates **only the admin account** (`admin@khata.app` / `admin12345`,
change via `ADMIN_EMAIL` / `ADMIN_PASSWORD`). New users sign up empty — no demo
data.

## Scripts

| Script              | Purpose                                          |
| ------------------- | ------------------------------------------------ |
| `npm run dev`       | Watch-mode server                               |
| `npm run build`     | `prisma generate` + `tsc` → `dist/`             |
| `npm start`         | Run compiled server                            |
| `npm run db:push`   | Sync indexes to MongoDB                         |
| `npm run db:reset`  | Force-resync (`prisma db push --force-reset`)   |
| `npm run seed`      | Create the admin account                        |
| `npm run db:wipe`   | Delete all data + all non-admin users           |
| `npm run typecheck` | `tsc --noEmit`                                  |

## Alignment with BACKEND.md

Base URL `/{API_BASE}/v1` (default `/api/v1`). All money is **integer PKR**.
Auth is `Authorization: Bearer <accessToken>`. Response DTOs match the app's
`src/services/types.ts` shapes — `icon`, `dateLabel`, `time`, `initials`,
`dueTag`/`dueColor`, account `meta` etc. are **server-derived** by
`src/serializers.ts`. `balance` and the `*ThisMonth` aggregates on `/me` are
server-computed in `src/util/aggregates.ts` (client never derives them).

Implemented, section by section:

- **Auth** — `signup`, `login`, `otp/verify` (returns `attemptsLeft` in the 400
  body for the OTP error view), `otp/resend`, `password/reset`, `refresh`
  (rotating refresh tokens), `logout`, `oauth/google`.
  - `OTP_DEV_MODE=true` → the code is returned as `devOtp` in the response + logged.
  - `OTP_DEV_MODE=false` → the code is emailed (SMTP, `src/mailer.ts`) and never
    returned. If SMTP is unset or fails, the code is still logged so dev isn't
    blocked.
- **Profile & setup** — `GET/PATCH /me`.
- **Transactions** — list (cursor pagination + all filter params + `q` search),
  `:id`, create (updates account balance + matching budget `spent`), patch,
  delete (rolls back balance), `/transactions/groups`.
- **Khata (udhaar)** — list by `direction`, `:id` with `history[]`, create,
  `/entries`, `/settle`, `/reminder` (returns `{message}` only — the app sends
  it), `/summary`.
- **Groups & splits** — list, `:id` (group/expenses/settlements/splitType),
  create, `/expenses`, `/settlements/:sid/settle`.
- **Goals & budgets** — `GET/POST /goals`, `PATCH /goals/:id`,
  `GET /budgets?month=YYYY-MM`, `POST /budgets`.
- **Money surfaces** — `/bills` (+`/bills/:id/pay`, `PATCH /bills/settings`),
  `/subscriptions`, `/accounts` (+`PATCH`), `/networth`, `/analytics?range=`,
  `/notifications` (+`/read`, `PATCH /notifications/preferences`), `POST /export`
  (returns `{url}` — file rendering is stubbed).
- **Transfers** (not in `BACKEND.md`) — `POST /transfers`,
  `GET /transfers?accountId=`, `GET/DELETE /transfers/:id`. Moves money between
  the user's accounts atomically; recorded as `kind:"transfer"` so it never
  affects income/expense aggregates. See `MOBILE_INTEGRATION.md` §12.
- **AI assistant** — `POST /ai/ask` and `GET /ai/suggested-questions`, returning
  the `{lead, rows, tail, action, followups}` render shape. Two providers via
  `AI_PROVIDER`:
  - `rules` (default) — offline, deterministic answers from the user's own data.
    Free, no key, no data leaves the server.
  - `gemini` — Google Gemini (free tier key at
    <https://aistudio.google.com/apikey>), model `GEMINI_MODEL`
    (default `gemini-flash-lite-latest`). Only an **aggregated** snapshot
    (`src/ai/context.ts`) is sent — never raw transactions, names, or phones.
    Any error (missing key, 20s timeout, bad JSON, rate limit) falls back to `rules`.
  Per-user rate limit: `AI_RATE_PER_MIN` (default 10/min). The response includes
  `provider` so you can see which answered. Keep the disclaimer line client-side.

  **To make it live:** set `AI_PROVIDER=gemini` and `GEMINI_API_KEY=...` in `.env`,
  restart. Nothing else changes.

New users start with **no data** — the app must render its empty states until
the user adds their first account / transaction.

### Cross-cutting

- Errors: `400` validation (`{error:'validation_error', issues}`), `401` →
  client refreshes once then resets to Splash, `403 account_disabled`.
- Empty endpoints return `[]` (drive the app's empty states).
- Cursor pagination on `/transactions` via `nextCursor` (app switches
  `ActivityScreen` to `FlatList` + `onEndReached`).

## Admin API — `/api/v1/admin/*` (role `admin` only)

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/admin/metrics` | user / transaction / udhaar totals for a dashboard |
| GET | `/admin/users?q&role&disabled&cursor&limit` | paged user search |
| POST | `/admin/users` | create a user (`{email,password,name?,role}`) |
| GET | `/admin/users/:id` | user detail + aggregates + row counts |
| PATCH | `/admin/users/:id` | edit name/phone/income/verified/role |
| POST | `/admin/users/:id/disable` \| `/enable` | toggle access (disable revokes refresh tokens) |
| POST | `/admin/users/:id/reset-password` | set a new password (`{password}`) |
| POST | `/admin/users/:id/impersonate` | mint a session for that user (support) |
| DELETE | `/admin/users/:id` | hard-delete (cascades) |
| GET | `/admin/transactions?userId&cursor&limit` | global transaction feed |
| GET | `/admin/audit?cursor&limit` | audit log of admin actions |
| POST | `/admin/notifications/broadcast` | push a notification to all users or one (`{kind,body,tone,userId?}`) |

Every mutating admin action is written to the `AuditLog` collection. An admin
cannot disable or delete their own account.

## Deploy to Vercel

The app is a normal long-running server locally (`src/server.ts` → `app.listen`).
On Vercel that file is **not** used — Vercel is serverless, so `api/index.ts`
wraps the same Express app (`createApp()`) as a function and `vercel.json`
rewrites every path to it.

1. **Env vars — Vercel never reads a repo `.env` file** (dotenv only loads it in
   local dev; `.env*` is git-ignored anyway). Load them into the project:
   - Dashboard → Settings → Environment Variables → **Import .env** → paste
     `.env.vercel`, or
   - `vercel env add <KEY> production` per key.
   Do **not** set `NODE_ENV` (Vercel sets it). Redeploy after changing vars.
2. **MongoDB Atlas** → Network Access → allow `0.0.0.0/0` (Vercel egress IPs are
   dynamic).
3. `prisma generate` runs via `postinstall` + `vercel-build`; the rhel binary
   target is in `schema.prisma`. Schema/seed are run once from your machine
   (`npm run setup`), never on Vercel.
4. Deploy: `vercel --prod` (or connect the repo). Base URL becomes
   `https://<project>.vercel.app/api/v1`.

Caveats: the AI rate-limit is per-instance in memory (fine, just approximate);
serverless cold starts add ~1s; keep `maxDuration` ≥ the Gemini timeout (set to
30s in `vercel.json`). A persistent host (Render / Railway / Fly) can instead run
`npm run build && npm start` unchanged.

## Production notes

- Set strong `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` (the ones in `.env.vercel`
  are freshly generated — rotate anything shared over chat).
- Set `GOOGLE_CLIENT_ID` to enable real Google ID-token verification.
- OTP email goes through `src/mailer.ts` (SMTP). The `/export` file renderer is
  still a stub (returns a `{url}` only).
