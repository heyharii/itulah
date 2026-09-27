import { Fragment, type ReactNode } from "react"

import { cn } from "@/lib/utils"

/// What a discussion post says, drawn.
///
/// Discourse writes posts in Markdown, and the owner's reference forum is
/// Discourse, so a post here takes the handful of marks people already type
/// without being told: `**bold**`, `*italic*`, `` `code` ``, fenced blocks,
/// `> quotes`, lists, `[links](https://…)`, bare URLs and `@names`.
///
/// # Why this is a small parser and not a library
///
/// Every Markdown library either returns HTML — which then has to be put into
/// the page with `dangerouslySetInnerHTML` and sanitised, and a sanitiser is
/// one more thing to be wrong about on a page every employee reads — or pulls
/// in a whole AST toolchain for eight marks. This builds React elements
/// directly, so a post can never become markup: `<script>` in a post is the
/// seven characters somebody typed, and a link is only ever `http(s)`, `mailto`
/// or a path inside this app.
///
/// What it does NOT do is on purpose too: no raw HTML, no images (a file is an
/// attachment, reached through the thread), no tables.

/// Whether a link may be followed from a post.
///
/// `javascript:` and `data:` are the two that matter, and they are refused by
/// only allowing what is known: the web, mail, and paths inside this app
/// (which start with one `/`, not two — `//evil.example` is another site).
function safeHref(raw: string): string | null {
  const href = raw.trim()
  if (/^https?:\/\/[^\s]+$/i.test(href)) return href
  if (/^mailto:[^\s]+$/i.test(href)) return href
  if (/^\/(?!\/)[^\s]*$/.test(href)) return href
  return null
}

function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && /[\p{L}\p{N}_]/u.test(ch)
}

function isNameChar(ch: string | undefined): boolean {
  return ch !== undefined && /[A-Za-z0-9._-]/.test(ch)
}

/// Punctuation that ends a sentence rather than a URL. "see https://x.id/a."
/// links to `/a`, not to `/a.`.
function trimUrl(url: string): string {
  let end = url.length
  while (end > 0 && /[.,;:!?'")\]]/.test(url[end - 1])) {
    // A closing bracket that has its opening one inside the URL is part of it:
    // Wikipedia's `Foo_(bar)`.
    if (url[end - 1] === ")") {
      const inner = url.slice(0, end)
      const opens = (inner.match(/\(/g) ?? []).length
      const closes = (inner.match(/\)/g) ?? []).length
      if (opens >= closes) break
    }
    end -= 1
  }
  return url.slice(0, end)
}

const LINK =
  "font-medium text-accent underline decoration-accent/30 underline-offset-2 hover:decoration-accent"

/// One line's worth of marks, as React nodes.
function inline(
  text: string,
  me: string | undefined,
  prefix: string
): ReactNode[] {
  const out: ReactNode[] = []
  let buffer = ""
  let key = 0
  const next = () => `${prefix}-${key++}`
  const flush = () => {
    if (buffer !== "") {
      out.push(buffer)
      buffer = ""
    }
  }

  let i = 0
  while (i < text.length) {
    const ch = text[i]
    const prev = i > 0 ? text[i - 1] : undefined
    const rest = text.slice(i)

    // `code` — nothing inside it is read as a mark.
    if (ch === "`") {
      const close = text.indexOf("`", i + 1)
      if (close > i + 1) {
        flush()
        out.push(
          <code
            key={next()}
            className="rounded-[0.25rem] bg-soft-2 px-1 py-px font-mono text-[0.8125rem] text-ink"
          >
            {text.slice(i + 1, close)}
          </code>
        )
        i = close + 1
        continue
      }
    }

    // [label](href)
    if (ch === "[") {
      const match = /^\[([^\]\n]+)\]\(([^)\s]+)\)/.exec(rest)
      const href = match ? safeHref(match[2]) : null
      if (match && href !== null) {
        flush()
        const external = /^https?:/i.test(href)
        out.push(
          <a
            key={next()}
            href={href}
            className={LINK}
            {...(external
              ? { target: "_blank", rel: "noopener noreferrer" }
              : {})}
          >
            {inline(match[1], me, `${prefix}-l${key}`)}
          </a>
        )
        i += match[0].length
        continue
      }
    }

    // A bare address.
    if ((ch === "h" || ch === "H") && !isWordChar(prev)) {
      const match = /^https?:\/\/[^\s<>]+/i.exec(rest)
      if (match) {
        const url = trimUrl(match[0])
        if (/^https?:\/\/[^/]/i.test(url)) {
          flush()
          out.push(
            <a
              key={next()}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(LINK, "break-all")}
            >
              {url}
            </a>
          )
          i += url.length
          continue
        }
      }
    }

    // **bold** and ~~struck~~
    const pair = rest.startsWith("**")
      ? "**"
      : rest.startsWith("~~")
        ? "~~"
        : null
    if (pair !== null && text[i + 2] !== undefined && text[i + 2] !== " ") {
      const close = text.indexOf(pair, i + 2)
      if (close > i + 2 && text[close - 1] !== " ") {
        flush()
        const k = next()
        const inner = inline(text.slice(i + 2, close), me, k)
        out.push(
          pair === "**" ? (
            <strong key={k} className="font-semibold text-ink">
              {inner}
            </strong>
          ) : (
            <del key={k} className="text-mute">
              {inner}
            </del>
          )
        )
        i = close + 2
        continue
      }
    }

    // *italic* and _italic_ — the underscore only at a word's edge, so
    // `purchase_order_line` stays one word.
    if (
      (ch === "*" || (ch === "_" && !isWordChar(prev))) &&
      text[i + 1] !== undefined &&
      text[i + 1] !== " " &&
      text[i + 1] !== ch
    ) {
      let close = text.indexOf(ch, i + 1)
      while (
        close !== -1 &&
        (text[close - 1] === " " || (ch === "_" && isWordChar(text[close + 1])))
      ) {
        close = text.indexOf(ch, close + 1)
      }
      if (close > i + 1) {
        flush()
        const k = next()
        out.push(
          <em key={k} className="italic">
            {inline(text.slice(i + 1, close), me, k)}
          </em>
        )
        i = close + 1
        continue
      }
    }

    // @name — not the @ inside an address.
    if (ch === "@" && !isNameChar(prev) && prev !== "@") {
      const match = /^@([A-Za-z0-9][A-Za-z0-9._-]*)/.exec(rest)
      if (match) {
        const name = match[1].replace(/[.-]+$/, "")
        flush()
        const mine = me !== undefined && name.toLowerCase() === me.toLowerCase()
        out.push(
          <span
            key={next()}
            className={cn(
              "rounded-[0.25rem] px-0.5 font-medium",
              mine ? "bg-accent-bg text-accent" : "text-accent"
            )}
          >
            @{name}
          </span>
        )
        i += 1 + name.length
        continue
      }
    }

    buffer += ch
    i += 1
  }
  flush()
  return out
}

type Block =
  | { kind: "paragraph"; lines: string[] }
  | { kind: "heading"; text: string }
  | { kind: "code"; text: string }
  | { kind: "quote"; lines: string[] }
  | { kind: "list"; ordered: boolean; start: number; items: string[] }
  | { kind: "rule" }

const BULLET = /^\s{0,3}[-*+]\s+(.*)$/
const NUMBERED = /^\s{0,3}(\d{1,9})[.)]\s+(.*)$/
const FENCE = /^\s{0,3}(```|~~~)/
const HEADING = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/
const RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/
const QUOTE = /^\s{0,3}>\s?(.*)$/

function blocks(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n")
  const out: Block[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]

    if (line.trim() === "") {
      i += 1
      continue
    }

    const fence = FENCE.exec(line)
    if (fence) {
      const body: string[] = []
      i += 1
      while (i < lines.length && !lines[i].trimStart().startsWith(fence[1])) {
        body.push(lines[i])
        i += 1
      }
      i += 1 // the closing fence, or past the end if it was never closed
      out.push({ kind: "code", text: body.join("\n") })
      continue
    }

    if (RULE.test(line)) {
      out.push({ kind: "rule" })
      i += 1
      continue
    }

    const heading = HEADING.exec(line)
    if (heading) {
      out.push({ kind: "heading", text: heading[1] })
      i += 1
      continue
    }

    if (QUOTE.test(line)) {
      const quoted: string[] = []
      while (i < lines.length && QUOTE.test(lines[i])) {
        quoted.push(QUOTE.exec(lines[i])?.[1] ?? "")
        i += 1
      }
      out.push({ kind: "quote", lines: quoted })
      continue
    }

    const bullet = BULLET.exec(line)
    const numbered = NUMBERED.exec(line)
    if (bullet || numbered) {
      const ordered = numbered !== null && bullet === null
      const pattern = ordered ? NUMBERED : BULLET
      const items: string[] = []
      while (i < lines.length) {
        const item = pattern.exec(lines[i])
        if (item) {
          items.push(ordered ? item[2] : item[1])
        } else if (
          lines[i].trim() !== "" &&
          /^\s{2,}/.test(lines[i]) &&
          items.length > 0
        ) {
          // An indented line carries on the item above it.
          items[items.length - 1] += `\n${lines[i].trim()}`
        } else {
          break
        }
        i += 1
      }
      out.push({
        kind: "list",
        ordered,
        start: ordered ? Number(numbered?.[1] ?? 1) : 1,
        items,
      })
      continue
    }

    const paragraph: string[] = []
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !FENCE.test(lines[i]) &&
      !QUOTE.test(lines[i]) &&
      !HEADING.test(lines[i]) &&
      !(
        paragraph.length > 0 &&
        (BULLET.test(lines[i]) || NUMBERED.test(lines[i]))
      )
    ) {
      paragraph.push(lines[i])
      i += 1
    }
    out.push({ kind: "paragraph", lines: paragraph })
  }
  return out
}

/// Lines of one block, with the line breaks somebody typed kept — a post is
/// written in a textarea, and a textarea's Enter means a new line.
function lined(
  lines: readonly string[],
  me: string | undefined,
  prefix: string
) {
  return lines.map((line, index) => (
    <Fragment key={`${prefix}-${index}`}>
      {index > 0 && <br />}
      {inline(line, me, `${prefix}-${index}`)}
    </Fragment>
  ))
}

function render(
  source: string,
  me: string | undefined,
  prefix: string
): ReactNode[] {
  return blocks(source).map((block, index) => {
    const key = `${prefix}-${index}`
    switch (block.kind) {
      case "paragraph":
        return <p key={key}>{lined(block.lines, me, key)}</p>
      case "heading":
        return (
          <p key={key} className="font-semibold text-ink">
            {inline(block.text, me, key)}
          </p>
        )
      case "code":
        return (
          <pre
            key={key}
            className="overflow-x-auto rounded-inner bg-soft-2 px-3 py-2 font-mono text-[0.8125rem] leading-relaxed text-ink"
          >
            <code>{block.text}</code>
          </pre>
        )
      case "quote":
        return (
          <blockquote
            key={key}
            className="border-l-2 border-hairline-strong pl-3 text-body"
          >
            {render(block.lines.join("\n"), me, key)}
          </blockquote>
        )
      case "list": {
        const items = block.items.map((item, itemIndex) => (
          <li key={`${key}-${itemIndex}`} className="pl-1">
            {lined(item.split("\n"), me, `${key}-${itemIndex}`)}
          </li>
        ))
        return block.ordered ? (
          <ol key={key} start={block.start} className="list-decimal pl-5">
            {items}
          </ol>
        ) : (
          <ul key={key} className="list-disc pl-5">
            {items}
          </ul>
        )
      }
      case "rule":
        return <hr key={key} className="border-hairline" />
    }
  })
}

/// A post's words, drawn. `me` lights up the reader's own `@name`, the way a
/// forum makes you find yourself in a long thread.
export function Markdown({
  text,
  me,
  className,
}: {
  text: string
  me?: string
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-2.5 text-[0.875rem] leading-[1.65] break-words text-text",
        className
      )}
    >
      {render(text, me, "md")}
    </div>
  )
}
