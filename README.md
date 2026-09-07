# Khata+ backend

REST API for the Khata+ mobile app, built to the contract in
`../Khata Mobile App/BACKEND.md`. Node + Express + TypeScript + Prisma (SQLite).
Includes an **admin API** for user management, metrics, audit and broadcasts.

## Quick start

```bash
cp .env.example .env
npm install
npm run setup   # prisma db push + seed (admin + demo user with full dataset)
npm run dev     # http://localhost:4000/api/v1
```

Seeded accounts:

| Role  | Email             | Password      |
| ----- | ----------------- | ------------- |
| admin | `admin@khata.app` | `admin12345`  |
| user  | `demo@khata.app`  | `demo12345`   |

Change these via `ADMIN_EMAIL` / `ADMIN_PASSWORD` in `.env`.

## Scripts

| Script              | Purpose                                          |
| ------------------- | ------------------------------------------------ |
| `npm run dev`       | Watch-mode server                               |
| `npm run build`     | `prisma generate` + `tsc` → `dist/`             |
| `npm start`         | Run compiled server                            |
| `npm run db:push`   | Sync schema to SQLite                           |
| `npm run db:reset`  | Drop + recreate                                |
| `npm run seed`      | Seed admin + demo user                          |
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
  (rotating refresh tokens), `logout`, `oauth/google`. In dev (`OTP_DEV_MODE=true`)
  the OTP is returned as `devOtp` and logged; wire a real SMS/email provider in
  `sendOtp()` in `src/routes/auth.ts`.
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
- **AI assistant** — `POST /ai/ask` and `GET /ai/suggested-questions`, returning
  the `{lead, rows, tail, action, followups}` render shape from real user data.

New verified users (and Google-OAuth first sign-ins) are auto-populated with the
app's demo dataset via `src/seedUserData.ts` so the dashboard is never empty.

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
| POST | `/admin/users` | create a user (`{email,password,name?,role,seed?}`) |
| GET | `/admin/users/:id` | user detail + aggregates + row counts |
| PATCH | `/admin/users/:id` | edit name/phone/income/verified/role |
| POST | `/admin/users/:id/disable` \| `/enable` | toggle access (disable revokes refresh tokens) |
| POST | `/admin/users/:id/reset-password` | set a new password (`{password}`) |
| POST | `/admin/users/:id/impersonate` | mint a session for that user (support) |
| POST | `/admin/users/:id/reseed` | wipe + reload the demo dataset |
| DELETE | `/admin/users/:id` | hard-delete (cascades) |
| GET | `/admin/transactions?userId&cursor&limit` | global transaction feed |
| GET | `/admin/audit?cursor&limit` | audit log of admin actions |
| POST | `/admin/notifications/broadcast` | push a notification to all users or one (`{kind,body,tone,userId?}`) |

Every mutating admin action is written to the `AuditLog` table. An admin cannot
disable or delete their own account.

## Production notes

- Swap SQLite for Postgres: change `datasource db` provider + `DATABASE_URL`,
  then `prisma migrate`.
- Set strong `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET`, `NODE_ENV=production`.
- Set `GOOGLE_CLIENT_ID` to enable real Google ID-token verification.
- Implement `sendOtp()` and the `/export` file renderer.
