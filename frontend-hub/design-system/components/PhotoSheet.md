# PhotoSheet

PhotoSheet is the full-screen "Check the photo" layer a photograph passes through before it is kept: it shows the picture as it was taken, offers Clean up and Crop as options, and ends in Use photo or Retake.

## When to use it

| Job | Use |
| --- | --- |
| A photograph was just taken or chosen, and is about to be kept | `PhotoSheet`. Today only the New item form mounts it (`procurement/item-form.tsx`), for a new photo and for editing the one on the form |
| Look at a photograph full size | A thumbnail wrapped in `ZoomPhoto`, which opens `PhotoViewer` (7 files) |

A photograph is never touched on its way in. It is shown as it was taken and what can be done to it is two buttons, both optional. Skip both and it is kept as taken.

## Anatomy

| Part | Drawn as |
| --- | --- |
| Layer | The whole window in `canvas`, above everything (z 300), a dialog named "Check the photo". No veil and no motion: it is a white page, not a sheet |
| Head | 56px. "Check the photo" at 17px and 600 (`title`), a 44px round × at the right in `line-ico` (Cancel) |
| Switch | Only once the photo has been cleaned: Original and Clean, sharing the width. The chosen one is white on the `segment-track` |
| Picture | A square, 1px `hairline`, radius 10px (`r-card`), the picture contained in it. The clean picture stands on white. The two cross-fade over 300ms. While it is being cleaned the original blurs by 1.5px and a light crosses it, 1.3s a pass |
| Options | Two ghosts sharing the width: "Clean up" with a sparkle, then "Crop" with scissors. Clean up says "Cleaning…" while the service works, "Cleaned" (dim) once it has, and "Try again" after a failure |
| Status | One 15px line in `body`, centred: "As it was taken." or "Background removed, photo squared." A failure is `bad-fg`: "Could not clean this photo. The original is fine to use." or "This picture could not be cut." |
| Foot | Two buttons sharing the width: "Retake" (ghost), then "Use photo" (primary) |

Every button is 48px high today (`size="lg"` with `h-12`); the × is 44px.

## Crop

- The same square becomes a crop frame over whichever picture is on show: a square box with a grid, dragged to move, with one Zoom slider (1× to 4×, 44px high) under it and nothing to size or choose between.
- The foot is "Cancel" (red) and "Done". Done keeps the cut picture and closes the whole layer, as Use photo does (owner, 6 Oct 2026: it used to come back up after a crop). Esc closes the crop first, then the layer.

## What is kept

| Step | Does |
| --- | --- |
| Choosing | `asJpeg` makes it a JPEG, 1200px on the long edge at quality 0.8 (`lib/image`). A JPEG within bounds is left untouched |
| Clean up | `tidyPhoto` takes the background off, lays the garment on white and cuts the picture square round it. The service is woken as the form opens |
| Crop | `cutOut` draws the part inside the frame as a JPEG within 1200px, on white, so a crop that reaches past the picture reaches into white, never black |
| Use photo | Keeps what is on show. Retake starts again from the camera |

## Looking at a photograph

- `ZoomPhoto` wraps a thumbnail (40px in lists) in a button: `cursor-zoom-in`, radius 8px, `scale(0.96)` on press. It stops the tap reaching the row or card around it, so the record does not open. With no photograph and no placeholder it is the thumbnail and nothing else. With a placeholder (the painted silhouette) it still opens, and says "No photo yet".
- `PhotoViewer` is the photograph, contained, over the window. A tap, the × or Esc puts it away. It is a Base UI dialog: focus stays in it and goes back to the thumbnail after, and opened over a sheet it is that sheet's child, so Esc closes it alone and the sheet stays.
- It moves as a confirmation does: the black fades in over `t-panel` and the photograph comes up from 0.96 on `ease-out`, centred, and both leave the same way. It never flies out of the thumbnail. Under reduced motion it only fades.
- The source draws it on `black` at 90% with a white 15% × over a blur. The house veil is `scrim` with its 2px blur, and nothing in Central darkens.

## Rules

- Show the photograph first, as it was taken, and ask for nothing before it. Clean up and Crop are choices; Use photo is the one primary.
- One way out of each state: Use photo or Retake from the check, Done or Cancel from the crop, × or Esc from either.
- A looked-at photograph is a layer: a thumbnail, a SKU's picture and an article's picture all open it (every object with a detail opens it).
- Photographs are JPEG, bounded at 1200px, and lists never fetch them: they take the thumbnail beside it.

## Retired

- **`PhotoViewer` on black at 90%.** Use the `scrim` veil. The × is an `ink` glyph on a `canvas` disc, not white on a blur.
- **A black crop frame.** `bg-black` under the cropper, and the cropper's own dark mask. The frame stands on `soft-2`.
- **Title Case.** "Check the Photo", "Clean Up", "Use Photo" and "Try Again" are sentence case: "Check the photo", "Clean up", "Use photo", "Try again".
- **Buttons of 48px.** `size="lg"` is 44px (`tap`); `h-12` overrides it. Pick a size.
- **A spinner.** "Cleaning…" draws a turning `Loader2` beside the word. A pending button says its word and fades; it has no spinner.
- **A switch made by hand.** A 10px track with 40px items and `shadow-soft`. Use `Segmented`.
- **A status line that repeats the switch.** "As it was taken." and "Background removed, photo squared." say what the control above already shows. Keep the failures.
- **A layer built by hand that is called a sheet.** It draws its own head, ×, Esc and square corners, with no veil and no drawer. A phone's layers are the bottom drawer (`Sheet`): full height less 12px, a grip, top corners `r-sheet`.

## What you provide

| Component | Prop | Type | Notes |
| --- | --- | --- | --- |
| `PhotoSheet` | `file` | `Blob` | The photograph, as taken |
| | `onUse` | `(photo: Blob) => void` | What is kept: the original, the clean one, or the cut one |
| | `onRetake` | `() => void` | |
| | `onCancel` | `() => void` | |
| `ZoomPhoto` | `url` | `string \| null \| undefined` | Empty means no photograph |
| | `name` | `string` | Names the button: "View the photo of Kaos Polos" |
| | `placeholder` | `ReactNode` | Shown large when there is no photograph, so the tap is never dead |
| | `className`, `children` | | The thumbnail goes in `children` |
| `PhotoViewer` | `open`, `onOpenChange`, `url`, `name`, `placeholder` | | The layer itself, when a screen needs it without a thumbnail. Keep it rendered and drive `open`, so it can leave the way it came |

Source: `frontend-hub/src/components/ui/photo-sheet.tsx`, `photo-viewer.tsx`, with `lib/image.ts`.
