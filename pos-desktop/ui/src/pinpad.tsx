/// The pad a PIN is typed on, and the marks that stand in for it.
///
/// # Why the digits are never drawn
///
/// A till stands on a counter with a queue on the other side of it and, when a
/// void is being authorised, a supervisor leaning over it. A PIN drawn as digits
/// is a PIN readable from two metres away, and a PIN read over a shoulder is a
/// PIN spent by somebody else at this same counter tonight — with the
/// supervisor's name written on the row it authorised. So what is drawn is one
/// mark per digit and nothing else: enough to see that a press registered, and
/// nothing to copy.
///
/// # Why it holds nothing of its own
///
/// The value is the caller's plain string and this component keeps no copy in
/// state. That is not tidiness. It is what lets the caller decide where the
/// credential lives and when it stops existing — a ref in `returns.tsx`, emptied
/// the moment the node has answered. A pad keeping its own copy would go on
/// holding a PIN its caller believes it has destroyed.
///
/// # Why there is no input element
///
/// Keys, not a field. A field has to hold focus to be typed into, and on these
/// screens focus belongs to the tag scanner: `returns.tsx` puts it back on the
/// scan box as soon as a sale is open. A PIN field would either fight the
/// scanner for focus or quietly collect a scanned tag as a PIN.

/// The same order as the cash pads in `till.tsx` and `shift.tsx`, because it is
/// the same hand pressing it. A pad that put 1 where the cash pad puts 7 is a
/// pad a PIN gets mistyped on, and a mistyped PIN reaches the node as a refusal
/// with a supervisor's name attached to it.
const KEYS = ["7", "8", "9", "4", "5", "6", "1", "2", "3"] as const

/// The longest PIN this pad will carry. It is a ceiling and not a length: how
/// many digits are *enough* is the node's business, so nothing here guesses a
/// minimum, and an empty mark below says "there is room", never "type more".
const MAX = 8

/// A PIN, entered by pressing rather than typing.
///
/// `value` is digits the caller holds; `onChange` is handed the whole next
/// string rather than the key that was pressed, so the caller is never obliged
/// to reimplement the cap or the backspace. `onSubmit` is the ⏎ key — the caller
/// still draws its own button, and both end up in the same place.
export function PinPad({
  value,
  onChange,
  onSubmit,
  disabled,
}: {
  value: string
  onChange: (next: string) => void
  onSubmit: () => void
  disabled?: boolean
}) {
  // Sanitised here rather than trusted. The value is the caller's own string,
  // and a caller reading it back out of a ref can hand over whatever was last
  // put there — digits only, and never more than the cap, whoever is holding it.
  const digits = value.replace(/\D/g, "").slice(0, MAX)
  const empty = digits === ""

  // A press at the cap changes nothing rather than dropping the first digit:
  // silently shifting the number under somebody's fingers is how a PIN that was
  // typed correctly arrives at the node wrong.
  const press = (key: string) => onChange((digits + key).slice(0, MAX))

  return (
    <div>
      {/* One mark per digit — filled for what has been pressed, hollow for the
          room left. Announced as a single image with a count rather than as
          text, so a reader says "3 of 8" instead of spelling the marks out, and
          so the marks themselves are never read aloud at a counter. */}
      <div
        className="pill"
        role="img"
        aria-label={`${digits.length} dari ${MAX} angka PIN sudah ditekan`}
        style={{ marginTop: 8, fontSize: 16, letterSpacing: 3 }}
      >
        {"●".repeat(digits.length)}
        {"○".repeat(MAX - digits.length)}
        <span className="muted" style={{ fontSize: 11, letterSpacing: 0 }}>
          PIN tidak pernah ditampilkan — maksimal {MAX} angka
        </span>
      </div>

      {/* Every key is `type="button"`. This pad is drawn inside the sign-in
          form in `login.tsx`, and a button in a form without a type IS a submit
          button: pressing 7 would send the password form instead of adding a
          digit. */}
      <div className="numpad" style={{ marginTop: 8 }}>
        {KEYS.map((key) => (
          <button
            key={key}
            type="button"
            disabled={disabled}
            onClick={() => press(key)}
          >
            {key}
          </button>
        ))}
        <button
          type="button"
          className="del"
          disabled={disabled || empty}
          onClick={() => onChange(digits.slice(0, -1))}
          aria-label="Hapus satu angka"
          title="Hapus satu angka"
        >
          ⌫
        </button>
        <button type="button" disabled={disabled} onClick={() => press("0")}>
          0
        </button>
        <button
          type="button"
          disabled={disabled || empty}
          onClick={onSubmit}
          aria-label="Kirim PIN"
          title="Kirim PIN"
        >
          ⏎
        </button>
      </div>
    </div>
  )
}
