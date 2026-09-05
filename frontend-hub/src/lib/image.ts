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
