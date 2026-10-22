import { useMutation } from "@tanstack/react-query"
import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import { Field, Input } from "@/components/ui/field"
import { Banner } from "@/components/ui/states"
import { auth } from "@/lib/api"
import { initialOf } from "@/lib/format"
import { problemOf } from "@/lib/problem"
import { useIdentity, useSignOut } from "@/lib/session"
import { useAsleep, wakeUp, watchIdle } from "@/lib/sleep"

/// The hub asleep (owner, 2026-10-18: "bukan sign out tapi sleep, tinggal
/// masukin password"). Over everything, the person's name and one password
/// box; the password is checked by signing in again as the same person, so
/// the session comes back fresh. Someone else at the desk signs out instead.
/// It also falls asleep by itself after 15 minutes idle (`watchIdle`).
export function SleepScreen() {
  const asleep = useAsleep()
  const identity = useIdentity()
  const signOut = useSignOut()
  const [password, setPassword] = useState("")
  const username = identity.data?.username ?? ""
  const name = identity.data?.display_name ?? username

  // Asleep on its own after a quarter of an hour with nobody at the desk.
  const signedIn = identity.data != null
  useEffect(() => (signedIn ? watchIdle() : undefined), [signedIn])

  const wake = useMutation({
    mutationFn: () => auth.login(username, password),
    onSuccess: () => {
      setPassword("")
      wakeUp()
    },
  })

  if (!asleep || identity.data == null) return null

  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-canvas/80 px-4 backdrop-blur-xl">
      <form
        className="flex w-full max-w-[22rem] flex-col items-center gap-5 rounded-card border border-hairline bg-canvas p-6 shadow-float"
        onSubmit={(event) => {
          event.preventDefault()
          if (password !== "") wake.mutate()
        }}
      >
        <span className="grid size-16 place-items-center rounded-full bg-accent-bg text-[1.5rem] font-semibold text-accent ring-2 ring-accent">
          {initialOf(name)}
        </span>
        <div className="text-center">
          <p className="text-card-title font-semibold text-ink">{name}</p>
          <p className="text-[0.9375rem] text-mute">{username}</p>
        </div>
        <Field label="Password" className="w-full">
          <Input
            type="password"
            autoComplete="current-password"
            autoFocus
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </Field>
        {wake.error !== null && (
          <Banner tone="bad" className="w-full">
            {problemOf(wake.error)}
          </Banner>
        )}
        <Button
          type="submit"
          variant="primary"
          className="w-full"
          disabled={password === ""}
          pending={wake.isPending}
        >
          Wake up
        </Button>
        <button
          type="button"
          className="text-[0.9375rem] text-mute hover:text-ink"
          onClick={() => {
            wakeUp()
            signOut.mutate()
          }}
        >
          Not {name.split(" ")[0]}? Sign out
        </button>
      </form>
    </div>
  )
}
