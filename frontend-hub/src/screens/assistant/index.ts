import type { ScreenMap } from "@/screens/registry"
import { AssistantChat } from "@/screens/assistant/chat"

/// One route, two states. Which conversation is open is a URL parameter rather
/// than a path segment — the same arrangement Reports uses, and for the same
/// reason: the list and the thing are one screen, and a link to a chat is a
/// link somebody can paste.
export const screens: ScreenMap = {
  "/assistant": AssistantChat,
}
