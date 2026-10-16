"use client"

import { useState } from "react"
import { auth } from "./hub-api"

export function LoginDoor() {
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError("")
    try {
      await auth.login(username.trim(), password)
      window.location.reload()
    } catch {
      setError("Sign-in failed. Check your username and password.")
      setBusy(false)
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-soft-3 px-4 text-ink">
      <form onSubmit={submit} className="w-full max-w-sm rounded-2xl border border-hairline bg-canvas p-7 shadow-sm">
        <p className="text-xs uppercase tracking-[0.16em] text-mute">Central Dashboard</p>
        <h1 className="mt-2 text-2xl font-semibold">Sign in</h1>
        <p className="mt-1 text-sm text-mute">PO and Receiving prototype</p>
        <label className="mt-6 block text-sm font-medium" htmlFor="username">Username</label>
        <input id="username" autoComplete="username" required value={username} onChange={(event) => setUsername(event.target.value)} className="mt-1 w-full rounded-lg border border-hairline px-3 py-2" />
        <label className="mt-4 block text-sm font-medium" htmlFor="password">Password</label>
        <input id="password" type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} className="mt-1 w-full rounded-lg border border-hairline px-3 py-2" />
        {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
        <button disabled={busy} className="mt-5 w-full rounded-lg bg-dark px-4 py-2.5 font-medium text-on-dark disabled:opacity-60">
          {busy ? "Signing in…" : "Continue"}
        </button>
      </form>
    </main>
  )
}
