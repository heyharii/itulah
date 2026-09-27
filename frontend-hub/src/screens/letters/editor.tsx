import { EditorContent, useEditor, type JSONContent } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"
import { Bold, Italic, List, ListOrdered } from "lucide-react"
import { useEffect } from "react"

import { cn } from "@/lib/utils"

/// The one part of a letter a person writes.
///
/// # Why a rich text editor at all, and why this one
///
/// Everything else on these letters comes from a record and must not be typed:
/// the quantities, the codes, the supplier, the destination. What is left is
/// the paragraph that says the thing no database knows — "dua koli basah,
/// sudah difoto", "sisa dikirim menyusul minggu depan" — and that paragraph is
/// the reason a letter has a person's signature on it rather than a checksum.
///
/// Tiptap (ProseMirror underneath), chosen over the alternatives for reasons
/// that are about this document and not about features: it stores a DOCUMENT
/// rather than a string of HTML, so what the server holds is structured and
/// what prints is ours to lay out; it is MIT; and its editable surface is an
/// ordinary element, which is what lets the editor be the paper itself rather
/// than a box beside a preview. BlockNote gives a Notion-style block UI, which
/// is the wrong grammar for a letter; Plate carries a much larger surface and
/// its own design system; Lexical would mean assembling tables and lists by
/// hand.
///
/// # Why the toolbar is three buttons
///
/// A goods receipt note with a heading, a quote block and a code fence is not
/// a goods receipt note. What a note on a letter needs is emphasis and a list,
/// so that is what is offered — the rest of StarterKit's marks stay reachable
/// by keyboard for anybody who wants them, and nothing advertises them.
const CONTENT_CSS =
  "prose-letter min-h-[3rem] text-[0.875rem] leading-[1.7] outline-none " +
  "[&_p]:mb-2 [&_p:last-child]:mb-0 " +
  "[&_ul]:mb-2 [&_ul]:list-disc [&_ul]:pl-5 " +
  "[&_ol]:mb-2 [&_ol]:list-decimal [&_ol]:pl-5 " +
  "[&_li]:mb-0.5 [&_strong]:font-semibold"

function Mark({
  on,
  onClick,
  title,
  children,
}: {
  on: boolean
  onClick: () => void
  title: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      title={title}
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "grid size-7 place-items-center rounded-inner transition-colors",
        on
          ? "bg-accent-bg text-accent"
          : "text-body hover:bg-soft-2 hover:text-ink"
      )}
    >
      {children}
    </button>
  )
}

export function LetterBody({
  body,
  editable,
  onChange,
}: {
  body: Record<string, unknown>
  editable: boolean
  /// Called on every keystroke. The screen decides when that becomes a save —
  /// a letter is saved by a person pressing Save, because "it saved itself
  /// while I was thinking" is not a property anybody wants in a document that
  /// is about to carry their signature.
  onChange: (body: JSONContent) => void
}) {
  const editor = useEditor({
    extensions: [StarterKit],
    // An empty letter is an empty document, not an empty string: Tiptap is
    // given `undefined` rather than `{}`, which it would reject as a document
    // with no type.
    content: hasContent(body) ? (body as JSONContent) : undefined,
    editable,
    // An update that is a PERSON typing, and not the editor settling in.
    //
    // Tiptap fires `onUpdate` once as it normalises whatever it was handed —
    // an empty letter becomes a document with one empty paragraph — and that
    // one event was enough to make the screen say "not saved yet" about a
    // letter nobody had touched, which in turn disabled Issue until somebody
    // pressed Save on nothing. So two guards: a letter that cannot be edited
    // never reports a change at all, and an empty editor over an empty stored
    // body is the state it started in rather than an edit.
    onUpdate: ({ editor }) => {
      if (!editor.isEditable) return
      if (editor.isEmpty && !hasContent(body)) return
      onChange(editor.getJSON())
    },
    editorProps: { attributes: { class: CONTENT_CSS } },
  })

  // Issuing a letter makes it read-only, and the editor has to be told: it
  // caches `editable` at creation and this screen does not remount it, so
  // without this the prose stays typeable on a document that can no longer be
  // saved — an edit somebody would lose without ever being told.
  useEffect(() => {
    editor?.setEditable(editable)
  }, [editor, editable])

  if (editor === null) return null

  return (
    <div>
      {editable && (
        <div className="srt-noprint mb-2 flex items-center gap-1 border-b border-hairline pb-2">
          <Mark
            title="Bold"
            on={editor.isActive("bold")}
            onClick={() => editor.chain().focus().toggleBold().run()}
          >
            <Bold className="size-3.5" />
          </Mark>
          <Mark
            title="Italic"
            on={editor.isActive("italic")}
            onClick={() => editor.chain().focus().toggleItalic().run()}
          >
            <Italic className="size-3.5" />
          </Mark>
          <Mark
            title="Bulleted list"
            on={editor.isActive("bulletList")}
            onClick={() => editor.chain().focus().toggleBulletList().run()}
          >
            <List className="size-3.5" />
          </Mark>
          <Mark
            title="Numbered list"
            on={editor.isActive("orderedList")}
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
          >
            <ListOrdered className="size-3.5" />
          </Mark>
          <span className="ml-2 text-pill text-mute">
            Catatan yang ikut tercetak di surat
          </span>
        </div>
      )}
      <EditorContent editor={editor} />
    </div>
  )
}

/// Whether the stored body is a document or the empty object a new draft
/// carries.
function hasContent(body: Record<string, unknown>): boolean {
  return typeof body === "object" && body !== null && "type" in body
}
