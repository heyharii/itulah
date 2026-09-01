import { auth } from "@/lib/api"
import { cn } from "@/lib/utils"
import type { LoginResponse } from "@itulah/contract"
import { ApiError } from "@itulah/contract/client"
import { useForm } from "@tanstack/react-form"
import { useMutation } from "@tanstack/react-query"
import { AlertCircle, Eye, EyeOff, Lock, User } from "lucide-react"
import { useState } from "react"

/// Sign-in for the CLOUD node.
///
/// Username and password, not email: the server's identities are usernames
/// (`backend/src/cloud/postgres/users.rs` lower-cases and matches on one), and
/// an `<input type="email">` would refuse a perfectly valid operator name
/// before the request was ever made. There is no third-party sign-in to offer
/// and no self-service sign-up — operators are provisioned by an administrator.
///
/// This is the first screen migrated to the Cloud Hub language, and it is the
/// right one to start with: it shares no chrome with the rest of the app, so
/// nothing else can be broken by getting it wrong. The `data-cloudhub`
/// attribute scopes the token block; phase 01 moves those tokens to `:root`
/// and this attribute goes away.
export function LoginForm({
  onSignedIn,
  /// A failure that belongs to the session, not to this form — a node that
  /// cannot be reached, a session that lapsed for a reason worth naming.
  problem: sessionProblem = null,
  /// Which node this console is talking to. Worth showing before anybody
  /// types: signing into the wrong node is a mistake you want to catch early.
  node = null,
  className,
  ...props
}: React.ComponentProps<"div"> & {
  onSignedIn: (session: LoginResponse) => void
  problem?: string | null
  node?: { node_id: string; node_role: string; site_id?: string } | null
}) {
  const [revealed, setRevealed] = useState(false)

  /// The request, kept out of the form.
  ///
  /// "Busy" and "what went wrong" are facts about a request in flight, and the
  /// mutation already holds both. The form holds what was typed.
  const signIn = useMutation({
    mutationFn: (credentials: { username: string; password: string }) =>
      auth.login(credentials.username, credentials.password),
    onSuccess: onSignedIn,
  })

  const form = useForm({
    defaultValues: { username: "", password: "" },
    onSubmit: ({ value }) => {
      signIn.mutate(value)
    },
  })

  // The server's message is written for a person; repeating it is more use
  // than a generic failure. Anything else means we never reached it.
  const signInProblem =
    signIn.error === null
      ? null
      : signIn.error instanceof ApiError
        ? signIn.error.message
        : "could not reach the server"

  // One alert, not two stacked in different places. A sign-in failure is the
  // more specific answer, so it wins when both are present.
  const problem = signInProblem ?? sessionProblem

  return (
    <div
      data-cloudhub
      className={cn(
        "flex min-h-svh w-full bg-[var(--os-canvas)] text-[var(--os-ink)]",
        className
      )}
      {...props}
    >
      {/* The illustrated half. Hidden below lg — a phone gets the form and
          nothing competing with it. */}
      <section className="relative hidden flex-1 flex-col items-center justify-center border-r border-[var(--os-hairline)] bg-[var(--os-soft)] px-14 py-12 lg:flex">
        <StorefrontMark />
        <div className="mt-9 max-w-[380px] text-center">
          <h2 className="text-[19px] font-semibold tracking-[-0.02em]">
            One counter, every store.
          </h2>
          <p className="mt-2 text-[13.5px] leading-relaxed text-[var(--os-body)]">
            Catalogue, stock, receiving, cash and the ledger — every site
            reconciled on the same set of books.
          </p>
        </div>
      </section>

      {/* The form half. */}
      <section className="flex flex-1 flex-col px-8 py-8 sm:px-12">
        <div className="flex items-center gap-2.5">
          <span className="grid size-7 place-items-center rounded-[7px] bg-[var(--os-dark)] text-[13px] font-semibold text-white">
            i
          </span>
          <span className="text-[14.5px] font-semibold tracking-[-0.015em]">
            Itulah Console
          </span>
        </div>

        <div className="flex flex-1 items-center justify-center py-10">
          <form
            className="w-full max-w-[352px]"
            onSubmit={(event) => {
              event.preventDefault()
              void form.handleSubmit()
            }}
          >
            <h1 className="text-[26px] font-semibold tracking-[-0.025em]">
              Sign in
            </h1>
            <p className="mt-1.5 text-[13.5px] text-[var(--os-body)]">
              Head office console.
            </p>

            <form.Field name="username">
              {(field) => (
                <div className="mt-5">
                  <label
                    htmlFor={field.name}
                    className="mb-1.5 block text-[12.5px] font-medium text-[var(--os-text)]"
                  >
                    Username
                  </label>
                  <div className="flex h-10 items-center gap-2.5 rounded-[var(--os-r-inner)] border border-[var(--os-hairline-2)] bg-white px-3 transition-colors focus-within:border-[var(--os-ink)] focus-within:ring-[3px] focus-within:ring-[var(--os-soft-2)]">
                    <User
                      className="size-4 shrink-0 text-[var(--os-line-ico)]"
                      strokeWidth={1.6}
                      aria-hidden
                    />
                    <input
                      id={field.name}
                      name={field.name}
                      autoComplete="username"
                      autoFocus
                      required
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(event) => field.handleChange(event.target.value)}
                      className="w-full bg-transparent text-[14px] outline-none placeholder:text-[var(--os-mute)]"
                    />
                  </div>
                </div>
              )}
            </form.Field>

            <form.Field name="password">
              {(field) => (
                <div className="mt-4">
                  <label
                    htmlFor={field.name}
                    className="mb-1.5 block text-[12.5px] font-medium text-[var(--os-text)]"
                  >
                    Password
                  </label>
                  <div className="flex h-10 items-center gap-2.5 rounded-[var(--os-r-inner)] border border-[var(--os-hairline-2)] bg-white pr-1.5 pl-3 transition-colors focus-within:border-[var(--os-ink)] focus-within:ring-[3px] focus-within:ring-[var(--os-soft-2)]">
                    <Lock
                      className="size-4 shrink-0 text-[var(--os-line-ico)]"
                      strokeWidth={1.6}
                      aria-hidden
                    />
                    <input
                      id={field.name}
                      name={field.name}
                      type={revealed ? "text" : "password"}
                      autoComplete="current-password"
                      required
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(event) => field.handleChange(event.target.value)}
                      className="w-full bg-transparent text-[14px] outline-none placeholder:text-[var(--os-mute)]"
                    />
                    <button
                      type="button"
                      onClick={() => setRevealed((shown) => !shown)}
                      aria-label={revealed ? "Hide password" : "Show password"}
                      className="grid size-7 shrink-0 place-items-center rounded-[7px] text-[var(--os-line-ico)] transition-colors hover:bg-[var(--os-soft-2)] hover:text-[var(--os-text)]"
                    >
                      {revealed ? (
                        <EyeOff className="size-4" strokeWidth={1.6} />
                      ) : (
                        <Eye className="size-4" strokeWidth={1.6} />
                      )}
                    </button>
                  </div>
                </div>
              )}
            </form.Field>

            {problem !== null && (
              <p
                role="alert"
                className="mt-4 flex items-start gap-2 rounded-[var(--os-r-inner)] bg-[var(--os-bad-bg)] px-3 py-2.5 text-[12.5px] leading-snug text-[var(--os-bad)]"
              >
                <AlertCircle className="mt-px size-4 shrink-0" strokeWidth={1.9} />
                {problem}
              </p>
            )}

            <button
              type="submit"
              disabled={signIn.isPending}
              className="mt-5 h-10 w-full rounded-full bg-[var(--os-dark)] text-[14px] font-medium text-white transition-colors hover:bg-black disabled:opacity-60"
            >
              {signIn.isPending ? "Signing in…" : "Sign in"}
            </button>

            <p className="mt-4 text-center text-[12.5px] text-[var(--os-body)]">
              Accounts are issued by an administrator.
            </p>
          </form>
        </div>

        <div className="flex items-center gap-3 text-[12px] text-[var(--os-mute)]">
          {node !== null && (
            <span className="font-[family-name:var(--os-mono)]">
              {node.node_id} · {node.node_role}
              {node.site_id === undefined ? "" : ` · ${node.site_id}`}
            </span>
          )}
        </div>
      </section>
    </div>
  )
}

/// The one illustration in the system: a shopkeeper behind a counter, drawn in
/// a single stroke weight. Two depths only — the figure in `{ink}`, the props
/// in `{line-ico}` — so the eye lands on the figure first.
function StorefrontMark() {
  return (
    <svg
      viewBox="0 0 420 400"
      role="img"
      aria-label="A shopkeeper behind a store counter"
      className="w-full max-w-[420px] text-[var(--os-ink)]"
    >
      <g fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
        {/* awning */}
        <g stroke="var(--os-line-ico)" strokeWidth="2" transform="translate(0 -22)">
          <path d="M52 84 L74 40 H346 L368 84 Z" />
          <path d="M52 84 q13 13 26 0 q13 13 26 0 q13 13 26 0 q13 13 26 0 q13 13 26 0 q13 13 26 0 q13 13 26 0 q13 13 26 0 q13 13 26 0 q13 13 26 0 q13 13 26 0 q13 13 26 0" />
          <path d="M118 40 L104 84 M162 40 L156 84 M206 40 L206 84 M250 40 L256 84 M294 40 L308 84" />
        </g>

        {/* hanger */}
        <g stroke="var(--os-line-ico)" strokeWidth="2">
          <path d="M60 132 v-7 a7 7 0 0 1 14 0" />
          <path d="M67 132 L38 156 h58 Z" />
        </g>

        {/* hang tag with barcode */}
        <g stroke="var(--os-line-ico)" strokeWidth="2" transform="rotate(12 356 146)">
          <path d="M334 124 h44 a6 6 0 0 1 6 6 v46 a6 6 0 0 1 -6 6 h-44 a6 6 0 0 1 -6 -6 v-46 a6 6 0 0 1 6 -6 Z" />
          <circle cx="342" cy="136" r="3.4" />
          <path d="M336 152 v16 M341 152 v16 M345 152 v16 M350 152 v16 M354 152 v16 M359 152 v16 M365 152 v16 M370 152 v16 M375 152 v16" />
          <path d="M328 128 L308 112" />
        </g>

        {/* the shopkeeper */}
        <g transform="translate(116 66) scale(1.86)">
          <g stroke="currentColor" strokeWidth="1.95">
            <path d="M31 17 C27 6 41 5 42 16" />
            <path d="M69 17 C73 6 59 5 58 16" />
            <path d="M50 8 C30 8 20 21 20 39 C20 54 31 63 50 63 C69 63 80 54 80 39 C80 21 70 8 50 8 Z" />
            <circle cx="36" cy="37" r="13" />
            <circle cx="64" cy="37" r="13" />
            <path d="M47 49 L50 53 L53 49" />
            <path d="M44 57 Q50 62 56 57" />
            <path d="M30 64 C26 82 30 103 50 103 C70 103 74 82 70 64" />
            <path d="M41 73 h18 a4 4 0 0 1 4 4 v13 a4 4 0 0 1 -4 4 h-18 a4 4 0 0 1 -4 -4 v-13 a4 4 0 0 1 4 -4 Z" />
            <path d="M46 73 l4 4 l4 -4" />
            <path d="M37 82 h26" />
            <path d="M35 77 q-4 3 1 8" />
            <path d="M65 77 q4 3 -1 8" />
            <path d="M70 94 C86 96 90 76 80 70" />
          </g>
          <g fill="currentColor" stroke="none">
            <circle cx="37" cy="39" r="5" />
            <circle cx="63" cy="39" r="5" />
          </g>
        </g>

        {/* counter — filled, so it occludes the figure's lower half */}
        <g stroke="currentColor" strokeWidth="2.2" fill="var(--os-soft)">
          <path d="M34 268 h352 a7 7 0 0 1 7 7 v6 a7 7 0 0 1 -7 7 h-352 a7 7 0 0 1 -7 -7 v-6 a7 7 0 0 1 7 -7 Z" />
          <path d="M52 288 h316 v70 h-316 Z" />
        </g>
        <g stroke="var(--os-line-ico)" strokeWidth="1.8">
          <path d="M148 288 v70 M272 288 v70" />
          <path d="M76 316 h48 M296 316 h48" />
        </g>

        {/* carton */}
        <g stroke="currentColor" strokeWidth="2" fill="var(--os-soft)">
          <path d="M62 226 h72 v42 h-72 Z" />
          <path d="M62 226 l14 -14 h72 l-14 14" />
          <path d="M134 226 l14 -14 v42 l-14 14" />
        </g>
        <g stroke="var(--os-line-ico)" strokeWidth="1.8">
          <path d="M98 226 v42" />
          <path d="M84 244 h28" />
        </g>

        {/* folded stack */}
        <g stroke="currentColor" strokeWidth="2" fill="var(--os-soft)">
          <path d="M288 254 h74 a4 4 0 0 1 4 4 v6 a4 4 0 0 1 -4 4 h-74 a4 4 0 0 1 -4 -4 v-6 a4 4 0 0 1 4 -4 Z" />
          <path d="M292 240 h74 a4 4 0 0 1 4 4 v6 a4 4 0 0 1 -4 4 h-74 a4 4 0 0 1 -4 -4 v-6 a4 4 0 0 1 4 -4 Z" />
          <path d="M288 226 h74 a4 4 0 0 1 4 4 v6 a4 4 0 0 1 -4 4 h-74 a4 4 0 0 1 -4 -4 v-6 a4 4 0 0 1 4 -4 Z" />
        </g>
        <g stroke="var(--os-line-ico)" strokeWidth="1.7">
          <path d="M310 226 v14 M314 240 v14 M310 254 v14" />
        </g>

        <path d="M8 358 h404" stroke="var(--os-faint)" strokeWidth="2" />
      </g>
    </svg>
  )
}
