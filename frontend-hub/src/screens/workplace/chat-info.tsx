import { Menu } from "@base-ui/react/menu"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { MoreHorizontal, Pin, PinOff, ShieldCheck } from "lucide-react"
import { useMemo, useState } from "react"

import { AppLink } from "@/components/ui/app-link"
import { Button } from "@/components/ui/button"
import { ConfirmButton, SavedDialog } from "@/components/ui/dialog"
import { Checkbox, Field, Input } from "@/components/ui/field"
import { PickMany, type Choice } from "@/components/ui/pick"
import { Pill } from "@/components/ui/pill"
import { MiniTable } from "@/components/ui/rows"
import { Sheet } from "@/components/ui/sheet"
import { EmptyState, Problem } from "@/components/ui/states"
import { SubTabs } from "@/components/ui/sub-tabs"
import { ITEM, POPUP, POSITIONER } from "@/lib/filter-chrome"
import { queryState } from "@/lib/query-state"
import { listUsers, systemKeys } from "@/lib/queries/system"
import {
  addParticipants,
  chatAttachmentUrl,
  conversationFiles,
  pinMessage,
  pinnedMessages,
  removeParticipant,
  renameConversation,
  setConversationPreferences,
  setParticipantAdmin,
  workplaceKeys,
} from "@/lib/queries/workplace"
import { toast } from "@/lib/toast"
import { cn } from "@/lib/utils"
import { upsertMessage } from "@/screens/workplace/chat-store"
import { plainText } from "@/screens/workplace/chat-text"
import { ago, bytes, clock, dayOf } from "@/screens/workplace/lib"
import { Avatar, FileTile } from "@/screens/workplace/parts"
import type { ChatConversation, ChatMessage } from "@itulah/contract"

/// Everything about a room that is not its messages.
///
/// A rail beside the thread rather than a page: somebody checking who is in a
/// group or what was pinned is still in the conversation, and should be able
/// to read it while they look.

export type InfoTab = "about" | "members" | "pinned" | "files"

const TABS: readonly { value: InfoTab; label: string }[] = [
  { value: "about", label: "About" },
  { value: "members", label: "People" },
  { value: "pinned", label: "Pinned" },
  { value: "files", label: "Files" },
]

/// The server answered with the room as it now is: that answer IS the new
/// row, so it goes straight into the cache, and the list — whose order and
/// preview may have moved — is asked again.
function useRoomWriter(conversationId: string) {
  const client = useQueryClient()
  return (updated: ChatConversation | undefined) => {
    if (updated !== undefined) {
      client.setQueryData(workplaceKeys.conversation(conversationId), updated)
    }
    void client.invalidateQueries({
      queryKey: workplaceKeys.conversations(),
      exact: true,
    })
    // A rename or a change of members wrote a line into the thread.
    void client.invalidateQueries({
      queryKey: workplaceKeys.messages(conversationId),
    })
  }
}

export function ChatInfoSheet({
  open,
  onClose,
  tab,
  onTab,
  room,
  me,
  onJump,
  onLeft,
  onLeftNote,
}: {
  open: boolean
  onClose: () => void
  tab: InfoTab
  onTab: (tab: InfoTab) => void
  room: ChatConversation
  me: string | undefined
  /// Show this message in the thread.
  onJump: (seq: number) => void
  /// The reader is no longer in the room.
  onLeft: () => void
  /// Said when the leave was the reader's own doing — the receipt outlives
  /// this sheet.
  onLeftNote: (said: string) => void
}) {
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title={room.title}
      caption={
        room.kind === "GROUP"
          ? `Group · ${room.members.length} people`
          : "Direct conversation"
      }
    >
      <SubTabs
        tabs={TABS}
        value={tab}
        onChange={(next) => onTab(next as InfoTab)}
      />
      <div className="pt-4">
        {tab === "about" && (
          <About room={room} me={me} onLeft={onLeft} onLeftNote={onLeftNote} />
        )}
        {tab === "members" && (
          <Members
            room={room}
            me={me}
            onLeft={onLeft}
            onLeftNote={onLeftNote}
          />
        )}
        {tab === "pinned" && (
          <Pinned
            conversationId={room.conversation_id}
            onJump={(seq) => {
              onClose()
              onJump(seq)
            }}
          />
        )}
        {tab === "files" && <Files conversationId={room.conversation_id} />}
      </div>
    </Sheet>
  )
}

function About({
  room,
  me,
  onLeft,
  onLeftNote,
}: {
  room: ChatConversation
  me: string | undefined
  onLeft: () => void
  onLeftNote: (said: string) => void
}) {
  const write = useRoomWriter(room.conversation_id)
  const [title, setTitle] = useState(room.title)
  /// A write that went through, held in the receipt dialog until it is read.
  const [note, setNote] = useState<string | null>(null)
  // Renamed by somebody else while this was open: the field follows, the way
  // every other fact on the sheet does.
  const [shown, setShown] = useState(room.title)
  if (room.title !== shown) {
    setShown(room.title)
    setTitle(room.title)
  }
  const group = room.kind === "GROUP"

  const rename = useMutation({
    mutationFn: () => renameConversation(room.conversation_id, title.trim()),
    onSuccess: (updated) => {
      write(updated)
      setTitle(updated.title)
      setNote("Group renamed")
    },
  })

  const preferences = useMutation({
    mutationFn: (change: {
      muted?: boolean
      pinned?: boolean
      archived?: boolean
    }) => setConversationPreferences(room.conversation_id, change),
    onSuccess: write,
    onError: (error: Error) => toast.error(error.message),
  })

  return (
    <div className="flex flex-col gap-6">
      {group && (
        <Field
          label="Name"
          hint={
            room.is_admin
              ? "Everybody in the room sees the new name, and a line in the thread says who changed it."
              : "Only an admin of the group can rename it."
          }
        >
          <div className="flex gap-2">
            <Input
              value={title}
              disabled={!room.is_admin}
              maxLength={80}
              onChange={(event) => setTitle(event.target.value)}
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  title.trim() !== "" &&
                  title.trim() !== room.title
                ) {
                  rename.mutate()
                }
              }}
            />
            {room.is_admin && (
              <Button
                variant="ghost"
                pending={rename.isPending}
                disabled={title.trim() === "" || title.trim() === room.title}
                onClick={() => rename.mutate()}
              >
                Save
              </Button>
            )}
          </div>
        </Field>
      )}
      <Problem error={rename.error} />

      <div className="flex flex-col gap-3">
        <p className="text-meta font-medium text-body">Just for you</p>
        <Checkbox
          label="Mute — still counted as unread, but never asks for attention"
          checked={room.muted}
          disabled={preferences.isPending}
          onChange={(muted) => preferences.mutate({ muted })}
        />
        <Checkbox
          label="Pin to the top of the list"
          checked={room.pinned}
          disabled={preferences.isPending}
          onChange={(pinned) => preferences.mutate({ pinned })}
        />
        <Checkbox
          label="Archive — out of the list until somebody writes in it"
          checked={room.archived}
          disabled={preferences.isPending}
          onChange={(archived) => preferences.mutate({ archived })}
        />
      </div>

      {group && (
        <div className="flex flex-col gap-2 border-t border-hairline pt-5">
          <p className="text-[0.875rem] text-body">
            Leaving takes you out of the room and its history. Somebody still in
            it can add you back.
          </p>
          <div>
            <LeaveButton
              conversationId={room.conversation_id}
              me={me}
              onLeft={onLeft}
              onLeftNote={onLeftNote}
            />
          </div>
        </div>
      )}
      <SavedDialog
        open={note !== null}
        onOpenChange={(next) => {
          if (!next) setNote(null)
        }}
        title={note ?? ""}
      />
    </div>
  )
}

/// Leaving is removing yourself — `DELETE …/participants/{me}` — which is why
/// it lives with the members as well as here.
function LeaveButton({
  conversationId,
  me,
  onLeft,
  onLeftNote,
}: {
  conversationId: string
  me: string | undefined
  onLeft: () => void
  /// Said before `onLeft` walks away — the receipt outlives this sheet.
  onLeftNote: (said: string) => void
}) {
  const client = useQueryClient()
  const leave = useMutation({
    mutationFn: () => removeParticipant(conversationId, me ?? ""),
    onSuccess: () => {
      client.removeQueries({
        queryKey: workplaceKeys.conversation(conversationId),
      })
      void client.invalidateQueries({
        queryKey: workplaceKeys.conversations(),
        exact: true,
      })
      onLeftNote("You left the group")
      onLeft()
    },
    // A refusal is said inside the confirmation that asked for it.
  })
  return (
    <ConfirmButton
      label="Leave group"
      title="Leave this group?"
      description="You will stop receiving its messages and lose access to its history."
      confirmLabel="Leave"
      tone="danger"
      variant="danger"
      disabled={me === undefined || me === ""}
      pending={leave.isPending}
      onConfirm={() => leave.mutateAsync()}
    />
  )
}

function Members({
  room,
  me,
  onLeft,
  onLeftNote,
}: {
  room: ChatConversation
  me: string | undefined
  onLeft: () => void
  onLeftNote: (said: string) => void
}) {
  const write = useRoomWriter(room.conversation_id)
  const group = room.kind === "GROUP"
  const [adding, setAdding] = useState<readonly string[]>([])

  const users = useQuery({
    queryKey: systemKeys.users(),
    queryFn: ({ signal }) => listUsers(signal),
    enabled: group && room.is_admin,
  })

  const choices = useMemo<Choice[]>(
    () =>
      (users.data?.rows ?? [])
        .filter(
          (user) => user.active && !room.participants.includes(user.username)
        )
        .map((user) => ({
          value: user.username,
          label:
            user.display_name.trim() === "" ? user.username : user.display_name,
        })),
    [users.data, room.participants]
  )

  const add = useMutation({
    mutationFn: () => addParticipants(room.conversation_id, [...adding]),
    onSuccess: (updated) => {
      write(updated)
      setAdding([])
    },
  })

  const admin = useMutation({
    mutationFn: (change: { username: string; isAdmin: boolean }) =>
      setParticipantAdmin(
        room.conversation_id,
        change.username,
        change.isAdmin
      ),
    onSuccess: write,
    onError: (error: Error) => toast.error(error.message),
  })

  const remove = useMutation({
    mutationFn: (username: string) =>
      removeParticipant(room.conversation_id, username),
    onSuccess: (updated) => write(updated ?? undefined),
    onError: (error: Error) => toast.error(error.message),
  })

  return (
    <div className="flex flex-col gap-5">
      <ul className="flex flex-col">
        {room.members.map((member) => {
          const self = member.username === me
          return (
            <li
              key={member.username}
              className="flex items-center gap-3 border-b border-hairline py-2.5 last:border-b-0"
            >
              <Avatar name={member.display_name} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-[0.875rem] font-medium text-ink">
                    {self
                      ? `${member.display_name} (you)`
                      : member.display_name}
                  </span>
                  {group && member.is_admin && (
                    <Pill tone="accent">
                      <ShieldCheck className="size-3" /> Admin
                    </Pill>
                  )}
                </div>
                <span className="text-pill text-mute">@{member.username}</span>
              </div>
              {group && room.is_admin && !self && (
                <Menu.Root>
                  <Menu.Trigger
                    aria-label={`Manage ${member.display_name}`}
                    className="grid size-8 shrink-0 place-items-center rounded-inner text-line-ico transition-colors hover:bg-soft-2 hover:text-ink"
                  >
                    <MoreHorizontal className="size-4" />
                  </Menu.Trigger>
                  <Menu.Portal>
                    <Menu.Positioner
                      side="bottom"
                      align="end"
                      sideOffset={4}
                      className={POSITIONER}
                    >
                      <Menu.Popup className={POPUP}>
                        <Menu.Item
                          className={ITEM}
                          onClick={() =>
                            admin.mutate({
                              username: member.username,
                              isAdmin: !member.is_admin,
                            })
                          }
                        >
                          {member.is_admin ? "Remove as admin" : "Make admin"}
                        </Menu.Item>
                        <Menu.Item
                          className={cn(ITEM, "text-bad-fg")}
                          onClick={() => remove.mutate(member.username)}
                        >
                          Remove from group
                        </Menu.Item>
                      </Menu.Popup>
                    </Menu.Positioner>
                  </Menu.Portal>
                </Menu.Root>
              )}
            </li>
          )
        })}
      </ul>

      {group && room.is_admin && (
        <Field
          label="Add people"
          hint="They join reading from the line that says they were added, and can scroll back through what came before."
        >
          <div className="flex flex-col gap-2">
            <PickMany
              label="Add people"
              choices={choices}
              values={adding}
              onChange={setAdding}
              leading={(name) => <Avatar name={name} size="sm" />}
            />
            <div>
              <Button
                variant="primary"
                pending={add.isPending}
                disabled={adding.length === 0}
                onClick={() => add.mutate()}
              >
                Add {adding.length > 0 ? adding.length : ""}
              </Button>
            </div>
          </div>
        </Field>
      )}
      <Problem error={users.error} />
      <Problem error={add.error} />

      {group && (
        <div>
          <LeaveButton
            conversationId={room.conversation_id}
            me={me}
            onLeft={onLeft}
            onLeftNote={onLeftNote}
          />
        </div>
      )}
      {!group && (
        <p className="text-meta text-mute">
          A direct conversation is always between these two. To bring somebody
          else in, start a group.
        </p>
      )}
    </div>
  )
}

function Pinned({
  conversationId,
  onJump,
}: {
  conversationId: string
  onJump: (seq: number) => void
}) {
  const client = useQueryClient()
  const pins = useQuery({
    queryKey: workplaceKeys.pins(conversationId),
    queryFn: ({ signal }) => pinnedMessages(conversationId, signal),
  })
  const unpin = useMutation({
    mutationFn: (message: ChatMessage) =>
      pinMessage(conversationId, message.seq, false),
    onSuccess: (message) => {
      client.setQueryData<ChatMessage[]>(
        workplaceKeys.pins(conversationId),
        (held) => held?.filter((one) => one.seq !== message.seq)
      )
      client.setQueryData<ChatMessage[]>(
        workplaceKeys.messages(conversationId),
        (held) => upsertMessage(held, message)
      )
    },
    onError: (error: Error) => toast.error(error.message),
  })

  return queryState(pins, {
    loading: "Loading the pins…",
    render: (list) =>
      list.length === 0 ? (
        <EmptyState>
          Nothing is pinned. Pin a message from its menu to keep it here for
          everybody in the room.
        </EmptyState>
      ) : (
        <ul className="flex flex-col gap-2">
          {list.map((message) => (
            <li
              key={message.seq}
              className="flex items-start gap-2.5 rounded-inner border border-hairline p-3"
            >
              <Pin className="mt-0.5 size-3.5 shrink-0 text-accent" />
              <button
                type="button"
                onClick={() => onJump(message.seq)}
                className="min-w-0 flex-1 text-left"
              >
                <span className="flex items-baseline gap-2">
                  <span className="truncate text-meta font-medium text-ink">
                    {message.author_name}
                  </span>
                  <span className="shrink-0 text-pill text-mute tabular-nums">
                    {dayOf(message.sent_at)} {clock(message.sent_at)}
                  </span>
                </span>
                <span className="mt-0.5 line-clamp-3 text-[0.875rem] text-body">
                  {plainText(message.body) ||
                    (message.attachments.length > 0 ? "📎 Attachment" : "")}
                </span>
              </button>
              <Button
                variant="quiet"
                size="icon"
                aria-label="Unpin"
                title="Unpin"
                onClick={() => unpin.mutate(message)}
              >
                <PinOff />
              </Button>
            </li>
          ))}
        </ul>
      ),
  })
}

function Files({ conversationId }: { conversationId: string }) {
  const files = useQuery({
    queryKey: workplaceKeys.conversationFiles(conversationId),
    queryFn: ({ signal }) => conversationFiles(conversationId, signal),
  })
  return queryState(files, {
    loading: "Loading the files…",
    render: (stored) =>
      stored.length === 0 ? (
        <EmptyState>Nothing has been attached in this conversation.</EmptyState>
      ) : (
        <MiniTable head={["File", "Size", "When"]}>
          {stored.map((file) => (
            <tr key={file.file_id} className="border-t border-hairline">
              <td className="py-2 pr-2">
                <div className="flex items-center gap-2.5">
                  <FileTile name={file.file_name} />
                  <div className="min-w-0">
                    {/* The file's other home. `source_id` on the Files
                        screen is this conversation, so the two cross into
                        each other rather than dead-ending. */}
                    <AppLink
                      to="/library"
                      sheet={{ key: "file", value: file.file_id }}
                      className="block truncate text-[0.875rem] text-ink hover:text-accent"
                    >
                      {file.file_name}
                    </AppLink>
                    {file.available ? (
                      <a
                        href={chatAttachmentUrl(conversationId, file.file_id)}
                        className="text-pill text-mute hover:text-accent"
                      >
                        {file.uploaded_by} · download
                      </a>
                    ) : (
                      <span className="text-pill text-mute">
                        the bytes are gone
                      </span>
                    )}
                  </div>
                </div>
              </td>
              <td className="py-2 text-right tabular-nums">
                {bytes(file.byte_size)}
              </td>
              <td className="py-2 text-right tabular-nums">
                {ago(file.uploaded_at)}
              </td>
            </tr>
          ))}
        </MiniTable>
      ),
  })
}
