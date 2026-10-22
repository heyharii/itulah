import { useCoarsePointer, useLayout } from "@/lib/layout"

/// A touch screen puts a number on a keypad; a desk types it in a box. The
/// pointer decides, and a phone-width page is always a thumb.
export function useTouchPad(): boolean {
  const coarse = useCoarsePointer()
  const phone = useLayout() === "phone"
  return coarse || phone
}
