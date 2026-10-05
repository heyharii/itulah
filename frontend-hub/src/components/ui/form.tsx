import { NumberField } from "@base-ui/react/number-field"
import { Radio } from "@base-ui/react/radio"
import { RadioGroup } from "@base-ui/react/radio-group"
import { Slider } from "@base-ui/react/slider"
import { Minus, Plus, type LucideIcon } from "lucide-react"

import { Input } from "@/components/ui/field"
import {
  FORM_HALO_WITHIN,
  HAS_INVALID,
  useFieldAria,
  useInForm,
} from "@/components/ui/field-state"
import { cn } from "@/lib/utils"

/// The controls a COMPOSER needs, which are not the controls a record needs.
///
/// `<Field>` + `<Input>` + `<Select>` was the whole kit a form had before this,
/// and a form where every question wears the same pill makes the reader do the
/// work the form was supposed to do. These are the other shapes a question
/// actually comes in:
///
///  - **`<Choices>`** — one out of a handful, where each option needs a
///    sentence. A dropdown hides those sentences until you open it, and hides
///    them again the moment you choose.
///  - **`<Switch>` / `<Toggle>`** — a state of the world, and a yes/no that
///    changes what the form asks next.
///  - **`<Dial>`** — a figure with a floor and a ceiling, dragged.
///  - **`<Stepper>`** — a small count, where "one more" should be one press.
///
/// Written for the Commercial composer and promoted the way `<Day>` and
/// `<Money>` were: the moment a second module wanted them. `<Section>` came
/// along because twelve identical fields in one column is a wall, and the same
/// twelve under five headings is a form somebody can find their place in after
/// looking away.

// ── a section of a form ─────────────────────────────────────────────────────

/// One question-group, titled.
///
/// A composer with twelve fields in one column is a wall; the same twelve under
/// five headings is a form somebody can find their place in after looking away.
export function Section({
  title,
  aside,
  icon: Icon,
  children,
  className,
}: {
  title: React.ReactNode
  aside?: React.ReactNode
  /// A 20px icon beside the heading — the same heading a record's detail
  /// sheet sections wear, so a form and the record it makes read alike.
  icon?: LucideIcon
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={className}>
      {Icon ? (
        <div className="mb-6 flex items-center gap-3 border-b border-hairline pb-4">
          <Icon className="size-5 shrink-0 text-line-ico" strokeWidth={1.7} />
          <h4 className="flex-1 text-base font-semibold text-ink">{title}</h4>
          {aside && <span className="text-[0.875rem] text-mute">{aside}</span>}
        </div>
      ) : (
        <div className="mb-3.5 flex items-baseline justify-between gap-2 border-b border-hairline pb-2">
          <h4 className="text-card-title font-semibold text-ink">{title}</h4>
          {aside && <span className="text-[0.875rem] text-mute">{aside}</span>}
        </div>
      )}
      {/* 20px between questions since the fields grew to 47px (airy
          charcoal, 2026-09-28): at 14px a form of tall boxes read as one
          block rather than as questions one under another. */}
      <div className="flex flex-col gap-5">{children}</div>
    </section>
  )
}

// ── one out of a handful ────────────────────────────────────────────────────

export interface Tile<T extends string> {
  readonly value: T
  readonly label: string
  /// The one line that says what choosing it means. Optional, but a tile
  /// without one is usually a tile whose label was not clear enough.
  readonly note?: string
  /// Drawn beside the label, at the left of the tile.
  ///
  /// For the choices whose options are things rather than words: the eleven
  /// builds a thing can come in, the eleven objects a repair can be about. The
  /// glyph is what the eye finds before it reads, and on a grid of eleven tiles
  /// it is the difference between reading eleven labels and seeing one.
  readonly icon?: React.ComponentType<{ className?: string }>
  /// A code under the label, in the monospace face.
  ///
  /// The account a choice proposes, the class code it files under — a figure
  /// the reader checks against the chart rather than reads as prose, so it is
  /// set as one. Deliberately not a `note`: a note is a sentence about the
  /// choice, and this is the choice's own identifier.
  readonly tag?: string
  /// Why the server will not accept it. Present means disabled — and the
  /// sentence is drawn **on the tile**, not in a banner somewhere below.
  ///
  /// A refused option that is merely hidden reads as an option nobody thought
  /// of, and the person goes looking for it. A refused option greyed in a
  /// native dropdown can only carry a few words, which is how "Free items"
  /// came to be followed by "— not available" and no reason at all.
  readonly refused?: string
}

/// A row of tiles, exactly one of them on.
///
/// `<RadioGroup>` and not a row of buttons: the arrow keys move between
/// options and tab moves past the whole group, which is what somebody filling
/// a form expects and what a set of `<button>`s does not do.
export function Choices<T extends string>({
  options,
  value,
  onChange,
  columns = 2,
  label,
  disabled,
  invalid,
  required,
  className,
}: {
  options: readonly Tile<T>[]
  value: T
  onChange: (value: T) => void
  columns?: 1 | 2 | 3
  /// For the screen reader, when the visible heading is a `<Section>` title.
  label?: string
  /// The whole question locked — a record being read. One option refused is
  /// `Tile.refused`, which carries its reason.
  disabled?: boolean
  /// Refused, outside a `<Field>`. Inside one the field says it.
  invalid?: boolean
  required?: boolean
  className?: string
}) {
  const aria = useFieldAria({ invalid, required })
  const wrong = aria["aria-invalid"] === true
  return (
    <RadioGroup
      aria-label={label}
      {...aria}
      disabled={disabled}
      value={value}
      onValueChange={(next) => onChange(next as T)}
      className={cn(
        "grid gap-2",
        columns === 1 && "grid-cols-1",
        columns === 2 && "grid-cols-1 sm:grid-cols-2",
        columns === 3 && "grid-cols-1 sm:grid-cols-3",
        className
      )}
    >
      {options.map((one) => {
        const refused = one.refused !== undefined
        const dead = refused || disabled === true
        const Glyph = one.icon
        return (
          <Radio.Root
            key={one.value}
            value={one.value}
            disabled={dead}
            className={cn(
              "flex min-w-0 cursor-pointer items-center gap-2.5 rounded-inner border px-3 py-2.5 text-left transition-colors",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
              // Locked but not refused: the answer stays legible — the chosen
              // tile keeps its accent — and nothing invites a press.
              !refused && disabled === true && "cursor-default opacity-60",
              // A refused option carries a whole sentence, so it takes a whole
              // row rather than standing as a tile twice the height of the one
              // beside it.
              refused
                ? "cursor-default border-hairline bg-soft opacity-90 sm:col-span-full"
                : one.value === value
                  ? cn("border-accent bg-accent-bg", wrong && "border-bad")
                  : cn(
                      "border-hairline-2 bg-canvas",
                      disabled !== true &&
                        "hover:border-hairline-strong hover:bg-soft-2",
                      wrong && "border-bad hover:border-bad"
                    )
            )}
          >
            {Glyph && (
              <span
                className={cn(
                  "grid size-[1.875rem] shrink-0 place-items-center rounded-inner",
                  refused
                    ? "bg-soft-2 text-mute"
                    : one.value === value
                      ? "bg-canvas text-accent"
                      : "bg-soft-2 text-body"
                )}
              >
                <Glyph className="size-4 stroke-[1.7]" />
              </span>
            )}
            <span className="min-w-0 flex-1">
              <span
                className={cn(
                  "block text-[0.875rem] font-medium",
                  refused
                    ? "text-mute"
                    : one.value === value
                      ? "text-accent"
                      : "text-ink"
                )}
              >
                {one.label}
              </span>
              {one.tag !== undefined && (
                <span
                  className={cn(
                    "mt-0.5 block font-mono text-[0.875rem]",
                    one.value === value && !refused
                      ? "text-accent"
                      : "text-mute"
                  )}
                >
                  {one.tag}
                </span>
              )}
              {(one.refused ?? one.note) && (
                <span className="block text-[0.875rem] leading-relaxed text-mute">
                  {one.refused ?? one.note}
                </span>
              )}
            </span>
          </Radio.Root>
        )
      })}
    </RadioGroup>
  )
}

/// A live/paused switch.
///
/// A `role="switch"` button and not a checkbox: what it changes is a *state of the world* that takes effect
/// when released, not a value inside a form somebody will submit later.
export function Switch({
  on,
  busy,
  disabled,
  label,
  onToggle,
}: {
  on: boolean
  /// The change is on its way to the server. Not the same as `disabled`: a
  /// switch that is busy is about to move, and one that is disabled never
  /// will — so it is drawn half-faded and announced `aria-busy`, where a
  /// disabled one is faded all the way.
  busy?: boolean
  disabled?: boolean
  label: string
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      aria-busy={busy === true ? true : undefined}
      disabled={busy === true || disabled === true}
      onClick={(event) => {
        // The row underneath opens a detail; the switch changes the world.
        // Letting the click reach both would open a panel every time somebody
        // pauses something.
        event.stopPropagation()
        onToggle()
      }}
      className={cn(
        "relative inline-flex h-[1.125rem] w-[1.875rem] shrink-0 items-center rounded-full transition-colors",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        "disabled:opacity-50 aria-busy:cursor-progress aria-busy:opacity-70",
        on ? "bg-accent" : "bg-soft-3"
      )}
    >
      <span
        className={cn(
          "absolute size-3.5 rounded-full bg-canvas shadow-soft transition-[left]",
          on ? "left-[0.875rem]" : "left-0.5"
        )}
      />
    </button>
  )
}

/// A switch with its words beside it, drawn as a control of a toolbar's own
/// height and edge — the list screens' way to narrow by a yes/no ("Active
/// order", "Invoiced only"). Bare on the page, a switch's pale track reads as
/// nothing at all; inside a bordered box beside the search it reads as one of
/// the list's controls. The whole box is the target: a `<button>` is
/// labelable, so a press on the words toggles it once.
export function SwitchPill({
  on,
  label,
  onToggle,
  className,
}: {
  on: boolean
  label: string
  onToggle: () => void
  className?: string
}) {
  return (
    <label
      className={cn(
        "inline-flex h-[2.125rem] shrink-0 cursor-pointer items-center gap-2 rounded-inner border border-hairline-2 bg-canvas px-2.5 text-[0.875rem] whitespace-nowrap text-ink capitalize shadow-soft select-none pointer-coarse:h-11",
        className
      )}
    >
      <Switch on={on} label={label} onToggle={onToggle} />
      {label}
    </label>
  )
}

/// A yes/no that changes what the form asks next, as a switch with its reading
/// beside it.
///
/// Two tiles would do the same job and take four times the room; a switch is
/// the right shape when the two answers are "this thing, or not this thing"
/// rather than two different things.
export function Toggle({
  on,
  onToggle,
  label,
  note,
  busy,
  disabled,
  className,
}: {
  on: boolean
  onToggle: () => void
  label: string
  busy?: boolean
  disabled?: boolean
  /// What is true *now* — it changes with the switch, because a caption that
  /// stays the same in both positions is telling you nothing about the state.
  note: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-2.5 rounded-inner border border-hairline-2 px-3 py-2.5",
        on && "border-accent bg-accent-bg",
        disabled === true && "opacity-60",
        className
      )}
    >
      <span className="pt-0.5">
        <Switch
          on={on}
          label={label}
          busy={busy}
          disabled={disabled}
          onToggle={onToggle}
        />
      </span>
      <span className="min-w-0">
        <span className="block text-[0.875rem] font-medium text-ink capitalize">
          {label}
        </span>
        <span className="block text-[0.875rem] leading-relaxed text-body">
          {note}
        </span>
      </span>
    </div>
  )
}

// ── a number ───────────────────────────────────────────────────────────────

/// A bounded figure, dragged.
///
/// The one shape on these forms where a slider is honest: a discount has a
/// floor, a ceiling and a shape people already hold in their heads — 20 is
/// "normal", 50 is "the sale", 70 is "we are clearing it" — and dragging says
/// all three at once where a text box says none of them. Everything else a
/// promotion asks for in figures is money, which has no ceiling and where a
/// slider would be a lie about the range.
///
/// **The box beside it is not decoration.** A slider cannot express 12.5%, and
/// somebody who knows they want 20 should not have to aim for it. The two edit
/// the same number: drag for the shape, type for the exact figure.
///
/// **The shape is beUI's range slider**, which is a *band you grab* and not a
/// rail with a dot on it: forty pixels of it, a fill running to the thumb, tick
/// dots on the grain, and the thumb a short vertical bar sunk into the band. A
/// thin rail with a round knob is the shape this deliberately is not — that is
/// a hairline somebody has to hit, where here the whole band is the target.
///
/// What arrives in Cloud Hub's register rather than beUI's: the ground is
/// `{soft-2}`, the same one every field in this kit stands on; the fill is the
/// `{accent-bg}` this app already owns rather than a translucent black; the
/// band is a pill, because nothing interactive here is anything else. And the
/// movement is CSS off `--t-press` and `--ease-out` — MOTION.md rules out
/// shipping a spring runtime for a transform and a width on one element.
/// `data-motion="travel"` marks the thumb, so reduced motion keeps the fill and
/// drops the swell.
export function Dial({
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  tick,
  suffix,
  marks,
  label,
  disabled,
  invalid,
}: {
  /// Text, not a number: the form holds "" for "nothing said yet", which is a
  /// different answer from zero and the one a slider cannot hold on its own.
  value: string
  onChange: (value: string) => void
  min?: number
  max?: number
  step?: number
  /// How far apart the dots sit. Defaults to the step, and draws none past
  /// fifty of them — a hundred dots is a texture, not a grain. Percent steps by
  /// one and dots every ten, because nobody reads a hundred marks.
  tick?: number
  suffix?: string
  /// The figures worth one press. The dots say where the values are; these say
  /// which ones somebody actually asks for.
  marks?: readonly number[]
  label: string
  disabled?: boolean
  /// Refused, outside a `<Field>`. Inside one the field says it — on the typed
  /// box, which is where the figure is read and corrected.
  invalid?: boolean
}) {
  const typed = value.trim() === "" ? null : Number(value)
  const at = typed !== null && Number.isFinite(typed) ? typed : min

  // Floored rather than rounded, so a range the interval does not divide stops
  // at the last whole one instead of drawing a dot past the end.
  const grain = tick ?? step
  const steps = Math.floor(Number(((max - min) / grain).toFixed(6)))
  // The ends are left out: the band's own rounded edge already says where
  // the range stops, and a dot drawn on the curve read as a misplaced mark.
  const dots =
    steps > 1 && steps <= 50
      ? Array.from(
          { length: steps - 1 },
          (_, index) => min + (index + 1) * grain
        )
      : []

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <Slider.Root
          value={at}
          min={min}
          max={max}
          step={step}
          onValueChange={(next) => onChange(String(next))}
          disabled={disabled}
          className="group/dial min-w-0 flex-1 data-disabled:opacity-50"
        >
          <Slider.Control className="w-full cursor-grab touch-none group-data-[disabled]/dial:cursor-default active:cursor-grabbing">
            <Slider.Track className="relative h-10 w-full overflow-hidden rounded-full bg-soft-2">
              {/* The fill ends at the thumb's centre, which is what makes the
                  band read as filled TO the handle rather than under it. */}
              <Slider.Indicator
                className={cn(
                  // Indigo at a fifth rather than the flat `{accent-bg}` token:
                  // that token is a *badge* ground, chosen to sit quietly on
                  // white, and on the `{soft-2}` band it was so close to the
                  // track that the fill could not be seen at a glance — which
                  // is the one thing a fill is for.
                  "bg-accent/20",
                  "transition-[width] duration-[var(--t-press)] ease-[var(--ease-out)]",
                  // Never while a thumb is under the finger: a fill that eases
                  // behind the hand reads as the control lagging.
                  "group-[[data-dragging]]/dial:transition-none"
                )}
              />

              {/* Inset by half the thumb's width — that inset is the span the
                  thumb's own centre travels, so a dot sits where it lands. */}
              <div className="pointer-events-none absolute inset-x-[3px] inset-y-0">
                {dots.map((one) => (
                  <span
                    key={one}
                    className="absolute top-1/2 size-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-faint"
                    style={{ left: `${((one - min) / (max - min)) * 100}%` }}
                  />
                ))}
              </div>

              <Slider.Thumb
                data-motion="travel"
                aria-label={label}
                className={cn(
                  "h-5 w-1.5 rounded-sm bg-ink shadow-soft ring-accent/40 ring-inset",
                  "transition-[transform,inset-inline-start] duration-[var(--t-press)] ease-[var(--ease-out)]",
                  "group-[[data-dragging]]/dial:transition-transform",
                  // Growing taller is the confirmation, and only ever the
                  // second signal — the fill has already moved — so reduced
                  // motion loses nothing by dropping it.
                  "data-dragging:scale-y-135",
                  "focus-visible:ring-4 focus-visible:outline-none"
                )}
              />
            </Slider.Track>
          </Slider.Control>
        </Slider.Root>

        {/* The exact figure, and the only place the unit is written. */}
        <span className="relative flex w-[6.5rem] shrink-0 items-center">
          <Input
            value={value}
            inputMode="decimal"
            aria-label={`${label}, typed`}
            disabled={disabled}
            invalid={invalid}
            onChange={(event) => onChange(event.target.value)}
            className={cn("h-10 text-right tabular-nums", suffix && "pr-8")}
          />
          {suffix && (
            <span className="pointer-events-none absolute right-3.5 text-[0.875rem] text-mute">
              {suffix}
            </span>
          )}
        </span>
      </div>

      {marks && marks.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {marks.map((one) => (
            <button
              key={one}
              type="button"
              aria-pressed={typed === one}
              disabled={disabled}
              className={cn(
                "disabled:pointer-events-none disabled:opacity-50",
                "rounded-full px-2 py-0.5 text-[0.875rem] font-medium tabular-nums transition-colors",
                typed === one
                  ? "bg-accent-bg text-accent"
                  : "bg-soft-2 text-body hover:bg-hairline hover:text-ink"
              )}
              onClick={() => onChange(String(one))}
            >
              {one}
              {suffix}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/// A small count, stepped.
///
/// For the figures that are counted rather than measured — units in a basket,
/// baskets in a promotion, the rank two offers are compared on. They are single
/// digits nearly every time, and a stepper answers "one more" in one press
/// where a text box asks somebody to select, retype and hope they did not leave
/// a stray character behind.
///
/// Empty stays reachable, and it is not zero: an unlimited number of baskets and
/// a limit of none are opposite instructions.
export function Stepper({
  value,
  onChange,
  min = 0,
  max,
  suffix,
  label,
  disabled,
  invalid,
  required,
}: {
  value: string
  onChange: (value: string) => void
  min?: number
  max?: number
  suffix?: string
  label: string
  disabled?: boolean
  /// Refused, outside a `<Field>`. Inside one the field says it.
  invalid?: boolean
  required?: boolean
}) {
  const typed = value.trim() === "" ? null : Number(value)
  const aria = useFieldAria({ invalid, required })
  const form = useInForm()

  return (
    <NumberField.Root
      value={typed !== null && Number.isFinite(typed) ? typed : null}
      min={min}
      max={max}
      disabled={disabled}
      onValueChange={(next) => onChange(next === null ? "" : String(next))}
    >
      <NumberField.Group
        className={cn(
          "flex h-9 w-full items-center rounded-full border border-transparent bg-soft-2 transition-colors hover:border-hairline-2 hover:bg-soft-3",
          "has-[input:focus-visible]:border-accent",
          "has-[input:disabled]:opacity-50 has-[input:disabled]:hover:border-transparent has-[input:disabled]:hover:bg-soft-2",
          HAS_INVALID,
          "has-[[aria-invalid=true]]:has-[input:focus-visible]:border-bad",
          // On a form it is a form's box like its neighbours — 47px, a
          // hairline, the halo — not the grey pill it is in a toolbar.
          form && [
            "h-[var(--form-box,2.75rem)] rounded-inner border-hairline-2 bg-canvas px-1 hover:border-hairline-strong hover:bg-canvas",
            "has-[input:disabled]:hover:border-hairline-2 has-[input:disabled]:hover:bg-canvas",
            FORM_HALO_WITHIN,
          ]
        )}
      >
        <NumberField.Decrement
          aria-label={`${label}, one fewer`}
          className="grid size-8 shrink-0 place-items-center rounded-full text-line-ico transition-colors hover:bg-hairline hover:text-ink disabled:opacity-40"
        >
          <Minus className="size-3.5" />
        </NumberField.Decrement>
        <span className="relative flex min-w-0 flex-1 items-center justify-center">
          <NumberField.Input
            aria-label={label}
            {...aria}
            className={cn(
              "w-full bg-transparent text-center text-[0.875rem] text-ink tabular-nums outline-none",
              "placeholder:text-mute"
            )}
          />
          {suffix && typed !== null && (
            <span className="pointer-events-none pl-1 text-[0.875rem] text-mute">
              {suffix}
            </span>
          )}
        </span>
        <NumberField.Increment
          aria-label={`${label}, one more`}
          className="grid size-8 shrink-0 place-items-center rounded-full text-line-ico transition-colors hover:bg-hairline hover:text-ink disabled:opacity-40"
        >
          <Plus className="size-3.5" />
        </NumberField.Increment>
      </NumberField.Group>
    </NumberField.Root>
  )
}
