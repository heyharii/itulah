import type { ReactNode } from "react"

import { BrandMark } from "@/components/brand-mark"
import { useNodeIdentity } from "@/lib/session"
import { cn } from "@/lib/utils"

/// The way in: what somebody sees before the app knows who they are.
///
/// Matte (owner, 2026-10-20, `sign-in-options.html`: "sign in pilihan
/// matte"): one white card standing on the icon's pastel, the same on a desk
/// and a phone, the way Apple's own sign-in is one column. The Deep mark and
/// "Central." head it — the period is the icon's yellow dot — the fields sit
/// under them, and whether the server is answering is said once, under the
/// card. It replaced the two halves (charcoal, then a washed-out grey after
/// All white), which the owner called "jelek sekali" on 20 Oct.
///
/// The form itself is `LoginForm`, passed in with `door`, so the warehouse's
/// recovery box (`screens/operations/gate.tsx`) keeps the same fields without
/// this frame around them.
export function SignInDoor({ children }: { children: ReactNode }) {
  return (
    <div className="door-ground flex h-full flex-col items-center overflow-y-auto px-4 pt-[env(safe-area-inset-top)]">
      <div className="door-card mt-[clamp(2.5rem,16vh,11rem)] w-full max-w-[25rem] shrink-0 px-8 pt-9 pb-8 max-md:px-5 max-md:pt-7 max-md:pb-6">
        <div
          className="door-rise mb-7 flex flex-col items-center"
          style={{ "--i": 0 } as React.CSSProperties}
        >
          <BrandMark className="door-mark size-[4.25rem]" />
          {/* The product's name, not the company's: people sign in to
              Central (owner, 2026-09-28). The dot after it is the icon's. */}
          <p className="mt-4 text-[1.75rem] leading-none font-bold tracking-[-0.04em] text-ink">
            Central<span className="text-[#efa614]">.</span>
          </p>
        </div>
        {children}
      </div>
      <ServerStatus
        tone="light"
        className="mt-auto justify-center pt-6 pb-[max(1.75rem,env(safe-area-inset-bottom))]"
      />
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
        "door-in flex items-center gap-2.5 text-[0.9375rem] leading-5",
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
