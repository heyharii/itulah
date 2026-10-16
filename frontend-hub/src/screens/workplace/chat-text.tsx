import { Fragment } from "react"

import { cn } from "@/lib/utils"

/// What somebody typed, drawn the way a chat draws it.
///
/// The small grammar every team chat settled on (Mattermost, Rocket.Chat,
/// Zulip all read it the same way): ```` ``` ```` fences a block of code,
/// `` ` `` a word of it, `**bold**`, `_italic_` or `*italic*`, `~struck~`,
/// links that are links, and `@name` for a person in the room. Nothing else —
/// no headings, no tables, no HTML: a chat line is a sentence, and a renderer
/// that accepts more than that is one somebody pastes a web page into.
///
/// Built out of React nodes, never `innerHTML`. The words are other people's,
/// and the only way they cannot become markup is if nothing here ever parses
/// them as markup.

export interface MentionTarget {
  readonly username: string
  readonly display_name: string
}

export function RichText({
  text,
  members,
  me,
}: {
  text: string
  members: readonly MentionTarget[]
  me: string | undefined
}) {
  const blocks = splitFences(text)
  return (
    <>
      {blocks.map((block, index) =>
        block.code ? (
          <pre
            key={index}
            className="my-1 overflow-x-auto rounded-md bg-soft-2 px-2.5 py-2 font-mono text-[0.9375rem] leading-snug whitespace-pre text-ink"
          >
            {block.text}
          </pre>
        ) : (
          <Fragment key={index}>{inline(block.text, members, me)}</Fragment>
        )
      )}
    </>
  )
}

/// A body split at its ```` ``` ```` fences. An unclosed fence is text: the
/// person is probably still typing it, and swallowing the rest of their
/// message into a code block would be the renderer guessing.
function splitFences(text: string): { code: boolean; text: string }[] {
  const out: { code: boolean; text: string }[] = []
  const fence = /```(?:[a-z0-9_-]*\n)?([\s\S]*?)```/gi
  let last = 0
  for (const match of text.matchAll(fence)) {
    const at = match.index ?? 0
    if (at > last) out.push({ code: false, text: text.slice(last, at) })
    out.push({ code: true, text: match[1].replace(/\n$/, "") })
    last = at + match[0].length
  }
  if (last < text.length) out.push({ code: false, text: text.slice(last) })
  return out
}

/// One run of prose: inline code first — nothing inside backticks is
/// formatting — then everything else.
function inline(
  text: string,
  members: readonly MentionTarget[],
  me: string | undefined
): React.ReactNode[] {
  const out: React.ReactNode[] = []
  const tick = /`([^`\n]+)`/g
  let last = 0
  let key = 0
  for (const match of text.matchAll(tick)) {
    const at = match.index ?? 0
    if (at > last)
      out.push(...spans(text.slice(last, at), members, me, `t${key}`))
    out.push(
      <code
        key={`c${key}`}
        className="rounded bg-soft-2 px-1 py-px font-mono text-[0.9375rem] text-ink"
      >
        {match[1]}
      </code>
    )
    key += 1
    last = at + match[0].length
  }
  if (last < text.length)
    out.push(...spans(text.slice(last), members, me, `t${key}`))
  return out
}

/// Links, mentions and emphasis, in one pass so none of them can be found
/// inside another — a URL with `_` in it stays a URL.
const SPAN =
  /(https?:\/\/[^\s<>"]+[^\s<>".,:;'!?)\]])|(?<![\p{L}\p{N}._-])@([\p{L}\p{N}._-]+)|\*\*(?=\S)([^*\n]+?)\*\*|(?<![\p{L}\p{N}*])\*(?=\S)([^*\n]+?)\*(?![\p{L}\p{N}*])|(?<![\p{L}\p{N}_])_(?=\S)([^_\n]+?)_(?![\p{L}\p{N}_])|(?<![\p{L}\p{N}~])~(?=\S)([^~\n]+?)~(?![\p{L}\p{N}~])/gu

function spans(
  text: string,
  members: readonly MentionTarget[],
  me: string | undefined,
  prefix: string
): React.ReactNode[] {
  const out: React.ReactNode[] = []
  let last = 0
  let key = 0
  for (const match of text.matchAll(SPAN)) {
    const at = match.index ?? 0
    if (at > last) out.push(text.slice(last, at))
    const id = `${prefix}-${key}`
    key += 1
    const [whole, url, mention, bold, starItalic, underItalic, strike] = match
    if (url !== undefined) {
      out.push(
        <a
          key={id}
          href={url}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className="break-all text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent"
        >
          {url}
        </a>
      )
    } else if (mention !== undefined) {
      out.push(...mentionNode(mention, members, me, id))
    } else if (bold !== undefined) {
      out.push(
        <strong key={id} className="font-semibold text-ink">
          {bold}
        </strong>
      )
    } else if (starItalic !== undefined || underItalic !== undefined) {
      out.push(<em key={id}>{starItalic ?? underItalic}</em>)
    } else if (strike !== undefined) {
      out.push(
        <s key={id} className="text-mute">
          {strike}
        </s>
      )
    } else {
      out.push(whole)
    }
    last = at + whole.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

/// `@token` as a person, when it names one — with the punctuation that ended
/// the sentence given back as text, the way the server lets go of it when it
/// decides who was mentioned.
function mentionNode(
  token: string,
  members: readonly MentionTarget[],
  me: string | undefined,
  key: string
): React.ReactNode[] {
  let name = token
  let tail = ""
  for (;;) {
    const lower = name.toLowerCase()
    const member =
      lower === "all"
        ? { username: "all", display_name: "everyone" }
        : members.find((one) => one.username.toLowerCase() === lower)
    if (member !== undefined) {
      const mine =
        member.username === "all" ||
        (me !== undefined && member.username.toLowerCase() === me.toLowerCase())
      return [
        <span
          key={key}
          title={
            member.username === "all"
              ? "Everyone in the room"
              : member.display_name
          }
          className={cn(
            "rounded px-0.5 font-medium",
            mine ? "bg-warn-bg text-warn-fg" : "text-accent"
          )}
        >
          @{name}
        </span>,
        tail,
      ]
    }
    const end = name[name.length - 1]
    if (end === "." || end === "_" || end === "-") {
      tail = end + tail
      name = name.slice(0, -1)
      if (name !== "") continue
    }
    return [`@${token}`]
  }
}

/// The body as one line of plain words, for a preview, a quote or a
/// notification — the formatting marks taken off rather than shown.
export function plainText(text: string): string {
  return text
    .replace(/```(?:[a-z0-9_-]*\n)?([\s\S]*?)```/gi, "$1")
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .replace(/(?<![\p{L}\p{N}*])\*(?=\S)([^*\n]+?)\*(?![\p{L}\p{N}*])/gu, "$1")
    .replace(/(?<![\p{L}\p{N}_])_(?=\S)([^_\n]+?)_(?![\p{L}\p{N}_])/gu, "$1")
    .replace(/(?<![\p{L}\p{N}~])~(?=\S)([^~\n]+?)~(?![\p{L}\p{N}~])/gu, "$1")
    .replace(/\s+/g, " ")
    .trim()
}
