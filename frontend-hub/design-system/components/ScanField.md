# ScanField

ScanField is the one input a barcode gun or an RFID wedge types into: a form with a single box and a button, which clears itself after every scan, keeps the caret and says in red why the last scan was refused.

## When to use it

| The job | Use |
| --- | --- |
| Take a code from a gun or a wedge: a receiving count, a pick, a tag check on the handheld | `ScanField`, one per screen |
| Narrow a list somebody is reading by typing | `ExpandingSearch` in the Toolbar. It gives the caret back |
| A code typed into a form (an account number, a tax id) | `Input` with `keyboard` |
| Find an article or SKU in a catalogue of thousands | `FindMany` |

No screen in the hub mounts it today. The store app draws a copy of its own (`frontend-store-new/src/components/ui/scan-field.tsx`), used by the delivery Count in `screens/stock/delivery-sheet.tsx`: a bordered box with a glass and no button.

## Behaviour

Each of these was found by using it on a floor. Keep them all.

- **A form with one input.** A gun is a keyboard that types fast and presses Enter, so submit is the trigger. A key handler would not survive an IME composition and would fight a dialog for its keys.
- **It clears itself and keeps the caret.** After `onSubmit` the box is emptied and takes focus back, after the handler, so a submit that opens a dialog can still pull the focus away. A box that kept the last value would glue the next scan to it into one impossible EPC; one that lost focus would swallow the next.
- **Trimmed, never empty.** `onSubmit` gets the trimmed value. An empty box or a locked field submits nothing.
- **Plain text.** `autoCapitalize`, `autoCorrect`, `autoComplete` and `spellCheck` are off: a keyboard "helping" with a SKU is a scan that does not match.
- **Always a button.** "Add" stands beside the box, because a bay whose gun is broken is typed into. While a scan is checked it is busy (`aria-busy`, 75%) and never disabled: a form whose submit is disabled ignores Enter, which is how the gun submits. The box stays live too, since the next tag is already on its way.
- **Refused in red, under the box.** `problem` says why ("This tag is not on the picklist.") in `bad` as an alert, and the box takes a `bad` border. Somebody scanning forty tags looks up at the colour, not at the words.
- **Focus on arrival** (`autoFocus`, on by default). Turn it off on a phone, where the keyboard would rise over the sheet.

## Anatomy as drawn

- **Box**: 44px (`tap`), fully round, the `soft-2` fill (which white.css paints white) with a 1px border that is transparent until the pointer is on it, then `hairline-2`. 16px a side, the value 15px in `ink` with 0.02em tracking, in the mono face.
- **Button**: `Button variant="soft"`, which the white look draws as a ghost: 36px, 10px padding, the word "Add" at 500.
- **Line**: 8px between the box and the button. A sentence stands 6px under, 15px: `bad` for `problem`, `mute` for `hint`. The form is padded 12px 16px.
- **Refused**: a `bad` border. The `bad-bg` wash it asks for is painted white by white.css.
- **Locked**: 50%.
- **The store app's box**: 48px, radius 8px (`r-inner`), 1px `hairline-2`, `canvas`, 16px a side, an 18px glass in `line-ico` and the prompt in the box ("Scan a barcode or type a SKU") at 16px so a phone does not zoom. It has an `action` slot at the right and no button.

## Sizes

| Part | Size |
| --- | --- |
| Box | 44px (`tap`) here, 48px in the store app, on every device: it is read at arm's length and pressed with a glove |
| Button | 36px (`control`) |
| Box to button | 8px; the sentence 6px under the box |

## Rules

- One ScanField per screen. It owns the caret.
- Draw the box as a field: `canvas`, 1px `hairline-2`, radius `r-inner`, in the page's own face, as the store app does.
- Busy goes on the button, never on the box. Never disable either while a scan is checked.
- Say why in one sentence under the box. A hint only when it stops a mistake, in a few words.
- The button is a ghost "Add" and stands centred on the box.

## Retired

- **A box with no edge.** `bg-soft-2` and a transparent border: white.css paints the fill white, so at rest the box is white on white, and with `outline-none` and no focus rule it shows no ring. Give it the `hairline-2` border every field has.
- **A pill.** `rounded-full` is for dots, avatars and the Fab. A field is `r-inner`.
- **A mono value.** white.css resets mono on spans and cells but not on an `input`. A code reads in the page's face, as a PO number does.
- **`variant="soft"`** on the button: the variant is retired. Say `ghost`.
- **A button off the centre.** `Add` is 36px beside a 44px box in a row with no `items-center`, so it stands 4px above the box's centre line.
- **A box with no name.** It has no `aria-label` and no placeholder, so a screen reader finds an unnamed text box. The store copy takes a `placeholder`.

## What you provide

| Prop | Type | Notes |
| --- | --- | --- |
| `onSubmit` | `(value: string) => void` | The trimmed code. The box is cleared for you. |
| `action` | `string` | The button's word. Default "Add". |
| `pending` | `boolean` | The last scan is being checked: the button is busy, the box stays live. |
| `disabled` | `boolean` | Locks the box and the button. |
| `problem` | `ReactNode` | Why the last scan was refused: red under the box, a `bad` border, `role="alert"`. |
| `hint` | `ReactNode` | One quiet line when nothing is refused. |
| `autoFocus` | `boolean` | Default `true`. |
| `className` | `string` | Layout only. |

The store app's copy takes `onScan(raw)`, `placeholder`, `autoFocus` and an `action` node instead, and has no `problem`, `hint` or `pending`.

Source: `frontend-hub/src/components/ui/scan-field.tsx` (no importer in the hub), `frontend-store-new/src/components/ui/scan-field.tsx`; look in `styles/white.css` (Fields).
