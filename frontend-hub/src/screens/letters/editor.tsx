import { Menu } from "@base-ui/react/menu"
import {
  EditorContent,
  Extension,
  generateHTML,
  useEditor,
  useEditorState,
  type Editor,
  type JSONContent,
} from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold,
  CalendarDays,
  ChevronDown,
  Italic,
  List,
  ListOrdered,
  Minus,
  Plus,
  Redo2,
  RemoveFormatting,
  Strikethrough,
  Underline,
  Undo2,
} from "lucide-react"
import { useEffect, useRef } from "react"

import { dayIndonesian } from "@/lib/format"
import { POP_MOTION } from "@/lib/filter-chrome"
import { cn } from "@/lib/utils"

/// The prose of a letter — the part a person writes.
///
/// # Why a rich text editor at all, and why this one
///
/// Tiptap (ProseMirror underneath): it stores a DOCUMENT rather than a string
/// of HTML, so what the server holds is structured and what prints is ours to
/// lay out; it is MIT; and its editable surface is an ordinary element, which
/// is what lets the editor be the paper itself rather than a box beside a
/// preview.
///
/// # The format bar
///
/// The owner asked for a letter that appears editable "dengan formatting
/// menu" (2026-10-17): the bar floats over the paper and formats the prose —
/// undo, normal text or heading, bold, italic, underline, strike, the four
/// alignments, the two lists, Insert, clear. It used to be four buttons above
/// the paragraph; a letter somebody signs needs its alignment as much as its
/// emphasis.

/// Alignment as an attribute of a paragraph or heading, so it is saved in the
/// document and printed where it was set. Tiptap's own TextAlign is a package
/// this app does not carry; this is all of it that a letter needs.
const TextAlign = Extension.create({
  name: "textAlign",
  addGlobalAttributes() {
    return [
      {
        types: ["paragraph", "heading"],
        attributes: {
          textAlign: {
            default: null,
            parseHTML: (element: HTMLElement) =>
              element.style.textAlign || null,
            renderHTML: (attributes: Record<string, unknown>) =>
              typeof attributes.textAlign === "string"
                ? { style: `text-align: ${attributes.textAlign}` }
                : {},
          },
        },
      },
    ]
  },
})

const EXTENSIONS = [
  StarterKit.configure({ link: false, code: false, codeBlock: false }),
  TextAlign,
]

/// The prose as it reads on paper: 14px on the sheet, like every printed paper.
export const PROSE_CSS =
  "letter-prose text-[0.875rem] leading-[1.65] text-ink outline-none " +
  "[&_p]:mb-2.5 [&_p:last-child]:mb-0 [&_p:empty]:min-h-[1.4em] " +
  "[&_h3]:mt-1 [&_h3]:mb-2 [&_h3]:text-[0.9375rem] [&_h3]:font-semibold " +
  "[&_ul]:mb-2.5 [&_ul]:list-disc [&_ul]:pl-5 " +
  "[&_ol]:mb-2.5 [&_ol]:list-decimal [&_ol]:pl-5 " +
  "[&_li]:mb-0.5 [&_strong]:font-semibold " +
  "[&_hr]:my-3 [&_hr]:border-hairline-strong"

/// Whether the stored body is a document or the empty object a new draft
/// carries.
export function hasContent(body: unknown): body is JSONContent {
  return typeof body === "object" && body !== null && "type" in body
}

/// The prose as HTML, for the printed copies and the preview — the same
/// extensions, so the alignment and the marks print as they were set.
export function proseHtml(body: unknown): string {
  return hasContent(body) ? generateHTML(body, EXTENSIONS) : ""
}

export function useLetterEditor({
  body,
  editable,
  onChange,
}: {
  body: unknown
  editable: boolean
  onChange: (body: JSONContent) => void
}): Editor | null {
  // What the letter said when it was opened. Tiptap settles the document it is
  // handed — and may say so with an update — and that is not somebody typing.
  const opened = useRef<string | null>(null)
  const editor = useEditor({
    extensions: EXTENSIONS,
    // An empty letter is an empty document, not an empty string: Tiptap is
    // given `undefined` rather than `{}`, which it would reject.
    content: hasContent(body) ? body : undefined,
    editable,
    immediatelyRender: false,
    // An update that is a PERSON typing, and not the editor settling in: a
    // letter that cannot be edited never reports a change, and an empty
    // editor over an empty stored body is the state it started in.
    onCreate: ({ editor: current }) => {
      opened.current = JSON.stringify(current.getJSON())
    },
    onUpdate: ({ editor: current }) => {
      if (!current.isEditable) return
      // Somebody typing, or a format bar command (they focus the prose first);
      // never the editor normalising what it was handed.
      if (!current.isFocused) return
      if (current.isEmpty && !hasContent(body)) return
      const next = current.getJSON()
      if (JSON.stringify(next) === opened.current) return
      opened.current = null
      onChange(next)
    },
    editorProps: { attributes: { class: PROSE_CSS } },
  })

  // Issuing makes the letter read-only, and the editor caches `editable` at
  // creation: without this the prose stays typeable on a document that can no
  // longer be saved.
  useEffect(() => {
    editor?.setEditable(editable)
  }, [editor, editable])

  return editor
}

export function LetterProse({ editor }: { editor: Editor | null }) {
  return <EditorContent editor={editor} />
}

/// Something the caller adds to Insert — the items table's next row.
export interface InsertItem {
  readonly label: string
  readonly icon: React.ComponentType<{ className?: string }>
  readonly onSelect: () => void
}

const ALIGNS = [
  { value: "left", label: "Align left", icon: AlignLeft },
  { value: "center", label: "Centre", icon: AlignCenter },
  { value: "right", label: "Align right", icon: AlignRight },
  { value: "justify", label: "Justify", icon: AlignJustify },
] as const

const MENU_ITEM =
  "flex min-h-9 cursor-default items-center gap-2.5 rounded-inner px-2.5 text-[0.9375rem] text-ink outline-none select-none data-[highlighted]:bg-soft-2 [&_svg]:size-4 [&_svg]:text-line-ico"

/// The format bar, floating over the paper while the letter is a draft.
export function FormatBar({
  editor,
  inserts = [],
  className,
}: {
  editor: Editor
  inserts?: readonly InsertItem[]
  className?: string
}) {
  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      bold: current.isActive("bold"),
      italic: current.isActive("italic"),
      underline: current.isActive("underline"),
      strike: current.isActive("strike"),
      heading: current.isActive("heading"),
      bullet: current.isActive("bulletList"),
      ordered: current.isActive("orderedList"),
      align:
        ALIGNS.find(
          (one) =>
            one.value !== "left" && current.isActive({ textAlign: one.value })
        )?.value ?? "left",
      undo: current.can().undo(),
      redo: current.can().redo(),
    }),
  })

  const chain = () => editor.chain().focus()
  const align = (value: string) =>
    chain()
      .updateAttributes("paragraph", { textAlign: value === "left" ? null : value })
      .updateAttributes("heading", { textAlign: value === "left" ? null : value })
      .run()

  return (
    <div
      role="toolbar"
      aria-label="Format"
      // The caret stays in the prose while a button is pressed.
      onMouseDown={(event) => {
        if ((event.target as HTMLElement).closest("button[data-keep]"))
          event.preventDefault()
      }}
      className={cn(
        "flex flex-wrap items-center justify-center gap-px rounded-[0.75rem] bg-canvas p-1 shadow-[0_0_0_1px_rgba(0,0,0,0.06),0_6px_20px_rgba(0,0,0,0.07)]",
        className
      )}
    >
      <Tool
        label="Undo"
        keys="⌘Z"
        disabled={!state.undo}
        onClick={() => chain().undo().run()}
      >
        <Undo2 />
      </Tool>
      <Tool
        label="Redo"
        keys="⇧⌘Z"
        disabled={!state.redo}
        onClick={() => chain().redo().run()}
      >
        <Redo2 />
      </Tool>
      <Divider />
      <Menu.Root>
        <Menu.Trigger className="inline-flex h-8 items-center gap-1 rounded-inner pr-1.5 pl-2 text-[0.9375rem] text-ink transition-colors duration-(--t-hover) hover:bg-soft-2">
          <span className="min-w-[5.5rem] text-left">
            {state.heading ? "Heading" : "Normal text"}
          </span>
          <ChevronDown className="size-4 text-body" />
        </Menu.Trigger>
        <MenuPop>
          <Menu.Item
            className={MENU_ITEM}
            onClick={() => chain().setParagraph().run()}
          >
            Normal text
          </Menu.Item>
          <Menu.Item
            className={cn(MENU_ITEM, "font-semibold")}
            onClick={() => chain().setHeading({ level: 3 }).run()}
          >
            Heading
          </Menu.Item>
        </MenuPop>
      </Menu.Root>
      <Divider />
      <Tool
        label="Bold"
        keys="⌘B"
        on={state.bold}
        onClick={() => chain().toggleBold().run()}
      >
        <Bold />
      </Tool>
      <Tool
        label="Italic"
        keys="⌘I"
        on={state.italic}
        onClick={() => chain().toggleItalic().run()}
      >
        <Italic />
      </Tool>
      <Tool
        label="Underline"
        keys="⌘U"
        on={state.underline}
        onClick={() => chain().toggleUnderline().run()}
      >
        <Underline />
      </Tool>
      <Tool
        label="Strikethrough"
        on={state.strike}
        onClick={() => chain().toggleStrike().run()}
      >
        <Strikethrough />
      </Tool>
      <Divider />
      {ALIGNS.map((one) => (
        <Tool
          key={one.value}
          label={one.label}
          on={state.align === one.value}
          onClick={() => align(one.value)}
        >
          <one.icon />
        </Tool>
      ))}
      <Divider />
      <Tool
        label="Bulleted list"
        on={state.bullet}
        onClick={() => chain().toggleBulletList().run()}
      >
        <List />
      </Tool>
      <Tool
        label="Numbered list"
        on={state.ordered}
        onClick={() => chain().toggleOrderedList().run()}
      >
        <ListOrdered />
      </Tool>
      <Divider />
      <Menu.Root>
        <Menu.Trigger className="inline-flex h-8 items-center gap-1 rounded-inner px-2 text-[0.9375rem] text-ink transition-colors duration-(--t-hover) hover:bg-soft-2">
          <Plus className="size-4 text-body" />
          Insert
          <ChevronDown className="size-4 text-body" />
        </Menu.Trigger>
        <MenuPop>
          {inserts.map((one) => (
            <Menu.Item
              key={one.label}
              className={MENU_ITEM}
              onClick={one.onSelect}
            >
              <one.icon />
              {one.label}
            </Menu.Item>
          ))}
          <Menu.Item
            className={MENU_ITEM}
            onClick={() =>
              chain().insertContent(dayIndonesian(new Date())).run()
            }
          >
            <CalendarDays />
            Today's date
          </Menu.Item>
          <Menu.Item
            className={MENU_ITEM}
            onClick={() => chain().setHorizontalRule().run()}
          >
            <Minus />
            Line
          </Menu.Item>
        </MenuPop>
      </Menu.Root>
      <Tool
        label="Clear formatting"
        onClick={() => chain().unsetAllMarks().clearNodes().run()}
      >
        <RemoveFormatting />
      </Tool>
    </div>
  )
}

function Tool({
  label,
  keys,
  on = false,
  disabled = false,
  onClick,
  children,
}: {
  label: string
  keys?: string
  on?: boolean
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      data-keep
      title={keys ? `${label} · ${keys}` : label}
      aria-label={label}
      aria-pressed={on}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "grid size-8 place-items-center rounded-inner transition-[background-color,color,scale] duration-(--t-press) ease-(--ease-out) active:scale-[0.94] disabled:opacity-35 [&_svg]:size-[1.125rem] [&_svg]:stroke-[1.7]",
        on ? "bg-accent-bg text-accent" : "text-ink hover:bg-soft-2"
      )}
    >
      {children}
    </button>
  )
}

function Divider() {
  return <span aria-hidden className="mx-0.5 h-5 w-px bg-hairline-2" />
}

function MenuPop({ children }: { children: React.ReactNode }) {
  return (
    <Menu.Portal>
      <Menu.Positioner side="bottom" align="start" sideOffset={6} className="z-50">
        <Menu.Popup
          className={cn(
            "min-w-[12rem] rounded-card border border-hairline bg-canvas p-1.5 shadow-pop",
            POP_MOTION
          )}
        >
          {children}
        </Menu.Popup>
      </Menu.Positioner>
    </Menu.Portal>
  )
}

/// The prose of a letter drawn from a record — a goods receipt note, a
/// delivery note — with the same format bar, set above it on the paper.
export function LetterBody({
  body,
  editable,
  onChange,
}: {
  body: Record<string, unknown>
  editable: boolean
  onChange: (body: JSONContent) => void
}) {
  const editor = useLetterEditor({ body, editable, onChange })
  if (editor === null) return null
  return (
    <div>
      {editable && (
        <FormatBar
          editor={editor}
          className="srt-noprint mb-3 justify-start shadow-[0_0_0_1px_var(--hairline)]"
        />
      )}
      <LetterProse editor={editor} />
    </div>
  )
}
