import { useState } from "react"
import { createFileRoute, redirect, useRouter } from "@tanstack/react-router"
import { whoAmI } from "~/lib/cloud"

export const Route = createFileRoute("/login")({
  beforeLoad: async () => {
    const me = await whoAmI()
    if (me) throw redirect({ to: "/" })
  },
  component: Login,
})

/// Sign-in posts to /api/v1/auth/login on this origin — the same path the hub
/// posts to, proxied to the node. The node's Set-Cookie comes back through the
/// proxy unchanged, and from then on browser and SSR server share one session.
function Login() {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    const form = new FormData(event.currentTarget)
    try {
      const response = await fetch("/api/v1/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          username: String(form.get("username") ?? ""),
          password: String(form.get("password") ?? ""),
        }),
      })
      if (!response.ok) {
        const detail = await response
          .json()
          .catch(() => ({ message: undefined }))
        throw new Error(
          typeof detail.message === "string" && detail.message !== ""
            ? detail.message
            : `Sign-in refused (${response.status})`
        )
      }
      await router.invalidate()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      setBusy(false)
    }
  }

  return (
    <main className="page page-narrow">
      <h1 className="greeting">Sign in</h1>
      <form className="card login" onSubmit={submit}>
        <label>
          Username
          <input name="username" autoComplete="username" required autoFocus />
        </label>
        <label>
          Password
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        </label>
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  )
}
