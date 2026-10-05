import type { ReactNode } from "react"

import { BrandMark } from "@/components/brand-mark"
import { useNodeIdentity } from "@/lib/session"
import { cn } from "@/lib/utils"

/// The way in: what somebody sees before the app knows who they are.
///
/// Two halves. Charcoal on the left, in the ramp the shell's own navigation is
/// drawn in, holding the mark, the name and whether the server is answering;
/// the form on white on the right, with nothing else beside it. On a phone the
/// charcoal becomes the top of the screen and the form a sheet pulled up over
/// it, which is the shape a native sign-in has.
///
/// The form itself is `LoginForm`, passed in, so the warehouse's recovery box
/// (`screens/operations/gate.tsx`) keeps using the same fields without this
/// frame around them.
export function SignInDoor({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full flex-col overflow-y-auto bg-rail md:flex-row md:overflow-hidden">
      <aside className="relative isolate flex shrink-0 flex-col overflow-hidden px-6 pt-[max(1.75rem,env(safe-area-inset-top))] pb-12 md:w-[clamp(22rem,38vw,34rem)] md:px-12 md:py-12">
        <Backdrop />
        <BrandMark className="door-in size-10" />
        <div className="mt-10 md:mt-auto">
          {/* The product's name, not the company's: people sign in to
              Central (owner, 2026-09-28). The blue dot after it is the one
              in the icon — C, then the dot. */}
          <p
            className="door-rise text-[2.25rem] leading-none font-bold tracking-[-0.045em] text-rail-ink md:text-[3rem]"
            style={{ "--i": 0 } as React.CSSProperties}
          >
            Central<span className="text-accent">.</span>
          </p>
          <p
            className="door-rise mt-3 max-w-[20rem] text-[0.9375rem] leading-6 text-rail-text"
            style={{ "--i": 1 } as React.CSSProperties}
          >
            The stores, the stock, the buying and the money, in one place.
          </p>
        </div>
        <ServerStatus tone="dark" className="mt-12 hidden md:flex" />
      </aside>

      <main className="relative -mt-6 flex min-h-[32rem] flex-1 flex-col rounded-t-[1.5rem] bg-canvas md:mt-0 md:min-h-0 md:rounded-none">
        {children}
        <ServerStatus
          tone="light"
          className="justify-center px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] md:hidden"
        />
      </main>
    </div>
  )
}

/// The charcoal's surface: a light falling from the top corner, the blue of
/// the icon's dot glowing low in the far one, and grain over both.
function Backdrop() {
  return (
    <div aria-hidden className="door-in absolute inset-0 -z-10">
      <div className="absolute inset-0 bg-[radial-gradient(56rem_36rem_at_0%_0%,rgb(255_255_255/7%),transparent_62%)]" />
      {/* On a phone the charcoal is a band a few hundred pixels tall, and a
          glow sized for the desk's half-screen would tint all of it navy — so
          it is smaller there and kept to the far corner. */}
      <div className="door-glow absolute -top-40 -right-36 size-[20rem] rounded-full bg-accent/15 blur-[6rem] md:top-auto md:-right-40 md:-bottom-48 md:size-[30rem] md:bg-accent/25 md:blur-[7rem]" />
      <div className="door-grain absolute inset-0 opacity-[0.14]" />
    </div>
  )
}

/// Whether the server behind this page is answering, said before anybody
/// types a password into it. A sign-in that fails because the node is down
/// otherwise looks exactly like one that failed on a typo.
///
/// `useNodeIdentity` resolves an unreachable node to `null` rather than
/// throwing, which is what makes the third state here a fact and not an error.
function ServerStatus({
  tone,
  className,
}: {
  tone: "dark" | "light"
  className?: string
}) {
  const identity = useNodeIdentity()
  const state = identity.isPending
    ? "checking"
    : identity.data
      ? "online"
      : "offline"
  return (
    <p
      aria-live="polite"
      className={cn(
        "door-in flex items-center gap-2.5 text-[0.875rem] leading-5",
        className
      )}
    >
      <span
        aria-hidden
        className={cn(
          "size-2 shrink-0 rounded-full",
          state === "online" && "door-live bg-ok",
          state === "offline" && "bg-bad",
          state === "checking" &&
            (tone === "dark" ? "bg-rail-mute" : "bg-faint")
        )}
      />
      <span className={tone === "dark" ? "text-rail-text" : "text-body"}>
        {state === "online"
          ? "Central is online"
          : state === "offline"
            ? "Central can’t be reached"
            : "Checking Central…"}
      </span>
    </p>
  )
}
