import { Fragment } from "react"

/// The answer, as the model actually writes it.
///
/// Models write markdown whether or not they are asked to, and a panel that
/// prints it verbatim shows `**Rp 229.000**` to somebody who wanted a figure.
/// Telling the model to stop is the other repair and it is the weaker one — it
/// works until it does not, and the failure is on the screen rather than in a
/// log.
///
/// So a subset is rendered here, and deliberately a small one: paragraphs,
/// bullets, bold, and inline code. No headings, no tables, no links — a reply
/// in a 30rem panel that needs a table has a card underneath it that IS the
/// table, and a heading in four sentences of prose is a model padding.
///
/// Hand-written rather than `react-markdown` plus a sanitiser, for the size of
/// the subset: this is forty lines and no supply chain, and everything it does
/// not understand it prints as the text it is.

/// `**bold**` and `` `code` ``, applied to one line.
///
/// One pass, alternating between the two markers rather than nesting them:
/// bold code is not something worth the parser it would take.
function inline(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g)
  return parts.map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return (
        <strong key={index} className="font-semibold text-ink">
          {part.slice(2, -2)}
        </strong>
      )
    }
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return (
        <code
          key={index}
          className="rounded-[3px] bg-soft px-1 font-mono text-id text-ink"
        >
          {part.slice(1, -1)}
        </code>
      )
    }
    return <Fragment key={index}>{part}</Fragment>
  })
}

const BULLET = /^\s*[-*•]\s+/

export function Prose({
  text,
  children,
}: {
  text: string
  /// Drawn immediately after the last line — the streaming caret, and nothing
  /// else. It belongs inside the final paragraph rather than under it, or the
  /// cursor jumps a line ahead of the words it is marking.
  children?: React.ReactNode
}) {
  // Blank lines separate blocks; a run of bullet lines is one block. Written
  // as a fold rather than a regex over the whole string because a half-written
  // list arrives one line at a time and must not flicker between shapes.
  const blocks: { bullets: boolean; lines: string[] }[] = []
  for (const line of text.split("\n")) {
    const bullets = BULLET.test(line)
    const last = blocks[blocks.length - 1]
    if (line.trim() === "") {
      if (last && last.lines.length > 0)
        blocks.push({ bullets: false, lines: [] })
      continue
    }
    if (last && last.bullets === bullets && last.lines.length > 0) {
      last.lines.push(line)
    } else {
      blocks.push({ bullets, lines: [line] })
    }
  }

  const drawn = blocks.filter((block) => block.lines.length > 0)

  return (
    <div className="flex flex-col gap-2 text-meta leading-relaxed text-text">
      {drawn.map((block, index) => {
        const last = index === drawn.length - 1
        if (block.bullets) {
          return (
            <ul key={index} className="flex flex-col gap-1 pl-1">
              {block.lines.map((line, row) => (
                <li key={row} className="flex gap-2">
                  <span aria-hidden className="pt-[0.4em] text-faint">
                    <span className="block size-1 rounded-full bg-current" />
                  </span>
                  <span className="min-w-0 flex-1">
                    {inline(line.replace(BULLET, ""))}
                    {last && row === block.lines.length - 1 && children}
                  </span>
                </li>
              ))}
            </ul>
          )
        }
        return (
          <p key={index}>
            {/* A wrapped line inside one paragraph is the model's own line
                break, and it means something in a list of figures. */}
            {block.lines.map((line, row) => (
              <Fragment key={row}>
                {row > 0 && <br />}
                {inline(line)}
              </Fragment>
            ))}
            {last && children}
          </p>
        )
      })}
    </div>
  )
}
