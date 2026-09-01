import type { ScreenMap } from "@/screens/registry"
import { Chat } from "@/screens/workplace/chat"
import { Discussions } from "@/screens/workplace/discussions"
import { Documents } from "@/screens/workplace/documents"
import { Files } from "@/screens/workplace/files"

/// Screens this module has written. Keys must be paths declared in
/// `lib/navigation.ts`; anything not listed here renders `Placeholder`.
///
/// Each module owns this file alone, so two modules being built at once never
/// touch the same registry.
export const screens: ScreenMap = {
  "/workplace": Discussions,
  "/workplace/chat": Chat,
  "/workplace/files": Files,
  "/workplace/documents": Documents,
}
