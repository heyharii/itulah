"use client"

import { Eye, EyeOff, Lock, Mail } from "lucide-react"
import { type FormEvent, useCallback, useMemo, useState } from "react"

import { StatefulButton, type ButtonState } from "@/components/motion/button"
import { Checkbox } from "@/components/motion/checkbox"
import { Input } from "@/components/motion/input"
import { cn } from "@/lib/utils"

export type LoginValues = {
  email: string
  password: string
  remember: boolean
}

type LoginErrors = Partial<Record<"email" | "password", string>>

const EMPTY_VALUES: LoginValues = {
  email: "",
  password: "",
  remember: false,
}

/* Operator accounts are identified by username here (`admin`, `finance_01`),
 * and the hub accepts either that or an address. So the only thing this can
 * honestly check is that something was typed and it holds no whitespace —
 * anything stricter locks real accounts out of their own login form, which is
 * exactly what an email-shaped rule did. */
const IDENTIFIER_PATTERN = /^\S+$/

function validate(values: LoginValues): LoginErrors {
  const errors: LoginErrors = {}

  if (!values.email.trim()) {
    errors.email = "Enter your email or username."
  } else if (!IDENTIFIER_PATTERN.test(values.email)) {
    errors.email = "Remove the spaces from your email or username."
  }

  if (!values.password) {
    errors.password = "Enter your password."
  }

  return errors
}

export function LoginForm({
  className,
  onLogin,
  errorMessage,
  ...props
}: React.ComponentProps<"div"> & {
  onLogin?: (values: LoginValues) => Promise<void> | void
  errorMessage?: string
}) {
  const [values, setValues] = useState<LoginValues>(EMPTY_VALUES)
  const [touched, setTouched] = useState<Partial<Record<"email" | "password", boolean>>>({})
  const [status, setStatus] = useState<ButtonState>("idle")
  const [revealPassword, setRevealPassword] = useState(false)

  const errors = useMemo(() => validate(values), [values])

  const setValue = useCallback(
    <K extends keyof LoginValues>(key: K, next: LoginValues[K]) => {
      setValues((prev) => ({ ...prev, [key]: next }))
      setStatus((current) => (current === "error" ? "idle" : current))
    },
    []
  )

  const touch = useCallback((key: "email" | "password") => {
    setTouched((prev) => (prev[key] ? prev : { ...prev, [key]: true }))
  }, [])

  const shownError = (key: "email" | "password") =>
    touched[key] ? errors[key] : undefined

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setTouched({ email: true, password: true })

    if (Object.keys(errors).length > 0) return

    setStatus("loading")
    try {
      await onLogin?.(values)
      setStatus("success")
    } catch {
      // The auth boundary owns the durable error state; the form only keeps
      // the button honest while the failed request is visible.
      setStatus("error")
    }
  }

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <form
        onSubmit={handleSubmit}
        className="flex w-full flex-col gap-5 rounded-3xl border border-border bg-card p-6"
      >
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-semibold tracking-tight text-foreground">
            Login to your account
          </h2>
          <p className="text-sm text-muted-foreground">
            Enter your email or username below to login to your account
          </p>
        </div>

        {errorMessage && (
          <p role="alert" className="rounded-xl border border-destructive/25 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {errorMessage}
          </p>
        )}

        <div className="flex flex-col gap-4">
          <Input
            /* Not `type="email"`: operator accounts here are usernames
               (`admin`, `finance_01`), and the browser's own validation
               refuses anything without an "@" before our code ever runs. */
            label="Email or username"
            type="text"
            autoComplete="username"
            placeholder="admin"
            leftIcon={<Mail />}
            disabled={status === "loading"}
            value={values.email}
            onChange={(next) => setValue("email", next)}
            onBlur={() => touch("email")}
            error={shownError("email")}
          />

          <Input
            label="Password"
            type={revealPassword ? "text" : "password"}
            autoComplete="current-password"
            placeholder="Your password"
            leftIcon={<Lock />}
            rightIcon={
              <button
                type="button"
                disabled={status === "loading"}
                onClick={() => setRevealPassword((prev) => !prev)}
                aria-label={revealPassword ? "Hide password" : "Show password"}
                className="text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:text-foreground"
              >
                {revealPassword ? <EyeOff /> : <Eye />}
              </button>
            }
            disabled={status === "loading"}
            value={values.password}
            onChange={(next) => setValue("password", next)}
            onBlur={() => touch("password")}
            error={shownError("password")}
          />
        </div>

        {/* The reset hint is a full sentence, so on a phone it wraps into the
          * checkbox rather than sitting beside it. Stack them below `sm`. */}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
          <Checkbox
            checked={values.remember}
            onCheckedChange={(next) => setValue("remember", next)}
            disabled={status === "loading"}
            label="Remember me"
          />
          <span
            title="Password reset is handled by your Internal administrator"
            className="text-sm text-muted-foreground"
          >
            Contact an administrator to reset your password
          </span>
        </div>

        <StatefulButton
          type="submit"
          size="lg"
          state={status}
          loadingText="Signing in"
          successText="Signed in"
          errorText="Try again"
          className="w-full"
        >
          Login
        </StatefulButton>
      </form>
    </div>
  )
}
