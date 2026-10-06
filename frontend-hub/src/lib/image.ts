/// A picked picture, as the JPEG the image store takes.
///
/// **Why this exists.** Every image route in this app is JPEG: the key ends
/// `.jpg`, the presigned upload is issued for `image/jpeg`, and the bytes are
/// served back under that content type. So the file inputs were written
/// `accept="image/jpeg"` — which is honest about the pipeline and useless to
/// the person in front of it. macOS screenshots are PNG. So is nearly
/// everything anybody drags off a supplier's website, out of a chat, or from a
/// design tool. The picker greyed all of it out and disabled Open, and the
/// only reading available was that the app was broken.
///
/// The fix is not to widen what the bucket stores — a store with two formats
/// in it is a store where `image_url` cannot be recomputed from a key. It is
/// to accept the picture and convert it, which is what a person meant by
/// choosing a PNG in the first place.
///
/// **What it does besides converting.** Bounds the long edge. A photograph off
/// a phone is 4000px and eight megabytes; it is shown at 200px in a catalogue
/// row and at 48px on an order line, and uploading the original spends a
/// buyer's tethered connection on detail no screen ever draws.

/// The longest edge a catalogue picture is stored at.
///
/// Generous on purpose: the largest place any of these is drawn is the item
/// form's own square, and 1600 leaves room for a screen twice that dense
/// without going back to the supplier for the picture again.
const LONGEST_EDGE = 1600

/// JPEG quality. 0.85 is the knee — visually indistinguishable from 1.0 on
/// photographs of clothing, at a third of the bytes.
const QUALITY = 0.85

/// Everything the browser will let us decode. Deliberately not `image/*`: a
/// picker that offers HEIC and then refuses it is worse than one that never
/// offered it, and Safari's own screenshots are the only common HEIC anybody
/// tries.
export const PICTURE_TYPES =
  "image/jpeg,image/png,image/webp,image/gif,image/avif"

/// Convert, and downscale if it is big.
///
/// Returns the original untouched when it is already a JPEG within bounds:
/// re-encoding a file that needs nothing done to it only loses detail.
///
/// Throws a sentence a person can act on. `createImageBitmap` rejects with a
/// DOM error naming nothing when handed a HEIC, and "The source image cannot
/// be decoded" is not something to put in front of a buyer.
export async function asJpeg(file: File): Promise<File> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    throw new Error(
      "this picture is in a format the browser cannot open — save it as a JPEG or a PNG and choose it again"
    )
  }

  const longest = Math.max(bitmap.width, bitmap.height)
  const scale = longest > LONGEST_EDGE ? LONGEST_EDGE / longest : 1
  if (file.type === "image/jpeg" && scale === 1) {
    bitmap.close()
    return file
  }

  const canvas = document.createElement("canvas")
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  const context = canvas.getContext("2d")
  if (context === null) {
    bitmap.close()
    throw new Error("this browser cannot convert pictures")
  }
  // JPEG has no transparency, and an unpainted canvas is transparent black —
  // so a PNG cut-out of a garment would arrive with a BLACK background rather
  // than the white every supplier's site shows it on.
  context.fillStyle = "#ffffff"
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", QUALITY)
  )
  if (blob === null) throw new Error("this picture could not be converted")

  return new File([blob], jpegName(file.name), { type: "image/jpeg" })
}

/// `shirt.png` → `shirt.jpg`. The name never reaches the bucket — the key is
/// built from the supplier's and the item's codes — but it is what the form
/// shows back, and a file called `.png` that is now a JPEG is a small lie.
function jpegName(name: string): string {
  const dot = name.lastIndexOf(".")
  return `${dot === -1 ? name : name.slice(0, dot)}.jpg`
}

/// Wake the background service. A service that has been idle is not running,
/// and its first answer takes a few seconds; asking as the photo form opens
/// puts that wait before the photograph, not after it. The answer is not read —
/// a GET with no picture is a question it answers with a 422.
export async function warmCleaning(): Promise<void> {
  try {
    await fetch("/rembg/api/remove")
  } catch {
    // Not there: Clean Up says so when it is pressed.
  }
}

/// A garment photograph tidied for the catalogue: its background taken off,
/// laid on white, and cut square around the garment.
///
/// The picture goes to the background service (`/rembg`), which hands back a
/// PNG with the garment alone on a transparent ground. The image store takes
/// JPEGs only (see `asJpeg`), so the cut-out is put on white and kept as one:
/// every picture in the catalogue then stands on the same white, at the same
/// scale, which is the whole reason to do it.
///
/// Throws a sentence a person can act on. The service can be down, or slow on
/// the first picture after it has been idle while its model loads.
export async function tidyPhoto(photo: Blob): Promise<File> {
  const body = new FormData()
  body.append("file", photo, "photo.jpg")
  let response: Response
  try {
    // A cold service can take most of a minute to start: wait for it, but not
    // for ever.
    response = await fetch("/rembg/api/remove", {
      method: "POST",
      body,
      signal: AbortSignal.timeout(150_000),
    })
  } catch {
    throw new Error("the cleaning service cannot be reached right now")
  }
  if (!response.ok) {
    throw new Error(
      `the cleaning service refused this picture (${response.status})`
    )
  }
  const bitmap = await createImageBitmap(await response.blob())
  try {
    const probe = document.createElement("canvas")
    probe.width = bitmap.width
    probe.height = bitmap.height
    const reader = probe.getContext("2d", { willReadFrequently: true })
    if (reader === null) throw new Error("this browser cannot read the picture")
    reader.drawImage(bitmap, 0, 0)
    const { data } = reader.getImageData(0, 0, probe.width, probe.height)
    // The garment's box: where the picture is not transparent.
    let left = probe.width
    let top = probe.height
    let right = -1
    let bottom = -1
    for (let y = 0; y < probe.height; y++) {
      for (let x = 0; x < probe.width; x++) {
        if (data[(y * probe.width + x) * 4 + 3] > 24) {
          if (x < left) left = x
          if (x > right) right = x
          if (y < top) top = y
          if (y > bottom) bottom = y
        }
      }
    }
    const width = right - left + 1
    const height = bottom - top + 1
    // Nothing found, or a speck: the service saw no garment, so there is
    // nothing to keep over the original.
    if (right < 0 || width * height < probe.width * probe.height * 0.02) {
      throw new Error("no garment was found in this picture")
    }
    // Square, with air round it.
    const side = Math.round(Math.max(width, height) * 1.16)
    const scale = Math.min(1, LONGEST_EDGE / side)
    const out = document.createElement("canvas")
    out.width = Math.max(1, Math.round(side * scale))
    out.height = out.width
    const context = out.getContext("2d")
    if (context === null)
      throw new Error("this browser cannot draw the picture")
    context.fillStyle = "#ffffff"
    context.fillRect(0, 0, out.width, out.height)
    context.drawImage(
      bitmap,
      left,
      top,
      width,
      height,
      Math.round(((side - width) / 2) * scale),
      Math.round(((side - height) / 2) * scale),
      Math.round(width * scale),
      Math.round(height * scale)
    )
    const jpeg = await new Promise<Blob | null>((resolve) =>
      out.toBlob(resolve, "image/jpeg", QUALITY)
    )
    if (jpeg === null)
      throw new Error("this browser could not save the picture")
    return new File([jpeg], "photo.jpg", { type: "image/jpeg" })
  } finally {
    bitmap.close()
  }
}
