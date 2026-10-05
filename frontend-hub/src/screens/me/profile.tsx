import { useForm } from "@tanstack/react-form"
import { Link } from "@tanstack/react-router"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { ApiError } from "@itulah/contract/client"
import { ChevronRight, KeyRound, LogOut } from "lucide-react"
import { useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Field } from "@/components/ui/field"
import { Sheet } from "@/components/ui/sheet"
import { Banner } from "@/components/ui/states"
import { cacheKey } from "@/lib/api"
import { changeOwnPassword } from "@/lib/queries/system"
import { useIdentity, useSignOut } from "@/lib/session"
import { Secret } from "@/screens/system/shared"
import { saying } from "@/screens/system/units"
import { useEssModules, useProfile } from "@/screens/me/data/queries"
import { moduleOf } from "@/screens/me/data/ess"
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
  const [changingPassword, setChangingPassword] = useState(false)
  const unbound =
    profile.error instanceof ApiError && profile.error.status === 404
  const me = identity.data
  const modules = useEssModules().data?.modules
  const records = meNav.sections[0].items.filter((item) => {
    if (item.hidden || item.path === "/me") return false
    const module = moduleOf(item.path)
    return module === null || modules === undefined || modules.includes(module)
  })

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
            <button
              type="button"
              onClick={() => setChangingPassword(true)}
              className={ROW}
            >
              <KeyRound className="size-[1.125rem] shrink-0 text-line-ico" />
              <span className="flex-1">Change password</span>
              <ChevronRight className="size-4 shrink-0 text-line-ico" />
            </button>
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
        <PasswordSheet
          open={changingPassword}
          onClose={() => setChangingPassword(false)}
        />
      </div>
    </PageContent>
  )
}

/// Changing your own password — moved here from the old System › Account
/// screen on 2026-09-27, when that screen's admin half became "Users &
/// roles" and this, the personal half, followed the avatar to `/me` instead:
/// it was never a department of the business.
///
/// The server clears the session cookie in the same response, so succeeding
/// is what signs you out. The screen says that before it asks, and then waits
/// for an acknowledgement rather than snapping to the login box mid-sentence.
///
/// The confirmation field only ever answers "do these two differ": it is
/// compared, never displayed, and there is deliberately no reveal control on
/// any of the three.
interface PasswordDraft {
  current: string
  next: string
  again: string
}

function mismatched(draft: PasswordDraft): boolean {
  return draft.again !== "" && draft.again !== draft.next
}

function passwordReady(draft: PasswordDraft): boolean {
  return draft.current !== "" && draft.next !== "" && !mismatched(draft)
}

function PasswordSheet({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const client = useQueryClient()

  const change = useMutation({
    // Wrapped rather than passed by reference: v5 hands a mutation context as
    // the second argument, which is not the `AbortSignal` the fetcher expects.
    mutationFn: (draft: { current: string; next: string }) =>
      changeOwnPassword({
        current_password: draft.current,
        new_password: draft.next,
      }),
    // All three fields, immediately. Nothing on this screen ever reads a
    // password back — not the receipt, not an error — so the draft is the
    // only copy and it does not outlive the request.
    onSuccess: () => form.reset(),
  })

  const form = useForm({
    defaultValues: { current: "", next: "", again: "" },
    onSubmit: ({ value }) =>
      change.mutate({ current: value.current, next: value.next }),
  })

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title="Change your password"
      footer={
        change.isSuccess ? (
          <div className="flex justify-end">
            <Button
              onClick={() => {
                // The cookie is already gone; dropping the cached identity is
                // what puts the login box back. Not a second logout request —
                // there is no session left to end.
                void client.invalidateQueries({ queryKey: cacheKey.me() })
              }}
            >
              Sign in again
            </Button>
          </div>
        ) : (
          <div className="flex justify-end gap-2">
            <Button variant="quiet" onClick={onClose}>
              Cancel
            </Button>
            <form.Subscribe selector={(state) => passwordReady(state.values)}>
              {(ready) => (
                <Button
                  pending={change.isPending}
                  disabled={!ready}
                  onClick={() => form.handleSubmit()}
                >
                  {change.isPending ? "Changing…" : "Change password"}
                </Button>
              )}
            </form.Subscribe>
          </div>
        )
      }
    >
      {change.isSuccess ? (
        <Banner tone="ok">
          Your password is changed, and every session standing on the old one
          has ended — including this browser's.
        </Banner>
      ) : (
        <form
          // The button is in the sheet's footer, outside this element, so its
          // disabled state cannot block an Enter keypress — and a mismatched
          // confirmation must not be able to reach the server.
          onSubmit={(event) => {
            event.preventDefault()
            if (passwordReady(form.state.values) && !change.isPending) {
              form.handleSubmit()
            }
          }}
          className="flex flex-col gap-3.5"
        >
          <p className="text-[0.875rem] text-body">
            You will be signed out when this succeeds. Every other session of
            yours ends too.
          </p>
          <form.Field name="current">
            {(field) => (
              <Field label="Current password" required>
                <Secret
                  autoComplete="current-password"
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
              </Field>
            )}
          </form.Field>
          <form.Field name="next">
            {(field) => (
              <Field
                label="New password"
                required
                hint="At least 8 characters."
              >
                <Secret
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
              </Field>
            )}
          </form.Field>
          <form.Subscribe selector={(state) => mismatched(state.values)}>
            {(mismatch) => (
              <form.Field name="again">
                {(field) => (
                  <Field
                    label="New password again"
                    // Says that they differ and nothing more. Neither value is
                    // ever shown back, here or anywhere else on this screen.
                    problem={mismatch ? "The two do not match." : undefined}
                  >
                    <Secret
                      value={field.state.value}
                      onChange={(event) =>
                        field.handleChange(event.target.value)
                      }
                    />
                  </Field>
                )}
              </form.Field>
            )}
          </form.Subscribe>

          {change.isError && <Banner tone="bad">{saying(change.error)}</Banner>}
        </form>
      )}
    </Sheet>
  )
}
