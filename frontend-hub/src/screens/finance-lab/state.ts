import { useSyncExternalStore } from "react"

import { book, type Book } from "@/screens/finance-lab/engine/book"

/// Subscribe to the simulated book.
///
/// `useSyncExternalStore` rather than React state, because the book is not
/// React's: the scenarios drive the same object with no component mounted, and
/// a screen that held its own copy would show a stale journal the moment
/// anything else posted.
///
/// The snapshot is a NUMBER — the book's version counter — and that is
/// load-bearing. Returning the book object would be a fresh identity on every
/// call only if it were rebuilt, and returning a derived array would be a fresh
/// identity every time, which is how this hook ends up re-rendering forever.
export function useBook(): Book {
  useSyncExternalStore(book().subscribe, book().snapshot, book().snapshot)
  return book()
}
