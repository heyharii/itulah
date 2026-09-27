import { FolderOpen, MessageSquare, MessagesSquare } from "lucide-react"

import type { AppModule } from "@/lib/navigation"
import { useChatUnread } from "@/screens/workplace/chat-unread"

/// The four workspace screens, as four asides rather than one module.
///
/// # Why they left the module list
///
/// Requested by the owner 2026-09-03: "discussions, chat, files itu diluar ya
/// jangan submenu tapi mungkin pake icon atau apa."
///
/// The reason it is right: the module list is a map of the *business* — what is
/// bought, held, sold, what it cost, who did it. A conversation is not one of
/// those. It is where you talk *about* them, which is why "Workplace" as a
/// module read as a department nobody works in, and why folding four unrelated
/// screens under one row made you open a menu to reach a chat.
///
/// # Why four modules and not one with four items
///
/// Because each is a single destination, and the shell already knows what to do
/// with those: a module with one visible screen does not unfold (see
/// `visibleItems` and the sidebar's `unfolds`). Declaring them as four
/// one-screen modules means routing, ⌘K, `moduleForPath` and the active
/// highlight all keep working untouched — `aside` changes only *where the
/// sidebar draws the row*, never what it is. Inventing a second kind of nav
/// entry would have meant teaching four readers about it.
///
/// The paths are top-level (`/chat`, not `/workplace/chat`) because there is no
/// longer a Workplace to be under. A URL that names a module that does not
/// exist is a URL that has to be explained.

/// The board. Long-form, subject-tagged, and searched on the server — which is
/// why it is the one of the four with a `q` endpoint behind it.
export const discussionsNav: AppModule = {
  id: "discussions",
  label: "Discussions",
  icon: MessagesSquare,
  home: "/discussions",
  aside: true,
  sections: [
    {
      items: [
        { path: "/discussions", label: "Discussions", icon: MessagesSquare },
      ],
    },
  ],
}

/// Its own aside and not a tab beside Discussions: a thread you are watching
/// and a message somebody just sent you are different urgencies, and the
/// second is the reason this is one click from anywhere.
export const chatNav: AppModule = {
  id: "chat",
  label: "Chat",
  icon: MessageSquare,
  home: "/chat",
  aside: true,
  // Messages waiting, on the icon itself: a conversation is the one aside
  // where somebody is waiting on YOU.
  useCount: useChatUnread,
  sections: [
    {
      items: [
        {
          path: "/chat",
          label: "Chat",
          icon: MessageSquare,
          useCount: useChatUnread,
        },
      ],
    },
  ],
}

/// The vault. One drawer, two sources.
///
/// There were two of these until 2026-09-04 — Files for what was attached in a
/// room, Documents for what the company filed on purpose. They read different
/// tables and they still do, but they answered the same question badly: a
/// person looking for a PDF had to know which icon somebody else had put it
/// behind. "hapus documents jika sudah ada files, kenapa double double".
///
/// So the two became one screen with a `Where` facet, and `/documents` is
/// `moved` rather than deleted: the path is in people's history and in links
/// they have sent each other, and `?document=` still opens the same sheet.
export const libraryNav: AppModule = {
  id: "library",
  // "Files" since 2026-09-26, when it moved from the icon strip into GA. The
  // path stays `/library` so the links people have sent keep working.
  label: "Files",
  icon: FolderOpen,
  home: "/library",
  // Both of its old addresses. `/documents` is the screen this one absorbed;
  // `/files` is what this screen itself answered at until the owner renamed
  // it on 2026-09-13 — and a rename that 404s the links people have already
  // sent each other is a rename that costs somebody their afternoon.
  moved: ["/documents", "/files"],
  sections: [
    { items: [{ path: "/library", label: "Files", icon: FolderOpen }] },
  ],
}
