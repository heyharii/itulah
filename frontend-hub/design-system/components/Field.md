# Field

A field is a grey label over a 40px box, with one red line under the box when the answer is refused; every input in a form stands in one.

## Pick the control by the answer

| The answer is | Use | Notes |
| --- | --- | --- |
| A word or a number | `Input` | A number on a phone opens the `NumberPad` instead of the keyboard |
| Several lines | `Textarea` | Three rows by default |
| One of a list | `Select` | Never a native `<select>`; on a phone it opens a picker sheet |
| An amount in rupiah | `Money` | Grouped as it is typed; the caller holds digits |
| A day, or a range of days | `Day`, `DayRange` | See the DayRange card |
| A yes/no kept in the form | `Checkbox` | |
| A yes/no that changes what the form asks next, or a choice of a few with sentences | `Toggle`, `Choices` | See the Switch card |

## Anatomy

- **Label**: 15px in `mute`, 8px above the box, sentence case: "Payment terms", "Credit limit". The label is the `<label>`, so pressing it focuses the box.
- **Required**: a `bad` asterisk right after the label ("Name*"). Mark every required field and only those. Do not also write "(optional)" on the others.
- **Aside**: a short fact about the question, beside the label instead of under the box: "16 digits", "per pc". A `soft-2` chip, radius 8px, 15px in `body`.
- **Box**: 40px high (44px under a finger), padding 0 14px, radius 8px, 1px `hairline-2`, `canvas` fill, 15px `ink`. The placeholder is `mute` and never carries information.
- **Focus**: the border turns `accent` and gains `shadow-focus`, a 2px halo. No outline.
- **Invalid**: a `bad` border, and under the box one line in `bad`, 8px below it: the validator's or the server's sentence ("Fill in the supplier's name."), never a code. The control is marked `aria-invalid` and the sentence is tied to it. The line fades in over `t-pop` on `ease-out`, settling 2px down as it appears; it never shakes. Under reduced motion it only fades.
- **Hint**: under the box, 15px in `mute`, only when it stops a mistake and in a few words: "Comma separated, up to eight." "At least 8 characters."
- **Disabled** is 50% opacity. A read-only box looks like an ordinary one; reading a record is `Facts`, not boxes.
- **Textarea**: the same box, padding 12px 14px, 24px lines, three rows (98px).
- **Select**: the trigger is the box with a 14px chevron in `line-ico`, 14px from the right. The list opens over the trigger as a menu (`shadow-pop`, rows of 8px radius) with the chosen row on top.
- **Money**: "Rp" in `mute`, 14px in; the figure starts at 36px, tabular, grouped with dots as it is typed: "50.000.000". Whole rupiah only. A minus only where `signed` says so. A `suffix` ("%", "units") stands at the right.
- **Checkbox**: a 14px box with a 4px radius and a `hairline-strong` border (20px under a finger), the word 8px after it. Checked, it fills `accent` with a white tick; "some" is a dash. The whole word is the target, so the row is 44px under a finger.
- **A form of fields**: two columns, 24px between columns and between rows.

## Rules

- A field asks one question. The label says what the question is, not what to do.
- Mark required with the asterisk, all of them. The mark is `aria-required`, not the native `required`, so the browser throws no bubble of its own.
- Say what is wrong under the box, in a sentence. Pressed while it is not ready, the primary says every problem under its box at once; a disabled primary says why in the foot (`SheetFooter note`).
- A hint is a few words that stop a mistake. A sentence of explanation is not a hint.
- Use the kit's `Select`, `Day` and `Checkbox`. Never `<select>`, `<input type="date">` or `<input type="checkbox">`: their panel and their tick belong to the operating system.
- A code that looks like a number (an account number, a tax id) passes `keyboard` so it is typed, not picked.
- Rupiah always goes through `Money`.

## Retired

- **Hints that are sentences.** Field hints are drawn 231 times and 113 of them are full sentences, for example "Separate from their login. Head office is never asked for it." Cut each to a few words, or to nothing.
- **Title Case labels** ("Legal Form", "Phone Number", "Delivery Date", "Payment Terms") in the supplier and PO forms. Labels are sentence case.
- **A red border that does not draw.** On the running hub only a Select's trigger turns red. An invalid `Input` or `Textarea` keeps `hairline-2`, because the border rule for inputs in `white.css` (line 485, specificity 0,3,2) outranks the invalid rule (line 509, 0,3,1). The sentence under the box does show. Give the invalid rule the same selector as the border rule.
- **`capitalize` on the `Checkbox` label.** "Include settled" is drawn "Include Settled". The same class sits on the `SwitchPill` and `Toggle` labels. Remove it from the kit.
- **The comment at the top of `field.tsx`** (soft-2 pills with an indigo ring) is out of date: the box is white, with a `hairline-2` border and an `accent` focus.
- **A Submit that saves.** 36 buttons say Submit where they save. A save says Save or Save changes.

## What you provide

| Part | Props | Notes |
| --- | --- | --- |
| `Field` | `label`, `required?`, `aside?`, `hint?`, `problem?`, `className?`, `children` | `problem` is the sentence; any value but `null`, `undefined`, `false` or `""` makes the box red. |
| `Input` | the input props, `invalid?`, `required?`, `keyboard?`, `padLabel?` | Reads `invalid` and `required` from the field around it. |
| `Textarea` | the textarea props, `invalid?`, `required?` | |
| `Select` | `value`, `onChange(value)`, `<option>` children, `disabled?`, `invalid?`, `required?`, `aria-label?` | The caller holds the value as a string. |
| `Money` | `value` (digits), `onChange(digits)`, `onBlur?`, `signed?`, `prefix?`, `suffix?`, `label?`, `disabled?`, `invalid?` | |
| `Checkbox` | `label`, `checked`, `onChange(checked)`, `indeterminate?`, `hint?`, `disabled?`, `invalid?`, `required?` | `hint` says why a box is disabled, on the page. |

Source: `frontend-hub/src/components/ui/field.tsx`, `field-state.ts`; look in `styles/white.css` (Fields).
