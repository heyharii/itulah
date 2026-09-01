import { hueFor, initials } from "@/lib/collaboration"
import { cn } from "@/lib/utils"

/// Somebody, as a coloured disc with their initials on it.
///
/// The colour is derived from the name rather than stored against it. One
/// person is then the same colour on every screen, in every browser, with
/// nothing to configure and nothing to migrate — and a person who has never
/// signed in still has a colour the moment they are first mentioned.
export function PersonAvatar({
  username,
  size = "md",
  className,
}: {
  username: string
  size?: "xs" | "sm" | "md"
  className?: string
}) {
  return (
    <span
      title={username}
      aria-hidden
      className={cn(
        "grid shrink-0 place-items-center rounded-full font-medium text-white",
        size === "xs" && "size-5 text-[9px]",
        size === "sm" && "size-7 text-[10px]",
        size === "md" && "size-8 text-[11px]",
        className,
      )}
      style={{ background: `oklch(58% 0.13 ${hueFor(username)})` }}
    >
      {initials(username)}
    </span>
  )
}

/// Everybody who has spoken, overlapped. A row of faces answers "is this an
/// argument between two people or across a department" faster than a count.
export function Faces({ people, limit = 4 }: { people: string[]; limit?: number }) {
  const shown = people.slice(0, limit)
  const rest = people.length - shown.length
  return (
    <span className="flex items-center">
      {shown.map((person) => (
        <PersonAvatar
          key={person}
          username={person}
          size="xs"
          className="ring-card -ml-1.5 ring-2 first:ml-0"
        />
      ))}
      {rest > 0 && (
        <span className="text-muted-foreground ml-1 font-mono text-[10px]">+{rest}</span>
      )}
    </span>
  )
}
