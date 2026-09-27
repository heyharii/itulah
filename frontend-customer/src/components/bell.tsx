import { useEffect, useRef } from "react"
import { Link } from "@tanstack/react-router"
import { AnimatePresence, motion, useAnimationControls, useReducedMotion } from "motion/react"
import { Bell } from "lucide-react"

import { Chip } from "@/components/ui/chip"
import { SPRING_CELEBRATE } from "@/lib/motion"
import { unread, usePointsFeed, useSeen } from "@/lib/points-feed"
import { useSession } from "@/lib/session"

/// The way into the activity list, with a count of what this phone has not
/// shown yet.
///
/// When the count goes up the bell swings once — a state change the member
/// should notice from across the screen — and the badge springs in. Both only
/// on an increase: a count going down is the member reading, and reacting to
/// that would be the interface congratulating itself.
export function BellChip() {
  const { member } = useSession()
  const reduce = useReducedMotion()
  const feed = usePointsFeed()
  const seen = useSeen(member.member_id)
  const count = unread(feed.data?.entries, seen).length
  const swing = useAnimationControls()
  const last = useRef(count)

  useEffect(() => {
    if (!reduce && count > last.current) {
      void swing.start({
        rotate: [0, -16, 13, -9, 5, 0],
        transition: { duration: 0.6, ease: "easeOut" },
      })
    }
    last.current = count
  }, [count, reduce, swing])

  return (
    <Chip
      aria-label={count > 0 ? `Aktivitas poin, ${count} baru` : "Aktivitas poin"}
      render={<Link to="/notifikasi" />}
      className="relative"
    >
      <motion.span animate={swing} style={{ originY: 0.1 }} className="flex">
        <Bell />
      </motion.span>
      <AnimatePresence>
        {count > 0 && (
          <motion.span
            key="badge"
            initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.5, transition: { duration: 0.15 } }}
            transition={reduce ? { duration: 0.15 } : SPRING_CELEBRATE}
            className="num absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-backdrop bg-bad px-1 text-[0.6875rem] leading-none font-semibold text-on-dark"
          >
            {count > 9 ? "9+" : count}
          </motion.span>
        )}
      </AnimatePresence>
    </Chip>
  )
}
