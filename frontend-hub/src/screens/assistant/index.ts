import type { ScreenMap } from "@/screens/registry"
import { AssistantChat } from "@/screens/assistant/chat"
import { AssistantGlossary } from "@/screens/assistant/glossary"

/// The chat is one route with two states. Which conversation is open is a URL
/// parameter rather than a path segment — the same arrangement Reports uses,
/// and for the same reason: the list and the thing are one screen, and a link
/// to a chat is a link somebody can paste. The glossary is the words the chat
/// reads every question with, kept on a page of its own.
export const screens: ScreenMap = {
  "/assistant": AssistantChat,
  "/assistant/glossary": AssistantGlossary,
}
