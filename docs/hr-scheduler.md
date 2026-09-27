# HR scheduler

The clock does six pieces of HR work in this estate. Until `0363` nothing ran
them: the leave kernel could say what a policy had earned by a month, and the
ledger could say when a carried day expired, but no job ever asked either.

## The six jobs

| Job | What it writes | Claimed by |
|---|---|---|
| `leave.accrual` | The delta a leave policy has earned under `domain::schedule::accrual_due` — one `ACCRUAL` ledger entry per person, kind and month | `accrual:<employee>:<YYYY-MM>` |
| `leave.carry_forward_expiry` | The `EXPIRY` entry `LedgerTimeline::expiry_due` hands back on the policy's own expiry date | `expiry:<employee>:<YYYY-MM-DD>` |
| `roster.carry_forward` | Next week's plans, copied from the same weekday this week, only where a person has no plan yet | `roster:<YYYY-MM-DD>` (target Monday) |
| `nudge.contract_expiry` | A notification per contract crossing the six-week or two-week band, or already ended | `contract:<employee>:<ends_on>:<band>` |
| `nudge.period_close` | A notification per place whose previous month is still open | `period:<YYYY-MM>` |
| `nudge.roster_gap` | A notification per place with people still unplanned for next week | `roster_gap:<YYYY-MM-DD>` |

## Why a claim ledger

`0363` creates `scheduled_job_run (job, run_key, outcome, detail, started_at,
finished_at)` with a primary key on `(job, run_key)`. The period is the unit of
work — a month of accrual, a day of expiry, a week of roster — so "did March
accrue?" is answerable, and a worker racing for the same period loses rather
than double-accruing. A row whose `outcome` is `FAILED` is re-claimable on the
next tick; a `RAN` row is not.

## What is deliberately not a job

* **Attendance.** A punch is derived on read from the plan, the punches, the
  policy and the approvals. A job would have to store an outcome, which is the
  thing the attendance design refuses.
* **Roster generation.** The carry copies a plan a person already made. It
  never invents a shift for somebody who had none; that is what the gap nudge
  reports.
* **Leave encashment drafts.** Encashment is money, and money is a decision in
  Full & Final or its own route, not a blind monthly draft.
* **Employee book push.** Terminals pull.

## Surfaces

* `GET /api/v1/hr-scheduler/runs` — the run ledger, newest first. Admin.
* `POST /api/v1/hr-scheduler/run-now` — run the same pass for a business day,
  with a reason. The reason is written to the ledger under
  `hr-scheduler.manual`; the activity log keeps the request and not its body.
  Admin.
* `frontend-hub` → People · Setup · **Scheduler** — the ledger and the button.

The worker itself is `run_hr_scheduler` in `backend/src/bin/cloud.rs`. It ticks
hourly and calls `postgres::run_all(reporting::local_today())`; every job's
failure is caught and recorded, so one refused accrual does not stop the roster
being carried or the nudges being raised.
