import { useForm } from "@tanstack/react-form"
import { useMutation } from "@tanstack/react-query"
import { CircleAlert, Eye, EyeOff } from "lucide-react"
import { useRef, useState, type ReactNode } from "react"

import { Button } from "@/components/ui/button"
import { Field, Input } from "@/components/ui/field"
import { auth } from "@/lib/api"
import { cn } from "@/lib/utils"
import type { LoginResponse } from "@itulah/contract"
import { ApiError } from "@itulah/contract/client"

/// Sign-in for the CLOUD node.
///
/// Username and password, not email: the server's identities are usernames, and
/// an `<input type="email">` would refuse a valid operator name before the
/// request was ever made. There is no third-party sign-in and no self-service
/// sign-up — operators are provisioned by an administrator.
export function LoginForm({
  onSignedIn,
  /// A failure belonging to the session rather than to this form — a node that
  /// could not be reached at all.
  problem: sessionProblem = null,
  /// How to sign in, for a surface that talks to more than one node.
  ///
  /// Defaults to the cloud, which is what the app's own login screen wants.
  /// Operations passes the edge node's instead: the two backends keep separate
  /// accounts, and the form has no business knowing which one it is serving —
  /// only that a username and a password go somewhere and a session comes
  /// back. Storing whatever the answer carries is the caller's job.
  signIn: signInWith = (username: string, password: string) =>
    auth.login(username, password),
  /// What this box is the door to. Defaults to the centre.
  ///
  /// Said rather than implied, because the hub now has two doors and they look
  /// identical: an operator asked for a password in the middle of the
  /// warehouse screens, under a heading saying "Central Dashboard", would
  /// reasonably type the one they have already used — and be told it is wrong,
  /// by a machine they were not told they were talking to.
  title = "Central Dashboard",
  caption = "Sign in to the central dashboard.",
  /// A quiet line above the title, naming the place when the title is the
  /// act. A plain string normally — the sandbox door (`business-door.tsx`)
  /// passes a business name paired with a "Switch business" action instead.
  eyebrow,
  /// Said under the button: where to turn when the password is not known.
  footnote,
  titleOnPhone = true,
  className,
}: {
  onSignedIn: (session: LoginResponse) => void
  problem?: string | null
  signIn?: (username: string, password: string) => Promise<LoginResponse>
  title?: string
  caption?: string
  eyebrow?: ReactNode
  footnote?: ReactNode
  /// Whether the title and caption are drawn on a phone. The sign-in door
  /// turns them off: it has already said "Central." in the page's own header,
  /// and a second heading under it only pushes the fields down.
  titleOnPhone?: boolean
  className?: string
}) {
  const [revealed, setRevealed] = useState(false)
  const [capsLock, setCapsLock] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)

  /// The request, kept out of the form. "Busy" and "what went wrong" are facts
  /// about a request in flight and the mutation holds both; the form holds what
  /// was typed.
  const signIn = useMutation({
    mutationFn: (credentials: { username: string; password: string }) =>
      signInWith(credentials.username, credentials.password),
    onSuccess: onSignedIn,
    // A refusal is felt as well as read: the form gives a short shake, the
    // way a native password box says no. Played through the Web Animations
    // API so a second wrong password shakes again — a class that is already
    // on the element would not replay. Skipped when the person has asked for
    // less motion; the sentence under the fields still says it.
    onError: () => {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return
      formRef.current?.animate(
        [
          { transform: "none" },
          { transform: "translateX(-6px)" },
          { transform: "translateX(5px)" },
          { transform: "translateX(-3px)" },
          { transform: "translateX(2px)" },
          { transform: "none" },
        ],
        { duration: 360, easing: "cubic-bezier(0.23, 1, 0.32, 1)" }
      )
    },
  })

  const form = useForm({
    defaultValues: { username: "", password: "" },
    onSubmit: ({ value }) => signIn.mutate(value),
  })

  // The server's message is written for a person; repeating it is more use than
  // a generic failure. Anything else means we never reached it.
  //
  // Less the status it arrives prefixed with — "Unauthorized: invalid username
  // or password" is the HTTP reason phrase glued to the sentence, and the
  // person at the door only needs the sentence.
  const signInProblem =
    signIn.error === null
      ? null
      : signIn.error instanceof ApiError
        ? signIn.error.message.replace(
            /^(unauthorized|forbidden|bad request|too many requests):\s*/i,
            ""
          )
        : "could not reach the server"
  const problem = signInProblem ?? sessionProblem

  /// A refusal answers the last attempt, not the one being typed: it goes the
  /// moment either field changes, rather than standing under a password the
  /// person is already correcting.
  const clearRefusal = () => {
    if (signIn.isError) signIn.reset()
  }

  /// Caps Lock is the commonest reason a right password is refused, and the
  /// one the person cannot see: the field shows dots. Read from any key
  /// event on the password box, which is where the state is known.
  const readCapsLock = (event: React.KeyboardEvent<HTMLInputElement>) =>
    setCapsLock(event.getModifierState("CapsLock"))

  // Each block rises into place a beat after the one above it (`door-rise`).
  const rise = (i: number) => ({
    className: "door-rise",
    style: { "--i": i } as React.CSSProperties,
  })

  return (
    <div
      className={cn(
        "grid h-full place-items-center px-6 py-10 max-md:flex max-md:flex-col max-md:py-4",
        className
      )}
    >
      <form
        ref={formRef}
        onSubmit={(event) => {
          event.preventDefault()
          form.handleSubmit()
        }}
        className="w-full max-w-[22.5rem] max-md:flex max-md:max-w-none max-md:flex-1 max-md:flex-col"
      >
        <div {...rise(0)}>
          {eyebrow && (
            <p className="mb-2 text-[0.875rem] leading-5 font-medium text-body">
              {eyebrow}
            </p>
          )}
          <h1
            className={cn(
              "text-[1.75rem] leading-9 font-semibold tracking-[-0.025em] text-ink",
              !titleOnPhone && "max-md:hidden"
            )}
          >
            {title}
          </h1>
          <p
            className={cn(
              "mt-2 text-[0.9375rem] leading-6 text-body",
              !titleOnPhone && "max-md:hidden"
            )}
          >
            {caption}
          </p>
        </div>

        <div className="mt-8 flex flex-col gap-5 max-md:mt-6">
          <form.Field name="username">
            {(field) => (
              <div {...rise(1)}>
                <Field label="Username">
                  <Input
                    autoFocus
                    autoComplete="username"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => {
                      field.handleChange(event.target.value)
                      clearRefusal()
                    }}
                  />
                </Field>
              </div>
            )}
          </form.Field>

          <form.Field name="password">
            {(field) => (
              <div {...rise(2)}>
                <Field
                  label="Password"
                  hint={capsLock ? "Caps Lock is on." : undefined}
                >
                  <div className="relative">
                    <Input
                      type={revealed ? "text" : "password"}
                      autoComplete="current-password"
                      className="pr-12"
                      value={field.state.value}
                      onBlur={() => {
                        field.handleBlur()
                        setCapsLock(false)
                      }}
                      onKeyDown={readCapsLock}
                      onKeyUp={readCapsLock}
                      onChange={(event) => {
                        field.handleChange(event.target.value)
                        clearRefusal()
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => setRevealed((on) => !on)}
                      aria-label={revealed ? "Hide password" : "Show password"}
                      aria-pressed={revealed}
                      className="absolute top-1/2 right-1.5 grid size-9 -translate-y-1/2 place-items-center rounded-[0.4375rem] text-line-ico transition-colors hover:bg-soft-2 hover:text-text"
                    >
                      {revealed ? (
                        <EyeOff className="size-[1.125rem]" />
                      ) : (
                        <Eye className="size-[1.125rem]" />
                      )}
                    </button>
                  </div>
                </Field>
              </div>
            )}
          </form.Field>
        </div>

        {problem && (
          <p
            role="alert"
            className="mt-4 flex items-start gap-2 text-[0.875rem] leading-5 text-bad-fg"
          >
            <CircleAlert className="mt-0.5 size-4 shrink-0" />
            <span className="block first-letter:uppercase">{problem}</span>
          </p>
        )}

        <div
          {...rise(3)}
          className="door-rise max-md:sticky max-md:bottom-0 max-md:mt-auto max-md:bg-canvas max-md:pt-4 max-md:pb-[max(1.25rem,env(safe-area-inset-bottom))]"
        >
          <Button
            type="submit"
            variant="primary"
            size="lg"
            className="mt-7 w-full font-semibold max-md:mt-0 shadow-[inset_0_1px_0_rgb(255_255_255/16%),0_1px_2px_rgb(24_39_60/14%)]"
            pending={signIn.isPending}
          >
            {signIn.isPending ? "Signing in…" : "Sign in"}
          </Button>
          {footnote && (
            <p className="mt-6 text-[0.875rem] leading-5 text-body">
              {footnote}
            </p>
          )}
        </div>
      </form>
    </div>
  )
}
