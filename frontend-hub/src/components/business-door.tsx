import { useMutation } from "@tanstack/react-query"
import { Building2, Eye, EyeOff, KeySquare } from "lucide-react"
import { useState, type CSSProperties } from "react"

import { Button } from "@/components/ui/button"
import { Field, Input } from "@/components/ui/field"
import { Problem } from "@/components/ui/states"
import { auth } from "@/lib/api"
import {
  createBusiness,
  selectBusiness,
  useLeaveBusiness,
  type TenancyBusiness,
} from "@/lib/tenancy"
import { cn } from "@/lib/utils"
import type { LoginResponse } from "@itulah/contract"

/// The sandbox door — everything shown before a business is chosen, or beside
/// the sign-in form once one is. Not a route: like `LoginForm` and
/// `Onboarding`, it stands in front of the app rather than inside it, so it
/// is only ever mounted from `App.tsx`, inside `<SignInDoor>`.

/// Each block rises into place a beat after the one above it, the same
/// `door-rise` stagger `LoginForm` uses — the two hand off to each other
/// mid-animation on a sandbox server, and a door that suddenly changed its
/// manners would be noticed.
function rise(i: number): CSSProperties {
  return { "--i": i } as CSSProperties
}

/// The quiet way out of a business, wherever it is offered — above the
/// sign-in form when one is already chosen, and beside the name in the
/// signed-in shell's own account screen (`screens/me/profile.tsx`).
export function SwitchBusinessAction({ className }: { className?: string }) {
  const leave = useLeaveBusiness()
  return (
    <button
      type="button"
      onClick={() => leave.mutate()}
      disabled={leave.isPending}
      className={cn(
        "text-body underline-offset-2 transition-colors hover:text-ink hover:underline disabled:opacity-60",
        className
      )}
    >
      {leave.isPending ? "Switching…" : "Switch business"}
    </button>
  )
}

/// What `LoginForm`'s `eyebrow` shows once a sandbox business is selected:
/// which one, and a way to leave it. Replaces the plain string every other
/// caller passes.
export function BusinessEyebrow({ business }: { business: TenancyBusiness }) {
  return (
    <span className="flex flex-wrap items-baseline gap-x-2">
      <span>{business.name}</span>
      <SwitchBusinessAction className="text-[0.875rem]" />
    </span>
  )
}

/// No business chosen yet: two ways in. Same frame as `LoginForm` — centred,
/// `22.5rem` wide — so a sandbox server's extra step does not look like a
/// different app from the one either path leads into.
export function BusinessChooser({
  inviteRequired,
  onSelected,
  onCreated,
  className,
}: {
  inviteRequired: boolean
  /// A business code was accepted. `App` re-reads tenancy and the ordinary
  /// sign-in form — with this business named above it — takes over.
  onSelected: () => void
  /// A business was just created, and its owner is already signed in.
  onCreated: (session: LoginResponse) => void
  className?: string
}) {
  const [stage, setStage] = useState<"choose" | "code" | "create">("choose")

  if (stage === "create") {
    return (
      <CreateBusinessForm
        inviteRequired={inviteRequired}
        onBack={() => setStage("choose")}
        onDone={onCreated}
        className={className}
      />
    )
  }

  if (stage === "code") {
    return (
      <BusinessCodeForm
        onBack={() => setStage("choose")}
        onSelected={onSelected}
        className={className}
      />
    )
  }

  return (
    <div className={cn("grid h-full place-items-center px-6 py-10", className)}>
      <div className="w-full max-w-[22.5rem]">
        <div className="door-rise" style={rise(0)}>
          <h1 className="text-[1.75rem] leading-9 font-semibold tracking-[-0.025em] text-ink">
            Welcome
          </h1>
          <p className="mt-2 text-[0.9375rem] leading-6 text-body">
            This server holds more than one business. Pick one to sign in to, or
            set up a new one.
          </p>
        </div>
        <div className="mt-8 flex flex-col gap-3">
          <ChooserOption
            icon={Building2}
            label="Create a business"
            note="Set up a new one to try."
            onClick={() => setStage("create")}
            style={rise(1)}
          />
          <ChooserOption
            icon={KeySquare}
            label="I have a business code"
            note="Sign in to a business you already use."
            onClick={() => setStage("code")}
            style={rise(2)}
          />
        </div>
      </div>
    </div>
  )
}

function ChooserOption({
  icon: Icon,
  label,
  note,
  onClick,
  style,
}: {
  icon: typeof Building2
  label: string
  note: string
  onClick: () => void
  style?: CSSProperties
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={style}
      className="door-rise flex items-center gap-3.5 rounded-card border border-hairline-2 bg-canvas px-4 py-4 text-left transition-colors hover:border-hairline-strong hover:bg-soft"
    >
      <span className="grid size-10 shrink-0 place-items-center rounded-full bg-soft-2 text-line-ico">
        <Icon className="size-[1.125rem]" />
      </span>
      <span className="min-w-0 flex-1">
        <b className="block text-[0.9375rem] font-medium text-ink">{label}</b>
        <span className="block text-[0.875rem] text-body">{note}</span>
      </span>
    </button>
  )
}

/// "I have a business code" — one field, one call. Success hands back to
/// `App`, which re-reads tenancy and shows the ordinary sign-in form.
function BusinessCodeForm({
  onBack,
  onSelected,
  className,
}: {
  onBack: () => void
  onSelected: () => void
  className?: string
}) {
  const [code, setCode] = useState("")

  const select = useMutation({
    mutationFn: (slug: string) => selectBusiness(slug),
    onSuccess: onSelected,
  })

  return (
    <div className={cn("grid h-full place-items-center px-6 py-10", className)}>
      <form
        className="w-full max-w-[22.5rem]"
        onSubmit={(event) => {
          event.preventDefault()
          const slug = code.trim()
          if (slug !== "") select.mutate(slug)
        }}
      >
        <div className="door-rise" style={rise(0)}>
          <h1 className="text-[1.75rem] leading-9 font-semibold tracking-[-0.025em] text-ink">
            Business code
          </h1>
          <p className="mt-2 text-[0.9375rem] leading-6 text-body">
            Ask whoever set up the business for its code.
          </p>
        </div>
        <div className="door-rise mt-8" style={rise(1)}>
          <Field label="Business code" required>
            <Input
              autoFocus
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={code}
              onChange={(event) => {
                setCode(event.target.value)
                if (select.isError) select.reset()
              }}
            />
          </Field>
        </div>
        <Problem error={select.error} className="mt-4" />
        <div
          className="door-rise mt-7 flex items-center gap-2.5"
          style={rise(2)}
        >
          <Button
            type="button"
            variant="quiet"
            className="h-11 px-4"
            onClick={onBack}
            disabled={select.isPending}
          >
            Back
          </Button>
          <span className="flex-1" />
          <Button
            type="submit"
            variant="primary"
            size="lg"
            disabled={code.trim() === ""}
            pending={select.isPending}
          >
            {select.isPending ? "Finding it…" : "Continue"}
          </Button>
        </div>
      </form>
    </div>
  )
}

interface BusinessDraft {
  businessName: string
  ownerName: string
  username: string
  password: string
  inviteCode: string
}

/// "Create a business" — the minimum this app needs before the ordinary setup
/// wizard can take over: who owns it, and a login for them. Everything else
/// (the address, the legal form, the stores) is that wizard's job, once this
/// is signed in.
function CreateBusinessForm({
  inviteRequired,
  onBack,
  onDone,
  className,
}: {
  inviteRequired: boolean
  onBack: () => void
  onDone: (session: LoginResponse) => void
  className?: string
}) {
  const [draft, setDraft] = useState<BusinessDraft>({
    businessName: "",
    ownerName: "",
    username: "",
    password: "",
    inviteCode: "",
  })
  const [touched, setTouched] = useState(false)
  const [revealed, setRevealed] = useState(false)

  const set =
    <K extends keyof BusinessDraft>(key: K) =>
    (event: React.ChangeEvent<HTMLInputElement>) =>
      setDraft((prev) => ({ ...prev, [key]: event.target.value }))

  const create = useMutation({
    mutationFn: async () => {
      await createBusiness({
        business_name: draft.businessName.trim(),
        owner_name: draft.ownerName.trim(),
        username: draft.username.trim(),
        password: draft.password,
        invite_code: inviteRequired ? draft.inviteCode.trim() : null,
      })
      // The business cookie is set by the response above, so this sign-in
      // already lands inside it — the same call the ordinary door uses.
      return auth.login(draft.username.trim(), draft.password)
    },
    onSuccess: onDone,
  })

  const ready =
    draft.businessName.trim() !== "" &&
    draft.ownerName.trim() !== "" &&
    draft.username.trim() !== "" &&
    draft.password !== "" &&
    (!inviteRequired || draft.inviteCode.trim() !== "")

  const problem = (value: string) =>
    touched && value.trim() === "" ? "Required." : null

  return (
    <div
      className={cn(
        "grid h-full place-items-center overflow-y-auto px-6 py-10",
        className
      )}
    >
      <form
        className="w-full max-w-[22.5rem] py-4"
        onSubmit={(event) => {
          event.preventDefault()
          setTouched(true)
          if (ready) create.mutate()
        }}
      >
        <div className="door-rise" style={rise(0)}>
          <h1 className="text-[1.75rem] leading-9 font-semibold tracking-[-0.025em] text-ink">
            Create a business
          </h1>
          <p className="mt-2 text-[0.9375rem] leading-6 text-body">
            Everything else — address, stores, books — is set up from the home
            screen once you are in.
          </p>
        </div>

        <div className="mt-7 flex flex-col gap-5">
          <div className="door-rise" style={rise(1)}>
            <Field
              label="Business name"
              required
              problem={problem(draft.businessName)}
            >
              <Input
                autoFocus
                value={draft.businessName}
                onChange={set("businessName")}
              />
            </Field>
          </div>
          <div className="door-rise" style={rise(2)}>
            <Field
              label="Your name"
              required
              problem={problem(draft.ownerName)}
            >
              <Input
                autoComplete="name"
                value={draft.ownerName}
                onChange={set("ownerName")}
              />
            </Field>
          </div>
          <div className="door-rise" style={rise(3)}>
            <Field label="Username" required problem={problem(draft.username)}>
              <Input
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                value={draft.username}
                onChange={set("username")}
              />
            </Field>
          </div>
          <div className="door-rise" style={rise(4)}>
            <Field label="Password" required problem={problem(draft.password)}>
              <div className="relative">
                <Input
                  type={revealed ? "text" : "password"}
                  autoComplete="new-password"
                  className="pr-12"
                  value={draft.password}
                  onChange={set("password")}
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
          {inviteRequired && (
            <div className="door-rise" style={rise(5)}>
              <Field
                label="Invite code"
                required
                problem={problem(draft.inviteCode)}
              >
                <Input value={draft.inviteCode} onChange={set("inviteCode")} />
              </Field>
            </div>
          )}
        </div>

        <Problem error={create.error} className="mt-5" />

        <div className="mt-7 flex items-center gap-2.5">
          <Button
            type="button"
            variant="quiet"
            className="h-11 px-4"
            onClick={onBack}
            disabled={create.isPending}
          >
            Back
          </Button>
          <span className="flex-1" />
          <Button
            type="submit"
            variant="primary"
            size="lg"
            pending={create.isPending}
          >
            {create.isPending ? "Submitting…" : "Submit"}
          </Button>
        </div>
      </form>
    </div>
  )
}
