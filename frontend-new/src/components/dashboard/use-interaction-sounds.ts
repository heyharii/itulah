import { useEffect } from "react"
import { play, setEnabled, setVolume, sounds, type SoundName } from "cuelume"

const SELECTOR =
  "button,a[href],input:not([type=hidden]),select,textarea,[role=button],[role=switch],[role=tab]"
const DISMISS = /close|dismiss|remove|delete|collapse|cancel|clear|archive|discard/i
const PRIMARY = /add|create|export|save|submit|send|apply/i

const STORAGE_KEY = "ui-sounds"

function soundFor(el: Element): SoundName {
  const override = el.getAttribute("data-sound")
  if (override && (sounds as readonly string[]).includes(override)) return override as SoundName

  const label = `${el.getAttribute("aria-label") ?? ""} ${el.textContent ?? ""}`.trim()
  if (DISMISS.test(label)) return "release"
  if (
    el.matches(
      "input[type=checkbox],input[type=radio],select,[role=switch],[role=tab],[aria-pressed]"
    )
  ) {
    return "tick"
  }
  if (el.matches("a[href]")) return "page"
  if (PRIMARY.test(label)) return "pulse"
  if (el.matches("input,textarea")) return "tick"
  return "press"
}

export const readSoundPreference = () => {
  try {
    return localStorage.getItem(STORAGE_KEY) !== "off"
  } catch {
    return true
  }
}

export function writeSoundPreference(on: boolean) {
  setEnabled(on)
  try {
    localStorage.setItem(STORAGE_KEY, on ? "on" : "off")
  } catch {
    // storage unavailable — the in-memory setting still applies
  }
}

/** Plays a cue directly, for moments that aren't a click on a control. */
export const cue = (name: SoundName) => play(name)

/** One quiet, delegated audio layer for every interactive click in the app. */
export function useInteractionSounds(enabled: boolean) {
  useEffect(() => {
    setVolume(0.32)
  }, [])

  useEffect(() => {
    setEnabled(enabled)
  }, [enabled])

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return
      const control = event.target.closest(SELECTOR)
      if (!control || control.closest("[data-sound-silent]")) return
      if (control.matches(":disabled,[aria-disabled=true]")) return
      play(soundFor(control))
    }

    document.addEventListener("click", onClick, true)
    return () => document.removeEventListener("click", onClick, true)
  }, [])
}
