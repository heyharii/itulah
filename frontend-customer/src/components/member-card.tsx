import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from "react"
import {
  animate,
  motion,
  useAnimationControls,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
  type PanInfo,
} from "motion/react"

import { Barcode } from "@/components/barcode"
import { MatteC } from "@/components/matte"
import { memberCardPayload } from "@/lib/member-card"
import { SPRING_THROW, SPRING_TRACK } from "@/lib/motion"
import { cn } from "@/lib/utils"

const MONTH = new Intl.DateTimeFormat("id-ID", { month: "2-digit", year: "2-digit" })

/// How far a pointer or finger may tip the card, in degrees. Matte has no
/// light to catch, so the lean is only what makes it feel held: small.
const TILT = 5

/// Apple's momentum projection (Designing Fluid Interfaces): where a flick
/// would come to rest if nothing stopped it. The card lands on the face
/// nearest that point, not the one nearest the finger when it let go — which
/// is what makes a quick flick flip it.
function project(velocity: number, deceleration = 0.992): number {
  return ((velocity / 1000) * deceleration) / (1 - deceleration)
}

export interface MemberCardHandle {
  flip: () => void
}

/// The member card, drawn as an object rather than as a box.
///
/// Matte · Deep (owner, 2026-10-20): the icon's blue, lit from the top and
/// darkening toward its foot, with the icon's pale C standing on it and a
/// soft contact shadow under the card. It lies flat — no resting tilt, no
/// sheen — and leans a little toward the pointer or the pressing finger, the
/// way a card does in the hand. On the card screen (`stage`) it has two
/// sides: drag it sideways and it turns with the finger, let go and it
/// settles on whichever face the throw was heading for, carrying the finger's
/// velocity into the spring so there is no seam between dragging and
/// animating. Everything that moves is a transform.
export const MemberCard = forwardRef<
  MemberCardHandle,
  {
    memberId: string
    name: string | null
    since: string | null
    pose?: "rest" | "stage"
    flippable?: boolean
    className?: string
    onFlipChange?: (back: boolean) => void
    /// Change it to lift the card once — Beranda bumps it when the balance
    /// goes up, so the card answers at the moment something good happened
    /// to it.
    lift?: number
  }
>(function MemberCard(
  {
    memberId,
    name,
    since,
    pose = "rest",
    flippable = false,
    className,
    onFlipChange,
    lift = 0,
  },
  ref,
) {
  const reduce = useReducedMotion()
  // Flat in both poses: matte is an object lying still, not metal tipped to
  // the light. The stage keeps a breath of lean back so it stands up.
  const rest = pose === "rest" ? { x: 0, y: 0, z: 0 } : { x: 4, y: 0, z: 0 }

  // Pointer tilt: springs, so the card lags the finger a touch like a real
  // object with weight (SPRING_TRACK), rather than snapping to it.
  const tiltX = useSpring(0, SPRING_TRACK)
  const tiltY = useSpring(0, SPRING_TRACK)
  // The turn between faces: a plain value that an animation or a drag owns.
  const turn = useMotionValue(0)

  const rotateX = useTransform(tiltX, (value) => rest.x + value)
  const rotateY = useTransform(
    [turn, tiltY],
    ([spin, lean]: number[]) => rest.y + spin + lean,
  )

  // A small hop when points land: up, and settling back on the same spring a
  // throw uses. Not on the first value — opening the app is not earning.
  const hop = useAnimationControls()
  const firstLift = useRef(lift)
  useEffect(() => {
    if (reduce || lift === firstLift.current) return
    void hop.start({ y: [0, -10, 0], transition: { duration: 0.5, ease: "easeOut" } })
  }, [hop, lift, reduce])

  const back = useRef(false)
  const settle = useCallback(
    (target: number, velocity = 0) => {
      const showingBack = Math.round(target / 180) % 2 !== 0
      if (showingBack !== back.current) {
        back.current = showingBack
        onFlipChange?.(showingBack)
      }
      if (reduce) {
        turn.set(target)
        return
      }
      animate(turn, target, { ...SPRING_THROW, velocity })
    },
    [onFlipChange, reduce, turn],
  )

  useImperativeHandle(
    ref,
    () => ({
      flip: () => {
        const nearest = Math.round(turn.get() / 180) * 180
        settle(nearest + 180)
      },
    }),
    [settle, turn],
  )

  // Leaning toward the pointer. Mouse and pen lean on hover; a finger leans
  // only while pressing, because a hover a touch screen cannot have would
  // leave the card stuck at whatever angle the last tap set.
  const panning = useRef(false)
  const lean = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (reduce || panning.current) return
      if (event.pointerType === "touch" && event.buttons === 0) return
      const box = event.currentTarget.getBoundingClientRect()
      const px = (event.clientX - box.left) / box.width - 0.5
      const py = (event.clientY - box.top) / box.height - 0.5
      tiltY.set(px * TILT * 2)
      tiltX.set(-py * TILT * 2)
    },
    [reduce, tiltX, tiltY],
  )
  const straighten = useCallback(() => {
    tiltX.set(0)
    tiltY.set(0)
  }, [tiltX, tiltY])

  // The phone itself as the pointer. Tipping the handset tips the card, the
  // way a real card in the hand catches the light — measured from however the
  // phone was held when the screen opened, and slowly re-centred so holding
  // it at a new angle settles the card back rather than leaving it skewed.
  // iOS asks permission, and only from a tap: `askForMotion` runs on the
  // first press of the card.
  const askForMotion = useRef<(() => void) | null>(null)
  useEffect(() => {
    if (reduce || typeof window === "undefined" || !("DeviceOrientationEvent" in window)) return
    let base: { beta: number; gamma: number } | null = null
    const onOrient = (event: DeviceOrientationEvent) => {
      if (event.beta === null || event.gamma === null || panning.current) return
      if (base === null) base = { beta: event.beta, gamma: event.gamma }
      const clamp = (value: number) => Math.max(-1, Math.min(1, value))
      tiltY.set(clamp((event.gamma - base.gamma) / 22) * TILT)
      tiltX.set(-clamp((event.beta - base.beta) / 22) * TILT)
      base.beta += (event.beta - base.beta) * 0.015
      base.gamma += (event.gamma - base.gamma) * 0.015
    }
    const listen = () => window.addEventListener("deviceorientation", onOrient)
    const gate = (DeviceOrientationEvent as unknown as {
      requestPermission?: () => Promise<"granted" | "denied">
    }).requestPermission
    if (typeof gate === "function") {
      askForMotion.current = () => {
        askForMotion.current = null
        gate().then((state) => state === "granted" && listen()).catch(() => undefined)
      }
    } else {
      listen()
    }
    return () => {
      askForMotion.current = null
      window.removeEventListener("deviceorientation", onOrient)
    }
  }, [reduce, tiltX, tiltY])

  // Dragging turns the card with the finger, 1:1 in feel: half a degree per
  // pixel is what makes a thumb's width of travel read as a real turn.
  const grabbed = useRef(0)
  const onPanStart = useCallback(() => {
    // A drag is a turn, not a lean: the two would fight over the same axis.
    panning.current = true
    straighten()
    grabbed.current = turn.get()
    turn.stop()
  }, [straighten, turn])
  const onPan = useCallback(
    (_: PointerEvent, info: PanInfo) => {
      turn.set(grabbed.current + info.offset.x * 0.5)
    },
    [turn],
  )
  const onPanEnd = useCallback(
    (_: PointerEvent, info: PanInfo) => {
      panning.current = false
      // The finger may lift anywhere on screen, outside the card's own
      // pointer-up — so the lean is released here too, or it stays stuck at
      // whatever angle the grab set.
      straighten()
      const velocity = info.velocity.x * 0.5
      const landing = turn.get() + project(velocity)
      settle(Math.round(landing / 180) * 180, velocity)
    },
    [settle, straighten, turn],
  )

  useEffect(() => {
    if (!flippable) turn.set(0)
  }, [flippable, turn])

  const display = name?.trim() || "Member Central"
  const sinceLabel = since === null ? null : MONTH.format(new Date(since))

  return (
    <div
      className={cn("relative [perspective:1400px]", className)}
      onPointerMove={lean}
      onPointerDown={(event) => {
        askForMotion.current?.()
        lean(event)
      }}
      onPointerUp={straighten}
      onPointerLeave={straighten}
      onPointerCancel={straighten}
    >
      {/* Where the card would touch the floor. */}
      <div aria-hidden className="card-floor pointer-events-none absolute inset-x-[8%] -bottom-5 h-10" />
      <motion.div animate={hop}>
        <motion.div
          initial={
            reduce
              ? { opacity: 0 }
              : pose === "rest"
                ? { opacity: 0, y: 20, scale: 0.96 }
                : { opacity: 0, y: 16, scale: 0.96 }
          }
          animate={{ opacity: 1, rotateZ: rest.z, y: 0, scale: 1 }}
          transition={{ type: "spring", duration: 0.7, bounce: 0 }}
          style={{
            rotateX: reduce ? rest.x : rotateX,
            rotateY: reduce ? rest.y : rotateY,
            transformStyle: "preserve-3d",
            touchAction: flippable ? "pan-y" : "auto",
          }}
          onPanStart={flippable && !reduce ? onPanStart : undefined}
          onPan={flippable && !reduce ? onPan : undefined}
          onPanEnd={flippable && !reduce ? onPanEnd : undefined}
          className="relative aspect-[1.586] w-full rounded-member-card will-change-transform"
        >
          {/* Front */}
          <div
            className="card-matte absolute inset-0 overflow-hidden rounded-member-card [backface-visibility:hidden]"
            aria-label={`Kartu member ${display}, nomor ${memberId}`}
            role="img"
          >
            {/* The icon's C, standing on the card as an object with its own
                shadow — the picture the member also has on their home screen. */}
            <MatteC className="absolute top-[26%] right-[5%] w-[36%]" />
            <div className="relative flex h-full flex-col justify-between p-[6.5%]">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <MatteC floor={false} className="size-[1.375rem]" />
                  <span className="text-card-title font-semibold text-on-dark">
                    Central
                  </span>
                </div>
                <span className="text-nav font-semibold text-on-dark/85">
                  Member
                </span>
              </div>
              <div className="flex items-end justify-between gap-3">
                {/* Stops short of the C standing on the right half. */}
                <div className="min-w-0 max-w-[60%]">
                  <p className="truncate text-card-title font-semibold text-on-dark">
                    {display}
                  </p>
                  <p className="mt-0.5 truncate font-mono text-id tracking-[0.08em] text-on-dark/80 uppercase">
                    {memberId}
                  </p>
                </div>
                {sinceLabel !== null && (
                  <div className="shrink-0 text-right">
                    <p className="text-nav text-on-dark/70">Sejak</p>
                    <p className="num text-nav font-semibold text-on-dark">
                      {sinceLabel}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Back — turned half a revolution so it faces the viewer when the
              card has flipped. Only drawn where the card can flip. */}
          {flippable && (
            <div
              className="card-matte-back absolute inset-0 overflow-hidden rounded-member-card [backface-visibility:hidden] [transform:rotateY(180deg)]"
            >
              <div aria-hidden className="card-band mt-[7%] h-[17%] w-full" />
              <div className="flex flex-col items-center px-[7%] pt-[6%]">
                <div className="w-full rounded-[0.625rem] bg-canvas px-3 pt-3 pb-2 shadow-[0_1px_2px_rgb(0_0_0/0.06)]">
                  <Barcode
                    value={memberCardPayload(memberId)}
                    label={`Barcode nomor member ${memberId}`}
                    className="h-[3.25rem] text-ink"
                  />
                  <p className="mt-1.5 text-center font-mono text-id tracking-[0.16em] text-ink uppercase">
                    {memberId}
                  </p>
                </div>
                <p className="mt-[4%] text-meta text-body">
                  Pindai di kasir untuk mengumpulkan poin
                </p>
              </div>
            </div>
          )}
        </motion.div>
      </motion.div>
    </div>
  )
})
