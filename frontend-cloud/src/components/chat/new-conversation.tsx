import { PersonAvatar } from "@/components/collaboration/person"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { conversationsKey, startConversation } from "@/lib/chat"
import { cn } from "@/lib/utils"
import { ApiError } from "@itulah/contract/client"
import type { ChatConversation } from "@itulah/contract"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { X } from "lucide-react"
import { useMemo, useState } from "react"

/// Starting a conversation with somebody.
///
/// People are typed, not picked from a directory. `/api/v1/auth/users` is
/// behind the Admin role — reasonably, since it carries roles and last-login
/// times — so a buyer opening this screen cannot be shown the staff list. The
/// suggestions below are the people this person can already see: everybody in
/// a conversation they are already in. The server checks the name exists and
/// says so plainly when it does not, which is the check that matters anyway.
export function NewConversation({
  open,
  onOpenChange,
  known,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  known: string[]
}) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [kind, setKind] = useState<"DIRECT" | "GROUP">("DIRECT")
  const [title, setTitle] = useState("")
  const [entry, setEntry] = useState("")
  const [people, setPeople] = useState<string[]>([])

  const suggestions = useMemo(
    () => known.filter((person) => !people.includes(person)).sort(),
    [known, people],
  )

  const reset = () => {
    setKind("DIRECT")
    setTitle("")
    setEntry("")
    setPeople([])
  }

  const start = useMutation({
    mutationFn: (): Promise<ChatConversation> => {
      // A direct conversation is between exactly two people and the server
      // adds the caller itself, so the request names one person. Typing a name
      // and never pressing Add is the common case, so it counts.
      const named = entry.trim() === "" ? people : [...people, entry.trim()]
      return startConversation({
        kind,
        title: kind === "GROUP" ? title.trim() : null,
        participants: kind === "DIRECT" ? named.slice(0, 1) : named,
      })
    },
    onSuccess: (conversation) => {
      void queryClient.invalidateQueries({ queryKey: conversationsKey() })
      onOpenChange(false)
      reset()
      void navigate({
        to: "/chat/$conversationId",
        params: { conversationId: conversation.conversation_id },
      })
    },
  })

  const add = (name: string) => {
    const trimmed = name.trim()
    if (trimmed === "" || people.includes(trimmed)) return
    setPeople((current) => (kind === "DIRECT" ? [trimmed] : [...current, trimmed]))
    setEntry("")
  }

  const named = entry.trim() === "" ? people.length : people.length + 1
  const ready =
    kind === "DIRECT" ? named === 1 : named >= 1 && title.trim() !== ""

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (!next) reset()
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New conversation</DialogTitle>
          <DialogDescription>
            Private to whoever is in it. An argument about a purchase order
            belongs in a discussion instead — that one hangs off the record and
            everybody can read it later.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex gap-1.5">
            {(["DIRECT", "GROUP"] as const).map((option) => (
              <Button
                key={option}
                size="sm"
                variant={kind === option ? "default" : "outline"}
                onClick={() => {
                  setKind(option)
                  if (option === "DIRECT") setPeople((current) => current.slice(0, 1))
                }}
              >
                {option === "DIRECT" ? "One person" : "A group"}
              </Button>
            ))}
          </div>

          {kind === "GROUP" && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="conversation-title">Name</Label>
              <Input
                id="conversation-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Receiving DC-01"
              />
              <p className="text-muted-foreground text-[11px]">
                A group needs a name. A direct conversation does not — it is
                named by whoever else is in it, which depends on who is looking.
              </p>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="conversation-person">
              {kind === "DIRECT" ? "Who" : "Who else"}
            </Label>
            {people.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {people.map((person) => (
                  <span
                    key={person}
                    className="bg-muted flex items-center gap-1.5 rounded-full py-0.5 pr-1 pl-1.5 text-xs"
                  >
                    <PersonAvatar username={person} size="xs" />
                    {person}
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      aria-label={`Remove ${person}`}
                      onClick={() =>
                        setPeople((current) => current.filter((other) => other !== person))
                      }
                    >
                      <X />
                    </Button>
                  </span>
                ))}
              </div>
            )}
            <div className="flex gap-1.5">
              <Input
                id="conversation-person"
                list="known-people"
                value={entry}
                onChange={(event) => setEntry(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault()
                    add(entry)
                  }
                }}
                placeholder="username"
              />
              <datalist id="known-people">
                {suggestions.map((person) => (
                  <option key={person} value={person} />
                ))}
              </datalist>
              <Button
                variant="outline"
                onClick={() => add(entry)}
                disabled={entry.trim() === ""}
              >
                Add
              </Button>
            </div>
            {suggestions.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {suggestions.slice(0, 8).map((person) => (
                  <button
                    key={person}
                    type="button"
                    onClick={() => add(person)}
                    className={cn(
                      "hover:bg-muted text-muted-foreground rounded-full border px-2 py-0.5 text-[11px] transition-colors",
                    )}
                  >
                    {person}
                  </button>
                ))}
              </div>
            )}
          </div>

          {start.isError && (
            <p role="alert" className="text-destructive text-xs">
              {start.error instanceof ApiError
                ? start.error.message
                : "The conversation could not be started."}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!ready || start.isPending} onClick={() => start.mutate()}>
            {start.isPending ? "Starting…" : "Start"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
