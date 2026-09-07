# Khata+ — Admin panel guide (beta)

A small web dashboard for the Khata+ team to run the beta: watch signups, help
users, moderate data, and push announcements. It is a **pure client** of the
existing backend — every action is an HTTPS call to `/api/v1/admin/*`. No new
server code is required for the beta.

- **Backend base URL:** `https://khata-app-backend-beta.vercel.app/api/v1`
- **Who can use it:** any user whose `role` is `admin`. Seeded admin during
  alpha/beta: `admin@khata.app` / `admin12345` (change `ADMIN_PASSWORD` and
  reseed, or `PATCH /admin/users/:id` a real teammate to `role: "admin"`).
- **Alpha → beta:** the alpha proved the API. The beta adds this panel so the
  team is not running `curl` by hand.

---

## 1. Auth

Same auth as the mobile app — there is no separate admin login endpoint.

```
POST /api/v1/auth/login   { "email", "password" }
      → 200 { accessToken, refreshToken, user }
```

1. Call `login`. If `user.role !== "admin"`, show "not authorized" and stop.
2. Store `accessToken` (15 min) + `refreshToken` (30 days). For a beta-only
   internal tool, `localStorage` is acceptable; prefer an httpOnly cookie if you
   put this on a public URL.
3. Send `Authorization: Bearer <accessToken>` on every `/admin` request.
4. On `401`, call `POST /api/v1/auth/refresh { refreshToken }` once
   → `{ accessToken, refreshToken }` (tokens rotate — replace both), retry the
   request. If refresh fails, clear tokens and return to the login screen.
5. Logout: `POST /api/v1/auth/logout { refreshToken }`.

Every `/admin` response is JSON. Errors:
`{ "error": "<code>" }` with the HTTP status (`400` also carries `issues` from
zod; `403 admin_only` means the token is not an admin).

---

## 2. Endpoint reference

All paths below are under `/api/v1/admin`. All require an admin bearer token.

### Dashboard

| Method | Path | Response |
| --- | --- | --- |
| GET | `/metrics` | see below |

```json
{
  "users":        { "total": 128, "verified": 119, "disabled": 3, "newThisMonth": 41 },
  "transactions": { "count": 5120, "volume": 8433120 },
  "udhaarOutstanding": 249000
}
```
`volume` and `udhaarOutstanding` are integer PKR.

### Users

| Method | Path | Query / Body | Response |
| --- | --- | --- | --- |
| GET | `/users` | `?q&role=user\|admin&disabled=true\|false&cursor&limit` (limit ≤ 100, default 25) | `{ items: User[], nextCursor }` |
| POST | `/users` | `{ email, password (≥8), name?, role?, seed? }` | `User` (201) |
| GET | `/users/:id` | — | `User` + `language`, `appearance`, `aggregates`, `counts` |
| PATCH | `/users/:id` | `{ name?, phone?, monthlyIncome?, verified?, role? }` | `User` |
| POST | `/users/:id/disable` | — | `User` (also revokes their refresh tokens) |
| POST | `/users/:id/enable` | — | `User` |
| POST | `/users/:id/reset-password` | `{ password (≥8) }` | `204` (revokes their sessions) |
| POST | `/users/:id/impersonate` | — | `{ accessToken, refreshToken, user }` |
| POST | `/users/:id/reseed` | — | `204` (wipes + reloads that user's demo dataset) |
| DELETE | `/users/:id` | — | `204` (hard delete, cascades all their data) |

`User` (list + most responses):
```json
{
  "id": "6a9f0bcb7525a931c93864ee",
  "email": "demo@khata.app",
  "name": "Shehryar",
  "phone": "+92 300 4821764",
  "role": "user",
  "verified": true,
  "disabled": false,
  "monthlyIncome": 70000,
  "createdAt": "2026-09-07T18:56:29.107Z"
}
```

`GET /users/:id` adds:
```json
{
  "...": "all User fields",
  "language": "en",
  "appearance": "system",
  "aggregates": {
    "balance": 42736, "incomeThisMonth": 69926, "expenseThisMonth": 27190,
    "savedThisMonth": 42736, "transactionCount": 7
  },
  "counts": { "transactions": 7, "udhaar": 3, "goals": 3, "accounts": 5 }
}
```

**Guards:** an admin cannot `disable` or `DELETE` their own account (`400
cannot_disable_self` / `cannot_delete_self`). `POST /users` returns `409
email_taken` on a duplicate.

### Global transaction feed

| Method | Path | Query | Response |
| --- | --- | --- | --- |
| GET | `/transactions` | `?userId&cursor&limit` (≤ 100, default 50) | `{ items, nextCursor }` |

```json
{
  "items": [
    { "id": "...", "userEmail": "demo@khata.app", "kind": "expense",
      "name": "Cheezious", "amount": 850, "category": "Food",
      "method": "Cash", "date": "2026-09-05T15:42:00.000Z" }
  ],
  "nextCursor": "..."
}
```
Read-only. Use it to spot-check activity or investigate a support ticket.

### Audit log

| Method | Path | Query | Response |
| --- | --- | --- | --- |
| GET | `/audit` | `?cursor&limit` (≤ 100, default 50) | `{ items, nextCursor }` |

```json
{
  "items": [
    { "id": "...", "actorId": "...", "actorEmail": "admin@khata.app",
      "action": "user.disable", "targetId": "6a9f...", "meta": {},
      "createdAt": "2026-09-08T01:10:00.000Z" }
  ],
  "nextCursor": null
}
```
Every mutating admin action writes one row: `user.create`, `user.update`,
`user.disable`, `user.enable`, `user.reset_password`, `user.impersonate`,
`user.delete`, `user.reseed`, `notification.broadcast`.

### Broadcast a notification

| Method | Path | Body | Response |
| --- | --- | --- | --- |
| POST | `/notifications/broadcast` | `{ kind, body, tone?, userId? }` | `{ delivered: <count> }` |

- `tone`: `"warn" \| "accent" \| "pos"` (default `accent`).
- Omit `userId` → sent to every non-disabled user. With `userId` → just that one.
- The notification appears in the app's Notifications screen (`GET
  /notifications`). Use for beta announcements, maintenance windows, "please
  update the app".

---

## 3. Pagination pattern

Every list endpoint is cursor-based:

```
GET /admin/users?limit=25
  → { items: [...25], nextCursor: "abc" }
GET /admin/users?limit=25&cursor=abc
  → { items: [...], nextCursor: null }   // null = last page
```

Keep the same filters (`q`, `role`, `disabled`) on every page request. A "Load
more" button or infinite scroll both work.

---

## 4. Screens for the beta

Minimum viable panel — five routes:

| Route | Purpose | Calls |
| --- | --- | --- |
| `/login` | email + password, reject non-admins | `POST /auth/login` |
| `/` (Dashboard) | 6 stat cards: total / verified / disabled / new-this-month users, tx count, tx volume, udhaar outstanding | `GET /admin/metrics` |
| `/users` | searchable, filterable, paginated table; row → detail; inline disable/enable | `GET /admin/users`, `POST .../disable\|enable` |
| `/users/:id` | profile + aggregates + counts; actions: edit fields, verify, make/unmake admin, reset password, reseed, impersonate, delete (with confirm) | `GET/PATCH /admin/users/:id`, `POST .../reset-password\|reseed\|impersonate`, `DELETE` |
| `/audit` | reverse-chronological action log, paginated | `GET /admin/audit` |
| `/broadcast` | compose kind/body/tone, target all or one user, show delivered count | `POST /admin/notifications/broadcast` |

Optional: `/transactions` global feed (support tool), `/users/new` create form.

### Impersonation UX
`POST /users/:id/impersonate` returns a full session for that user. Two options:
1. **Debug only:** show the tokens so a developer can paste them into a REST
   client to reproduce a bug.
2. **Live:** open the mobile web build / a second app instance with those tokens
   pre-loaded. Always show a persistent "You are impersonating <email>" banner
   and a one-click "exit" that restores the admin session. The impersonation is
   already recorded in the audit log.

### Destructive-action rules
- `disable`, `reset-password`, `reseed`, `delete` → confirm dialog that types or
  clicks through the user's email.
- `delete` is irreversible (cascades transactions, udhaar, goals, etc.). Prefer
  `disable` during beta.

---

## 5. Suggested stack

Nothing heavy is needed. Any of:

- **Vite + React + TypeScript** + React Router + TanStack Query (handles the
  cursor pagination, refetch, and 401-retry cleanly) + a table/UI kit of your
  choice. Deploy as a separate Vercel static project.
- **Next.js** app-router if you want the admin panel and a marketing page in one
  deploy.
- A single-file HTML + `fetch` page is enough for the first week of beta.

A thin API client:

```ts
const BASE = "https://khata-app-backend-beta.vercel.app/api/v1";

async function adminFetch(path: string, init: RequestInit = {}) {
  const run = (token: string) =>
    fetch(`${BASE}/admin${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
        ...init.headers,
      },
    });

  let res = await run(getAccess());
  if (res.status === 401 && (await tryRefresh())) res = await run(getAccess());
  if (!res.ok) throw new Error((await res.json()).error ?? res.statusText);
  return res.status === 204 ? null : res.json();
}
```

---

## 6. CORS / deploy notes

- The backend currently sends `Access-Control-Allow-Origin: *` (`cors()` in
  `src/app.ts`) — fine for beta. Before a public admin URL, lock it to the
  panel's origin and switch tokens to httpOnly cookies.
- Point the panel at the beta backend via its own env var
  (`VITE_API_BASE=https://khata-app-backend-beta.vercel.app/api/v1`).
- Rate limits: none on `/admin` yet. Don't hammer `/metrics` — poll at most
  every 30–60s.

---

## 7. Beta checklist

- [ ] At least one **real teammate** promoted to `role: "admin"` (not just the
      seeded `admin@khata.app`); rotate/disable the seeded one.
- [ ] `ADMIN_PASSWORD` changed from `admin12345` in Vercel env.
- [ ] Panel deployed on its own URL, CORS restricted to it.
- [ ] Login rejects non-admin accounts.
- [ ] Dashboard, Users list + detail, Audit, Broadcast all working against the
      live backend.
- [ ] Disable / reset-password / delete all behind a confirm step.
- [ ] Gmail app password fixed so OTP emails actually send (currently codes only
      appear in Vercel Runtime Logs).
- [ ] MongoDB Atlas Network Access allows `0.0.0.0/0` (Vercel egress).
- [ ] Someone other than the author has done a full pass: sign up a test user in
      the app → find them in `/users` → verify → broadcast → disable → confirm
      they're logged out.
