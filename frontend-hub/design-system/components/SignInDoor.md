# SignInDoor

The template for the one screen drawn before the app knows who you are. Since 20 Oct it is **Matte**: one white card on the icon's pastel, the same on a desk and a phone (owner: "sign in pilihan matte", from `sign-in-options.html`).

## Matte, slot by slot

- **The ground** (`.door-ground`): a pastel wash, #eef3fd at the top to #dfe8fa at the foot, filling the window.
- **The card** (`.door-card`): white, radius 24, 400px wide at most.
  - It stands clamp(40px, 16vh, 176px) from the top, padded 36/32/32 (28/20/24 on a phone).
  - Its shadow is soft and tinted blue. It lifts in once, 8px and from 0.985 scale, over 480ms ease-out.
- **The head**, centred, 28px above the fields:
  - the mark (`BrandMark`, Matte · Deep) at 68px with a soft blue drop shadow;
  - 16px under it, "Central" at 28px, weight 700, tracking −0.04em, then the icon's yellow dot (#efa614) as the period.
  - There is no title and no caption: the h1 "Sign in" is for screen readers only.
- **The fields** (`LoginForm door`), 18px apart:
  - the label in `body`; a filled box (`.door-field`) 48px tall, radius 12, #f1f4fa, with no line;
  - type at 16px, so iOS does not zoom.
  - Focused, the box is white with a 2px `accent` ring and a 6px halo. Refused, the password box is #fff6f6 with a 2px `bad` ring.
- **Forgot password?** is a tinted chip (`.door-chip`) beside the Password label. Pressed, it shows one line under the field: "Ask your admin for a temporary password." There is no footnote.
- **The error**: the same red line with its icon, under the fields.
- **Sign in**, 24px below the fields: full width, 48px, radius 12. Its blue runs #4a80ea at the top to #2155c8 at the foot, with no shine and a soft blue shadow.
- **The server**, under the card at the window's foot: the same dot and line as before ("Central is online", "Central can’t be reached", "Checking Central…").
- **The sandbox**: the business eyebrow sits centred over the fields, inside the card.

The rest of this card describes the two halves that Matte replaced. They are retired, and kept as the record of what changed.

## Copy this screen

- Files `frontend-hub/src/components/sign-in-door.tsx` (the frame), `login-form.tsx` (the form), `business-door.tsx` (the sandbox's first step) and `brand-mark.tsx` (the icon); the motion is `styles/index.css` "the door".
- Mounted by `App.tsx` whenever there is no session. Start from it for any screen that stands in front of the app: it is never a route and never a layer.

## When to use it

| The way in | Use |
| --- | --- |
| Signing in to Central | `SignInDoor` around `LoginForm` |
| A server that holds several businesses, before one is chosen | `SignInDoor` around `BusinessChooser` |
| A second password box inside the app (the warehouse's recovery sign-in) | `LoginForm` alone, with its own title; no door |
| Anything signed in | Not the door |

## Retired: the two halves (before 20 Oct)

### The frame

Two halves side by side. The first is `clamp(22rem, 38vw, 34rem)`: 352px at the narrowest, 365px in this card, 544px from 1440 up, padded 48px all round. The form half takes the rest.

- **The mark**, 40px, top left: the app icon (`BrandMark`), drawn rather than loaded. It is Matte · Deep: a matte blue `brand-tile` tile (radius 23.4 of a 100 box, #4277e6 to #1f4fc0), a pale C with a soft contact shadow, and a yellow dot at its mouth. 28px in the rail and the phone's bar, 64px on a phone's door.
- **The name**, at the foot of the half: "Central" at 48px on 48px in `ink`, tracking −0.045em, then an `accent` dot (the dot of the icon). It is set at 600; the source's `font-bold` is retired. Under it, 12px down, the promise in `rail-text` at 15px on 24px, 320px wide at most: "The stores, the stock, the buying and the money, in one place."
- **The server**, 48px under that: an 8px dot and one line in `rail-text`. `ok` and "Central is online" (the dot pulses a 6px ring over 2.4s), `bad` and "Central can’t be reached", `rail-mute` and "Checking Central…" while it asks. It says so before anybody types a password, so a refusal is never a typo that was really a dead node.
- **The ground**, three layers behind everything and clipped to the half: a white light at 7% falling from the top-left corner, the blue glow, and grain.
  - The glow is a 480px circle in `accent` at 25%, blurred 112px, 160px past the right edge and 192px past the bottom. It drifts for 16s there and back (from −6% 5% to 6% −6%, swelling to 1.14), so slowly it is felt, not watched. The card draws it at rest.
  - The grain is a 220px fractal-noise tile at 14% in `soft-light`.

### The form half

The form is centred, 360px at most, 40px above and below and 24px at the sides.

| Block | Drawn as | Space after |
| --- | --- | --- |
| Title | "Sign in" at 28px on 36px, 600, −0.025em | 8px |
| Caption | "Use the account your administrator set up for you." 15px on 24px in `body` | 32px |
| Fields | Username and Password, 20px apart: the label in `mute` 8px over a 40px box (44px under a finger). The password's eye is a 36px glyph button 6px in from the right, 18px, `line-ico`. | 28px |
| Button | "Sign in", `primary`, 44px (`tap`), the width of the form, an inset highlight of white at 16% over a 1px lift | 24px |
| Footnote | "Forgot your password? An administrator can set a new one for you." 15px on 20px in `body` | |

- There is no sign-up and no other way in: accounts are given by an administrator. The username box has the focus.
- Motion: every block rises 8px as it fades in over 520ms on `ease-out`, 60ms after the one above (the stagger starts at 80ms); the half fades in over 900ms. Under reduced motion all of it is at its end and the glow stops. A refusal shakes the form for 360ms (6, 5, 3, 2px).

### States

- **Refused:** one line under the fields, a 16px alert glyph and the server's own sentence in `bad-fg` ("Invalid username or password"), first letter capital. It goes the moment either field changes. The fields keep their borders.
- **Caps Lock:** "Caps Lock is on." as the password's hint in `mute`, read from the keys and cleared when the box loses focus.
- **Pending:** "Signing in…", 75%, `aria-busy`.
- **Offline:** the status line says so in `bad`; the form is still drawn.
- **Several businesses:** the form half opens on "Welcome" and two rows (Create a business, I have a business code), each 1px `hairline-2`, `r-card`, a 40px round `soft-2` glyph tile and two lines. A chosen business stands over the heading in `body`, with "Switch business".

## On a phone

- The two halves stack and the door is white all through. The top is the mark at 64px, centred, then the name at 36px in `ink`, centred. The promise, the grain and the glow are not drawn.
- The heading and the caption are not drawn either: the name has said it. The fields start 24px down. The "Sign in" block sticks to the bottom, 44px, with the home bar's safe area under it, and "Central is online" is centred beneath it.

## Rules

Do:
- Use one door: every sign-in path goes through `SignInDoor`; the frame holds the mark, the name, one promise and the server's state, and the form half holds the form.
- Keep the glow the screen's one gradient.
- Say Central, with the mark and the name together; the dot after the name is the dot in the icon.
- Ask for a username and a password.

Don't:
- Write "Central Dashboard", itulah or the company's name.
- Add an email box, a third-party sign-in or a sign-up link.
- Put an explanation under the fields.

## Retired

Follows it: the cloud sign-in (`App.tsx`), the sandbox's business chooser, and the warehouse recovery box, which reuses `LoginForm` without the frame (`screens/operations/gate.tsx:203`).

Drifts, on the reference screen itself:
- The charcoal half. The comments in `sign-in-door.tsx`, `brand-mark.tsx` and `index.css` still say charcoal, and so does the brand note. In the All white look `--rail` is `transparent` (`white.css:1481`), so the half is the page's white with the grain on it: that is what the hub draws and what this card draws. Bringing the charcoal back is one rule, not a rebuild.
- `font-bold` on the name (`sign-in-door.tsx:29`), the fourth weight that `design-lint` forbids.
- "Central Dashboard" as the form's default title and caption (`login-form.tsx:40`), as the page's `<title>` (`routes/__root.tsx:91`) and in the warehouse gate's sentences (`operations/gate.tsx:186`, `:205`, `:248`).
- Literals: the Sign in button's inline shadow (`login-form.tsx:261`), the eye button's `rounded-[0.4375rem]` (`:228`), and the green ring in `door-live` (`index.css:373`) written as `rgb(54 184 39 …)` instead of the `ok` token. The mark's SVG carries its gradient stops as hex; `brand-tile` names the tile's middle.

Drifts elsewhere:
- The join page draws a `bg-dark` square holding the letter C (`screens/join/join-page.tsx:40`) instead of `BrandMark`, and has no door.
- Helper sentences in the business chooser: "Set up a new one to try.", "This server holds more than one business…".

## What you provide

| Piece | Prop | Notes |
| --- | --- | --- |
| `SignInDoor` | `children` | The form half. |
| `LoginForm` | `onSignedIn` | Receives the session. |
| | `title`, `caption` | "Sign in" and the line under it. The defaults say Central Dashboard; do not rely on them. |
| | `footnote` | Where to turn for a forgotten password. |
| | `problem`, `signIn` | A failure of the session itself; another node's sign-in call. |
| | `eyebrow`, `titleOnPhone`, `className` | A line above the title (a business name); the phone hides the title; layout. |
| `BrandMark` | `className` | Its size. |
| `BusinessChooser` | `inviteRequired`, `onSelected`, `onCreated` | The sandbox's first step. |

Source: `frontend-hub/src/components/sign-in-door.tsx`, `login-form.tsx`, `business-door.tsx`, `brand-mark.tsx`; `styles/index.css` ("the door": `door-rise`, `door-in`, `door-drift`, `door-live`, `door-grain`); `styles/white.css` (`--rail`).
