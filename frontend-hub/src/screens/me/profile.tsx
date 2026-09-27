import { Link } from "@tanstack/react-router"
import { ApiError } from "@itulah/contract/client"
import { ChevronRight, KeyRound, LogOut } from "lucide-react"

import { PageContent } from "@/components/shell/app-shell"
import { useIdentity, useSignOut } from "@/lib/session"
import { useProfile } from "@/screens/me/data/queries"
import { Home } from "@/screens/me/home"
import { meNav } from "@/screens/me/nav"

const ROLE: Record<string, string> = {
  CASHIER: "Cashier",
  SUPERVISOR: "Supervisor",
  ADMIN: "Admin",
}

/// The Profile tab: the employee's own day, their records, and the account.
///
/// The top is what `frontend-employee` opened on — the greeting, what is
/// waiting (a checklist, overtime to agree to), today's hours, leave left,
/// the next holiday, the latest pay. Below it, every record of theirs one tap
/// away, and last the account itself.
///
/// A login that is not bound to an employment record (an admin, a service
/// account) has no records to show: every `/employees/me/*` answers 404. It
/// gets the account and one sentence saying why the rest is missing, rather
/// than a screen of failures.
export function Profile() {
  const identity = useIdentity()
  const signOut = useSignOut()
  const profile = useProfile()
  const unbound =
    profile.error instanceof ApiError && profile.error.status === 404
  const me = identity.data
  const records = meNav.sections[0].items.filter(
    (item) => !item.hidden && item.path !== "/me"
  )

  const GROUP =
    "overflow-hidden rounded-2xl border border-hairline bg-canvas shadow-soft"
  const ROW =
    "flex min-h-12 w-full items-center gap-3 px-4 text-left text-[0.9375rem] text-ink transition-colors active:bg-soft-2 [&+&]:border-t [&+&]:border-hairline"

  return (
    <PageContent>
      <div className="mx-auto flex max-w-2xl flex-col gap-6">
        {unbound ? (
          <div className="rounded-2xl border border-dashed border-hairline-strong px-5 py-6 text-[0.875rem] leading-relaxed text-body">
            <b className="block text-[1.0625rem] font-semibold text-ink">
              {me?.display_name ?? me?.username}
            </b>
            This account is not linked to an employee record, so there is no
            attendance, leave or pay to show here. HR links a login to its
            record.
          </div>
        ) : (
          <>
            <Home />
            <section>
              <h2 className="mb-2.5 px-1 text-[0.9375rem] font-semibold tracking-[-0.01em] text-ink">
                Your records
              </h2>
              <nav aria-label="Your records" className={GROUP}>
                {records.map((item) => (
                  <Link key={item.path} to={item.path} className={ROW}>
                    <item.icon className="size-[1.125rem] shrink-0 text-line-ico" />
                    <span className="flex-1">{item.label}</span>
                    <ChevronRight className="size-4 shrink-0 text-line-ico" />
                  </Link>
                ))}
              </nav>
            </section>
          </>
        )}

        <section>
          <h2 className="mb-2.5 px-1 text-[0.9375rem] font-semibold tracking-[-0.01em] text-ink">
            Account
          </h2>
          <div className={GROUP}>
            <div className={`${ROW} pointer-events-none`}>
              <span className="grid size-9 shrink-0 place-items-center rounded-full bg-linear-to-br from-avatar-from to-avatar-to text-[0.875rem] font-semibold text-ink">
                {(me?.display_name ?? me?.username ?? "?")
                  .trim()
                  .charAt(0)
                  .toUpperCase()}
              </span>
              <span className="min-w-0 flex-1">
                <b className="block truncate font-medium">
                  {me?.display_name ?? me?.username}
                </b>
                <span className="block truncate text-meta text-mute">
                  {me?.username}
                  {me?.role !== undefined && ` · ${ROLE[me.role] ?? me.role}`}
                </span>
              </span>
            </div>
            <Link to={"/system/account" as string} className={ROW}>
              <KeyRound className="size-[1.125rem] shrink-0 text-line-ico" />
              <span className="flex-1">Account & password</span>
              <ChevronRight className="size-4 shrink-0 text-line-ico" />
            </Link>
            <button
              type="button"
              onClick={() => signOut.mutate()}
              disabled={signOut.isPending}
              className={`${ROW} text-bad-fg disabled:opacity-50`}
            >
              <LogOut className="size-[1.125rem] shrink-0" />
              <span className="flex-1">
                {signOut.isPending ? "Signing out…" : "Sign out"}
              </span>
            </button>
          </div>
        </section>
      </div>
    </PageContent>
  )
}
