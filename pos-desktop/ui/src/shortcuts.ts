/// The keys a counter is actually driven by.
///
/// # The one distinction this hook exists for
///
/// A cashier's hands live in the scan field. The caret is put back into it
/// after every change of screen — `till.tsx` does that on purpose — so a
/// shortcut hook that politely stood aside whenever an input had focus would
/// be a hook that never fired once on the busiest screen in the shop. Bayar is
/// how a till is paid off, and it has to work from inside that field.
///
/// The other half is just as true. In the scan field `1` is a digit of a
/// barcode, `p` is a letter of a name, and ctrl+A is select-all, which a
/// cashier expects to keep working. Those keys mean something to a text field,
/// and taking them away from it would be taking away typing.
///
/// So the line is not "is a field focused" but "does this key mean anything to
/// a field": Shift and a digit mean nothing to one and fire everywhere, including inside
/// it; everything else waits until the caret is somewhere else.
///
/// # What it will not swallow
///
/// `preventDefault` is called for the keys the map actually claims and for no
/// others. Swallowing the browser's F5 or F12 in a window that bound neither would break
/// reload and the inspector for nothing at all.

import { useEffect, useRef } from "react"

/// Whether the last thing the person did was point at the screen. Motion is for
/// a mouse or a finger: Shift+digit, Enter and Esc are pressed hundreds of times a day
/// and get none, and a scanner types its tag as keys, so it gets none either.
/// A dialog reads it once, when it mounts: `useState(viaPointer)`.
let pointed = false
if (typeof window !== "undefined") {
  window.addEventListener(
    "pointerdown",
    () => {
      pointed = true
    },
    true,
  )
  window.addEventListener(
    "keydown",
    () => {
      pointed = false
    },
    true,
  )
}
export function viaPointer(): boolean {
  return pointed
}

/// Every spelling of a modifier, and the one name it is written under.
const MODIFIERS: Readonly<Record<string, string | undefined>> = {
  ctrl: "ctrl",
  control: "ctrl",
  alt: "alt",
  option: "alt",
  shift: "shift",
  meta: "meta",
  cmd: "meta",
  command: "meta",
  super: "meta",
  win: "meta",
}

/// The order modifiers are written in, so "shift+ctrl+p" and "ctrl+shift+p"
/// are one shortcut rather than two that never both fire.
const ORDER = ["ctrl", "alt", "shift", "meta"] as const

/// Spellings that are easier to write down than the names `KeyboardEvent.key`
/// gives them. Everything not listed is taken as `key` already spells it —
/// "Escape", "Enter", "Tab", "Shift+9", "p".
const ALIASES: Readonly<Record<string, string | undefined>> = {
  esc: "escape",
  return: "enter",
  space: " ",
  spacebar: " ",
  del: "delete",
  up: "arrowup",
  down: "arrowdown",
  left: "arrowleft",
  right: "arrowright",
}

/// Keys a text field has no use for: Shift and a digit, numpad + and −, ctrl and a letter.
///
/// Ctrl and a letter is a command, not typing — except the letters a field
/// itself answers to (select all, copy, paste, cut, undo, redo), which a
/// cashier expects to keep working in the scan field. The numpad's + and − are
/// 7Soft's New and Remove on the sale screen: they are told apart from the main
/// row's by `event.code` (see `pressed`), so "-" typed in a coupon code or a
/// name still types.
const FIELD_EDITING = new Set(["a", "c", "v", "x", "z", "y"])
const NUMPAD_COMMANDS = new Set(["NumpadAdd", "NumpadSubtract"])

/// Shift and a digit of the main row — every command of the till, now that
/// there are no F-keys (client, 28 Oct 2026). Named by `event.code`, so it is
/// "shift+1" on every layout rather than "!" on one and something else on the
/// next; a barcode never holds shift, so it fires from the scan field.
function shiftDigit(event: KeyboardEvent): string | null {
  if (!event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return null
  const digit = /^Digit([0-9])$/.exec(event.code)
  return digit === null ? null : digit[1]
}

/// Rewrite a name from the map into the one spelling a pressed key is named
/// with, so the two meet in the middle. Case and modifier order stop mattering.
function canonical(name: string): string {
  const held = new Set<string>()
  let base = ""
  for (const raw of name.split("+")) {
    const part = raw.trim().toLowerCase()
    if (part === "") continue
    const modifier = MODIFIERS[part]
    if (modifier !== undefined) held.add(modifier)
    else base = ALIASES[part] ?? part
  }
  return [...ORDER.filter((one) => held.has(one)), base].join("+")
}

/// What to call the key that was just pressed.
///
/// Shift is named like any other modifier, which is exact for letters and
/// F-keys — "shift+f10", "ctrl+shift+p" — and awkward for punctuation, where
/// shift changed the character itself: shift and `/` arrive as "?" and are
/// named "shift+?". F-keys and ctrl/alt combos are what a counter is driven
/// by, and both of those are spelled the way anyone would guess.
function pressed(event: KeyboardEvent): string {
  const held: string[] = []
  if (event.ctrlKey) held.push("ctrl")
  if (event.altKey) held.push("alt")
  if (event.shiftKey) held.push("shift")
  if (event.metaKey) held.push("meta")
  const key = NUMPAD_COMMANDS.has(event.code) ? event.code : (shiftDigit(event) ?? event.key)
  return [...held, key.toLowerCase()].join("+")
}

/// Whether `event` is the key the map would call `name` — for the dialogs
/// that listen on their own rather than through `useShortcuts`.
export function isKey(event: KeyboardEvent, name: string): boolean {
  return pressed(event) === canonical(name)
}

/// Whether a key may fire while the caret is in a text field: it must mean
/// nothing to the field. Shift and a digit never do; neither does ctrl and a
/// letter the field does not answer to, nor a numpad + or −, which only the till reads.
function firesInField(event: KeyboardEvent, base: string): boolean {
  if (NUMPAD_COMMANDS.has(event.code)) return true
  if (shiftDigit(event) !== null) return true
  return event.ctrlKey && !event.altKey && !event.metaKey && base.length === 1 && !FIELD_EDITING.has(base)
}

/// Whether this is somebody typing rather than somebody reaching for a
/// command. A `<select>` is in the list because letters and arrows move its
/// selection, which is the same claim on the key that a text field makes.
function typingIn(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  )
}

/// Bind F-keys and simple combos for as long as the screen is up.
///
/// The map is keyed by name — `{ "shift+9": hold, Escape: back, "ctrl+p": print }`.
/// Case and modifier order are free; a name the map does not carry is left
/// alone entirely, default and all.
///
/// `enabled` is for a screen that is still mounted but must not be driven —
/// while a dialog is open over it, say. It is not what guards the lock screen:
/// that one cannot rely on every screen behind it having been told, so it
/// swallows keys at the window in the capture phase instead. This listener
/// binds in the bubble phase so that it always loses to that one.
export function useShortcuts(
  map: Record<string, () => void>,
  enabled = true,
): void {
  // The map is an object literal at every call site, so it is a different
  // object on every render and its handlers close over that render's state.
  // Kept in a ref refreshed after each commit rather than named in the
  // effect's dependencies: rebinding a window listener several times a second
  // is work for nothing, and reading `.current` when a key actually arrives
  // finds the current handler anyway.
  const bound = useRef<Record<string, (() => void) | undefined>>({})
  useEffect(() => {
    const named: Record<string, (() => void) | undefined> = {}
    for (const [name, action] of Object.entries(map)) {
      named[canonical(name)] = action
    }
    bound.current = named
  })

  useEffect(() => {
    if (!enabled) return
    const onKey = (event: KeyboardEvent) => {
      // A key held down repeats about thirty times a second. A receipt roll
      // resting on Enter must not pay a basket off thirty times, and no shortcut
      // on a counter means anything the second time.
      if (event.repeat) return

      const name = pressed(event)
      const base = name.slice(name.lastIndexOf("+") + 1)
      // The distinction the whole hook is for: Shift and a digit mean nothing to
      // a text field, so it fires from inside the scan field where a cashier's
      // hands already are — and so do ctrl-letter commands and the numpad's
      // + and − (`firesInField`). Everything else is left to whoever is typing.
      if (!firesInField(event, base) && typingIn(event.target)) return

      const action = bound.current[name]
      // Claimed keys only — see the head of this file.
      if (action === undefined) return
      event.preventDefault()
      action()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [enabled])
}
