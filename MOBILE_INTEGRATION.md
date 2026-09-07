# Khata+ — Mobile app API integration (alpha → beta)

The alpha ships with a finished UI backed by one in-memory store
(`src/store/AppStore.tsx` + `src/services/seed.ts`). This is the checklist to
replace that store with the live backend and delete the dummy data — without
touching any screen.

- **Live API:** `https://khata-app-backend-beta.vercel.app/api/v1`
- **Contract:** `BACKEND.md` (endpoint list) + `src/services/types.ts` (DTOs).
  The server already returns those DTO shapes — see §6 for the small deltas.
- **Rule:** screens keep calling `useApp()`. Only `AppStore.tsx` and
  `src/services/*` change.

---

## 1. The seam (recap)

```
screens/components ── useApp() ──▶ AppStore.tsx ──▶ services/api.ts ──▶ backend
```

`services/seed.ts` goes away. `services/types.ts` stays (they are the DTOs).
Add `services/api.ts` (HTTP client) and `services/auth.ts` (token storage).

---

## 2. Config

```ts
// src/config.ts
export const API_BASE =
  process.env.EXPO_PUBLIC_API_BASE ?? 'https://khata-app-backend-beta.vercel.app/api/v1';
```

RN CLI: put it in `react-native-config` / an `env.ts`. One value, no secrets in
the app.

---

## 3. HTTP client + tokens

```ts
// src/services/auth.ts
import AsyncStorage from '@react-native-async-storage/async-storage';
const A = 'khata.access', R = 'khata.refresh';
export const getAccess  = () => AsyncStorage.getItem(A);
export const getRefresh = () => AsyncStorage.getItem(R);
export const setTokens  = (a: string, r: string) =>
  AsyncStorage.multiSet([[A, a], [R, r]]);
export const clearTokens = () => AsyncStorage.multiRemove([A, R]);
```

```ts
// src/services/api.ts
import { API_BASE } from '../config';
import { getAccess, getRefresh, setTokens, clearTokens } from './auth';

let onAuthLost: () => void = () => {};
export const setOnAuthLost = (fn: () => void) => (onAuthLost = fn);

async function refresh(): Promise<boolean> {
  const refreshToken = await getRefresh();
  if (!refreshToken) return false;
  const r = await fetch(`${API_BASE}/auth/refresh`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  });
  if (!r.ok) return false;
  const { accessToken, refreshToken: next } = await r.json();
  await setTokens(accessToken, next);
  return true;
}

export async function api<T = unknown>(
  path: string,
  init: RequestInit = {},
  auth = true,
): Promise<T> {
  const run = async () => {
    const token = auth ? await getAccess() : null;
    return fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...init.headers,
      },
    });
  };

  let res = await run();
  if (res.status === 401 && auth) {
    if (await refresh()) res = await run();
    else { await clearTokens(); onAuthLost(); throw new ApiError(401, 'auth_lost'); }
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body.error ?? res.statusText, body);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

export class ApiError extends Error {
  constructor(public status: number, public code: string, public body?: any) {
    super(code);
  }
}
```

Wire `setOnAuthLost(() => navigationRef.reset({ routes: [{ name: 'Splash' }] }))`
once at app root — that covers "repeated 401 → reset to Splash" and
More → "Log out".

---

## 4. Auth screens

| Screen | Call | On success |
| --- | --- | --- |
| `SignupScreen` | `POST /auth/signup {email,password}` → `{userId, otpRequired}` | go to `OtpScreen` with `userId` |
| `OtpScreen` | `POST /auth/otp/verify {userId, code}` → `{accessToken, refreshToken, user}` | `setTokens`, bootstrap store, `navigation.reset` → Tabs |
| — resend | `POST /auth/otp/resend {userId}` | toast "code sent" |
| — error | verify returns **400** `{error:'invalid_otp', details:{attemptsLeft}}` | show the existing error view, render `attemptsLeft` |
| `LoginScreen` | `POST /auth/login {email,password}` → `{accessToken, refreshToken, user}` | `setTokens`, bootstrap, reset → Tabs |
| — unverified | login returns **403** `{error:'otp_required', details:{userId}}` | route to `OtpScreen` |
| `ForgotScreen` | `POST /auth/password/reset {email}` → always `204` | show "if that email exists, a code was sent" |
| Google btn | `POST /auth/oauth/google {idToken}` → session | same as login |
| Log out | `POST /auth/logout {refreshToken}` then `clearTokens()` | reset → Splash |

For the beta, **every OTP is `123456`** (hardcoded `STATIC_OTP` in
`src/routes/auth.ts` while email delivery isn't wired up). Set it to `''` to
restore random codes. (The demo error button in `OtpScreen` → wire to the real
400 above.)

---

## 5. Bootstrapping `AppStore`

On mount:

```
const token = await getAccess();
if (!token)  -> Splash → Welcome (unchanged)
else {
  set loading = true                      // screens show <Skeleton/>
  const [profile, tx, udhaar, summary, groups, goals, budgets,
         bills, subs, accounts, notifications] = await Promise.all([
    api('/me'),
    api('/transactions?limit=20'),
    api('/udhaar'),
    api('/udhaar/summary'),
    api('/groups'),
    api('/goals'),
    api('/budgets'),
    api('/bills'),
    api('/subscriptions'),
    api('/accounts'),
    api('/notifications'),
  ]);
  hydrate the reducer; loading = false
}
```

`owedToMe` / `iOwe` for Home + Khata come from `/udhaar/summary`
(`owedToMe`, `iOwe`). Do not sum on the client.

---

## 6. `useApp()` selectors → endpoints

| Selector | Source | Notes |
| --- | --- | --- |
| `profile` | `GET /me` | `balance`, `*ThisMonth` are server-computed — never derive |
| `transactions` | `GET /transactions` (`items`, newest first) | paginated, see §8 |
| `txGroups()` | `GET /transactions/groups` → `{date,total,items}[]` | or group client-side from `transactions` |
| `txById(id)` | `GET /transactions/:id` | or look up in the loaded list |
| `udhaar` | `GET /udhaar` | |
| `udhaarBy('owe'\|'iowe')` | `GET /udhaar?direction=` | or filter locally |
| `personById(id)` | `GET /udhaar/:id` | includes `history[]` |
| `owedToMe`, `iOwe` | `GET /udhaar/summary` | |
| `groups` | `GET /groups` | |
| `goals` | `GET /goals` | |
| `budgets` | `GET /budgets` → `{month,spent,total,categories}` | use `.categories` for the list |
| `bills`, `subs` | `GET /bills`, `GET /subscriptions` | |
| `accounts` | `GET /accounts` | |
| `notifications` | `GET /notifications` | |

**DTO deltas vs `types.ts` (all additive — safe to ignore or adopt):**
- `Transaction` adds `accountId` (string|null). `icon`, `dateLabel`, `time` are
  now **server-provided** — delete the client-side `categoryIcon` / date
  formatting for transactions (keep the helpers for the Add sheets if needed).
- `UdhaarEntry` `initials`, `since` ("Since 5 Sep"), `dueTag`, `dueColor`,
  `history[]` are server-provided.
- `Budget` adds `month`. `Account` adds `type`. `AppNotification` adds `read`.
- AI answer adds `provider` ("rules" | "gemini") — ignore in the UI.

---

## 7. `useApp()` actions → endpoints (optimistic)

Pattern for every `add*` / mutate: update the reducer now, fire the request,
on failure roll back + toast (`StatesScreen` "We couldn't save that expense").

| Action | Call | Reducer effect |
| --- | --- | --- |
| `addExpense(amount, category, method)` | `POST /transactions {kind:'expense',amount,category,method,accountId?}` | prepend returned `Transaction`; `profile.balance -= amount`; `expenseThisMonth += amount` |
| `addIncome(amount, source)` | `POST /transactions {kind:'income',amount,source}` | prepend; `balance += amount`; `incomeThisMonth += amount` |
| `addUdhaar(name, amount, dir)` | `POST /udhaar {name,direction:dir,amount,phone?,dueDate?,reason?}` | prepend `UdhaarEntry`; bump summary |
| Person → add entry | `POST /udhaar/:id/entries {type:'lent'\|'borrowed'\|'repayment',amount,method,date?}` | replace that entry with the response |
| `markPaid(id)` | `POST /udhaar/:id/settle` → `204` | remove that `UdhaarEntry`; recalc summary |
| Person → Remind | `POST /udhaar/:id/reminder {channel:'copy'\|'share'\|'whatsapp'}` → `{message}` | RemindSheet shows/opens `message`; **app sends nothing** |
| `addGoal(name, target, date)` | `POST /goals {name,target,date}` | prepend `Goal` |
| Goal → contribute | `PATCH /goals/:id {saved}` | replace goal |
| `addBudget(label, total)` | `POST /budgets {label,total,month?}` | append `Budget` |
| `addAccount(...)` | `POST /accounts {tag,name,type,balance}` | append `Account` |
| Bills settings | `PATCH /bills/settings {remindOffset,repeat}` | store settings |
| Notif prefs (Settings) | `PATCH /notifications/preferences {...toggles}` | store toggles |
| AI ask | `POST /ai/ask {question, locale}` → `{lead,rows,tail,action,followups}` | render as-is; keep the disclaimer client-side |
| AI suggested | `GET /ai/suggested-questions?locale` → `string[]` | chips |
| Settings → Appearance | client-only (AsyncStorage) **and** `PATCH /me {appearance}` | re-theme now, persist |
| Settings → Language | `PATCH /me {language}` | drives copy / RTL |
| Export (Settings) | `POST /export {kind,from,to,format}` → `{url}` | open the url (renderer is still a stub) |

`method` / `category` are optional on `POST /transactions` now — income can send
just `{kind,amount,source}`; expense `{kind,amount,category}`. Pass `accountId`
when the sheet has an account picker so the account balance moves server-side.

---

## 8. Pagination — `ActivityScreen`

Swap the `ScrollView` for a `FlatList`:

```
data = transactions
onEndReached = () => {
  if (!nextCursor || loadingMore) return;
  const { items, nextCursor: nc } = await api(
    `/transactions?limit=20&cursor=${nextCursor}` + filterQS + searchQS
  );
  append items; nextCursor = nc;   // nc === null → end
}
```

`FiltersSheet` maps 1:1 to query params
(`type,category,method,from,to`); the search box → `q`. Changing a filter or the
query = new request from `cursor` empty, replace the list.

---

## 9. States (already built)

- **Loading:** first paint of every data screen shows `<Skeleton/>` until its
  fetch resolves.
- **Empty:** endpoint returns `[]` → render `<EmptyState/>` (never blank).
- **Error:** fetch throws → the `StatesScreen` error visual + a Retry that
  refetches.
- **Offline:** treat a network throw like the error state.

---

## 10. Removing the dummy data

1. Delete every `import ... from '../services/seed'` (only `AppStore.tsx` has
   them per BACKEND.md).
2. Delete `src/services/seed.ts`.
3. Keep `src/services/types.ts`.
4. The reducer's initial state becomes **empty** (`transactions: []`, etc.) +
   `loading: true`; it fills from §5.
5. Grep for hardcoded numbers in screens (e.g. `Rs 27,724`) — there should be
   none; if any slipped in, point them at `useApp()`.

---

## 11. Locale / RTL

`/me.language` is `en | ur | ur-roman`. It drives copy and, for `ur`, RTL
(`I18nManager.forceRTL` + reload) — not implemented in the alpha, fine to defer
to late beta. Send it to `/ai/ask` as `locale` so answers match.

---

## 12. Account transfers (new — not in the alpha)

Move money between the user's own accounts (e.g. NayaPay → SadaPay). Recorded as
its own kind so it never touches `incomeThisMonth` / `expenseThisMonth` or
category analytics.

| Method | Path | Body / Query | Response |
| --- | --- | --- | --- |
| POST | `/transfers` | `{ fromAccountId, toAccountId, amount, date?, note? }` | `Transfer` (201) |
| GET | `/transfers` | `?cursor&limit&accountId` | `{ items: Transfer[], nextCursor }` |
| GET | `/transfers/:id` | — | `Transfer` |
| DELETE | `/transfers/:id` | — | `204` (reverses both balances) |

`Transfer` DTO:
```json
{
  "id": "…", "kind": "transfer",
  "fromAccountId": "…", "toAccountId": "…",
  "from": "NayaPay", "to": "SadaPay",
  "name": "NayaPay → SadaPay",
  "amount": 5000, "note": "savings",
  "icon": "card",
  "date": "2026-09-08T12:00:00.000Z",
  "dateLabel": "Today · 8 Sep", "time": "12:00 PM"
}
```

Errors (all `400`): `same_account`, `invalid_account` (not one of the user's),
`insufficient_funds` (from-balance < amount). The server moves both balances
atomically — refetch `/accounts` (or apply the delta) after a success.

### Store

```ts
// selector
transfers: Transfer[]

// action (optimistic)
async function transfer(fromId, toId, amount, note?) {
  const from = accountById(fromId), to = accountById(toId);
  patchAccount(fromId, { amount: from.amount - amount });
  patchAccount(toId,   { amount: to.amount + amount });
  try {
    const t = await api('/transfers', {
      method: 'POST',
      body: JSON.stringify({ fromAccountId: fromId, toAccountId: toId, amount, note }),
    });
    prependTransfer(t);
  } catch (e) {
    patchAccount(fromId, { amount: from.amount });   // rollback
    patchAccount(toId,   { amount: to.amount });
    toast(e.code === 'insufficient_funds' ? 'Not enough balance' : "Couldn't transfer");
  }
}
```

### Rendering

- **Activity feed:** merge `transfers` into the transaction list client-side
  (both carry `date` + `kind`); a transfer row is neutral (no +/− colour),
  shows `name` ("NayaPay → SadaPay") and `− / +` nothing, just the amount.
- **Account detail:** `GET /transfers?accountId=<id>` alongside that account's
  transactions; show `− amount` when `fromAccountId === id`, `+ amount` when
  `toAccountId === id`.
- Deleting a transfer (long-press → delete) calls `DELETE /transfers/:id` and
  refetches `/accounts`.

### Prompt for the app (paste to whoever builds the UI)

> Add an **account-to-account transfer** flow to the Khata+ app. The backend
> endpoint already exists:
> `POST {API_BASE}/transfers` with `{ fromAccountId, toAccountId, amount, date?, note? }`,
> returns a `Transfer` `{ id, kind:'transfer', from, to, name, amount, note, date, dateLabel, time }`.
> `GET {API_BASE}/transfers?accountId=` lists them; `DELETE {API_BASE}/transfers/:id` reverses it.
> 400 codes: `same_account`, `invalid_account`, `insufficient_funds`.
>
> UI, matching the app's existing Modernist visual language and bottom-sheet
> pattern (reuse the Add-expense sheet's structure, keypad, and Save button):
> 1. Entry points: a "Transfer" action on the **Accounts** screen header and on
>    each **Account detail** screen (pre-fills that account as "From").
> 2. Transfer sheet: **From** account picker, **To** account picker (both list
>    `useApp().accounts`, exclude the other selection), amount via the shared
>    keypad, optional note field, Save.
> 3. Validation before enabling Save: from ≠ to, amount > 0, amount ≤ from
>    balance (show "Not enough in <account>" inline).
> 4. On Save: call the store's `transfer()` action (optimistic — see store
>    snippet), close the sheet, toast "Moved Rs … · <from> → <to>", both account
>    balances update immediately on the Accounts screen.
> 5. Show transfers in the **Activity** list as a neutral row
>    ("NayaPay → SadaPay", amount, no red/green) by merging `useApp().transfers`
>    into the feed by date. On **Account detail**, show `−`/`+` depending on
>    direction.
> 6. Long-press a transfer row → "Delete transfer" confirm → `DELETE` + refetch
>    accounts.
> 7. Empty state on a transfers-only view: reuse `EmptyState` copy
>    ("No transfers yet").
> Do not create matching income/expense rows — a transfer is its own `kind`.

---

## 13. Per-screen done-check

- [ ] Splash → (token? Tabs : Welcome)
- [ ] Signup → Otp → Tabs; Login → Tabs; Forgot → 204 message; Google → Tabs
- [ ] Otp error view wired to the real 400 `attemptsLeft`
- [ ] Home: balance, this-month, budgets, owedToMe/iOwe all from API; FAB adds
      real expense; count-up animates once on the real value
- [ ] Activity: FlatList + cursor; filters + search hit query params; groups
- [ ] TxDetail: from `/transactions/:id`
- [ ] Khata: both tabs from `/udhaar`; summary totals; add udhaar
- [ ] Person: history from `/udhaar/:id`; Mark as paid → settle; Remind → sheet
- [ ] Goals/Budgets: lists + create; Home "All" deep-links to Budgets tab
- [ ] Bills/Accounts/Analytics/Notifications: real data + empty states
- [ ] AI: suggested + ask + follow-ups render `{lead,rows,tail,action}`
- [ ] Settings: appearance persists; language patches `/me`; logout → Splash
- [ ] Transfer sheet: From/To/amount, optimistic balance move, neutral Activity
      row, delete reverses both balances
- [ ] No `services/seed` import anywhere; a brand-new account has **zero** data —
      every screen shows its empty state until the user adds an account / entry
