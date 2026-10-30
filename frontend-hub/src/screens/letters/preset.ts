/// A letter somebody else's screen wants written: the employee page asks for
/// their contract, and the Letters register opens the New letter sheet already
/// on that form with the details filled in.
///
/// Passed through the tab's session storage rather than the URL — the details
/// are a person's name and dates, and the URL is what gets pasted into chats.

export interface LetterPreset {
  readonly form: string
  readonly values: Readonly<Record<string, string>>
}

const KEY = "letters.preset"

export function setLetterPreset(preset: LetterPreset): void {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(preset))
  } catch {
    // Without storage the register simply opens on its own, and the details are typed.
  }
}

/// Read once and forgotten: a preset that outlived its visit would reopen the
/// sheet every time the register was.
export function takeLetterPreset(): LetterPreset | null {
  try {
    const raw = window.sessionStorage.getItem(KEY)
    if (raw === null) return null
    window.sessionStorage.removeItem(KEY)
    const parsed = JSON.parse(raw) as LetterPreset
    return typeof parsed.form === "string" ? parsed : null
  } catch {
    return null
  }
}
