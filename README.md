# Shiftly

Multi-tenant workforce attendance for small teams. Staff clock in by scanning a
daily QR code at the workplace; managers get accurate hours, breaks, tasks,
time off and an earnings estimate.

Mobile-first, installable as a PWA, one app and one database.

---

## What works today

Phase 1 of the specification is implemented end to end:

| Area | Status |
|---|---|
| Email/password auth, verification, password reset | Done |
| Organization creation, settings, multi-org membership | Done |
| Invitations (link + email-bound, revocable, usage limits) | Done |
| Clocking station with daily QR, fullscreen display | Done |
| QR scan → confirm → clock in/out, server-validated | Done |
| Live shift timer (survives refresh, corrects device clock drift) | Done |
| Breaks: automatic deduction, manual start/end, or none | Done |
| Attendance history, corrections with audit trail | Done |
| Timesheet review and approval | Done |
| Tasks: create, assign, track | Done |
| Time off: request, approve/reject, notifications | Done |
| Earnings estimate with historical pay rates, CSV export | Done |
| Row Level Security on every table | Done |

**Not built** (Phase 3 in the spec): rotating short-lived QR codes, geolocation
checks, NFC, scheduling, overtime rules, offline capture, SMS/WhatsApp,
subscription billing.

---

## Setup

### 1. Install

```bash
npm install
```

### 2. Create a Supabase project

At [supabase.com](https://supabase.com). From **Project Settings → API** copy
the project URL, the `anon` key and the `service_role` key.

### 3. Configure

```bash
cp .env.example .env
```

Fill in the Supabase values, then generate a token secret:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Put that in `QR_TOKEN_SECRET`. Until the required variables are set, the app
serves `/setup-required` and names exactly what is missing — it does not start
in a half-working state.

### 4. Apply the database schema

With the Supabase CLI:

```bash
supabase link --project-ref <your-ref>
supabase db push
```

Without it, generate one file and paste it into the SQL editor in the Supabase
dashboard:

```bash
node scripts/db-apply.mjs > schema.sql
```

Order matters; the script concatenates the migrations correctly.

### 5. Run

```bash
npm run dev
```

---

## First run

1. Sign up — you become the owner.
2. Create your organization (timezone and currency are yours to choose).
3. Pick a break policy and name your first station.
4. Go to **Invitations**, create a link, send it to someone.
5. Open **Station** and put it on a phone or tablet at the door.
6. They scan, confirm, and the timer starts.

---

## Commands

```bash
npm run dev        # dev server
npm run build      # production build
npm run check      # typecheck (svelte-check)
npm test           # all tests
npm run test:unit  # pure domain logic only (fast)
npm run test:db    # database tests against in-process Postgres
```

---

## Tests

161 tests, no Docker and no Supabase instance required.

- **`tests/domain`** — pure logic: timezone and DST arithmetic, break
  deduction, money (integer minor units, never floats), token derivation, CSV
  escaping, rate limiting, form validation.
- **`tests/db`** — the real migrations applied to
  [PGlite](https://pglite.dev) (Postgres compiled to WASM), exercised through
  the `authenticated` role with a real subject claim. This is the same path a
  request from a browser takes, so RLS, column grants and constraints are all
  genuinely under test.
- **`tests/db/parity.test.ts`** — the TypeScript break arithmetic and the SQL
  break arithmetic are two implementations of one rule. This compares them
  across nine scenarios so they cannot drift.

---

## How it is put together

```
src/lib/domain/     pure logic, no I/O, heavily tested
src/lib/server/     Supabase clients, email, reports, rate limiting
src/lib/schemas/    Zod validation, shared by every form action
src/routes/         pages and server actions
supabase/migrations/ schema, functions, RLS policies, grants
```

### Design decisions worth knowing

**Attendance mutations live in SQL.** `clock_in_with_token`, `clock_out_*`,
`start_break`, `end_break` are PL/pgSQL functions. Each runs in its own
transaction with the server's clock, so timestamps cannot come from a client
and validation cannot be skipped. A partial unique index
(`shifts_one_active_per_membership`) makes two concurrent clock-ins physically
unable to create two open shifts — that is a database guarantee, not
application sequencing.

**Daily QR tokens are derived, not stored.**
`HMAC-SHA256(QR_TOKEN_SECRET, "<station>:<local date>")`. The server recomputes
today's code on demand, so there is no nightly job, and the database holds only
a SHA-256 hash. Rotating the secret invalidates every outstanding code.

**Two Supabase clients.** Requests use a cookie-bound client subject to RLS.
The service-role client is used only where a user legitimately cannot see the
row yet (validating an invitation before joining) or for infrastructure
(email delivery state). The service key never reaches the browser.

**Money is integer minor units.** No float arithmetic touches a monetary
total. Minutes are bucketed per pay rate and converted once per bucket, so a
mid-period rate change cannot accumulate rounding drift.

**Approved history is immutable.** Clock-out freezes gross, break and payable
minutes onto the shift along with a snapshot of the policy used. Changing the
break policy later cannot silently rewrite what a past shift was worth.
Corrections are recorded in `attendance_adjustments` with before/after values
and a reason; the original clock events are never edited.

---

## Honest limitations

**A daily QR code is not proof of presence.** It can be photographed and
shared. Every scan is validated server-side and yesterday's code stops working
at local midnight, but within a day this is a convenience mechanism. The UI
says so rather than implying otherwise. Short-lived rotating codes and optional
location checks are the intended answer.

**Earnings are an estimate, not payroll.** No taxes, statutory deductions,
benefits or overtime. Shiftly never moves money.

**Rate limiting is per-instance.** In-memory counters, so on serverless each
cold instance keeps its own. It raises the cost of credential stuffing and
token guessing; it is not a hard guarantee. A shared store (Redis/Upstash) is
the natural upgrade.

**Email requires configuration.** Without `RESEND_API_KEY` the app uses a
development adapter that logs the message and records the delivery as
*failed* — it does not claim to have sent mail it did not send. In-app
notifications work regardless, and a provider outage never rolls back the
request or decision that triggered the email.

**No schedules, so no "late" or "absent".** The dashboard says "not clocked
in" and nothing stronger, because without expected working hours any stronger
claim would be invented.

**`npm audit` reports a low-severity `cookie` advisory** nested inside
SvelteKit 2. It only resolves by upgrading to SvelteKit 3 (see below). It
concerns out-of-bounds characters in cookie name/path/domain, none of which
this app sets from user input.

---

## Stack

SvelteKit 2 · Svelte 5 (runes) · TypeScript · Tailwind CSS 4 · Supabase
(Postgres + Auth + RLS) · Zod · Vitest · PGlite

### Why SvelteKit 2 rather than 3

SvelteKit 3 requires Vite 8, which uses `rolldown`. On the development machine
this was built on, Windows **Smart App Control** blocks rolldown's unsigned
native binary, so Vite 8 cannot run at all. Vite 7 (Rollup + esbuild) is
unaffected.

If your machine does not have Smart App Control enforcing, upgrading is
mostly mechanical: `svelte.config.js` merges into `vite.config.ts`, and the
`$lib` alias becomes `#lib`.

**Do not disable Smart App Control to work around this.** Once turned off it
can only be re-enabled by reinstalling Windows.

## Deploying

`adapter-auto` detects most platforms. For Vercel, pin it explicitly:

```bash
npm i -D @sveltejs/adapter-vercel
```

Then swap the import in `svelte.config.js`. Set the same environment variables
in the platform's dashboard — particularly `QR_TOKEN_SECRET`, which must be
stable across deployments or every station code changes.
