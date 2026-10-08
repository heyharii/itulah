/// The thumbnail that sits beside a catalogue photograph.
///
/// A photograph is stored once, at up to 1600px, and drawn at 32-56px in every
/// list. Fetching it for that is about a hundred kilobytes down and about eight
/// megabytes of bitmap in memory per picture — a purchase order of sixteen
/// lines is a hundred and twenty megabytes, which a phone that is not new
/// answers with grey boxes while it decodes (owner, 2026-10-08: "kenapa ga
/// semua ada gambarnya").
///
/// So every photograph has a second object beside it, 200px on the short side
/// and a tenth of the bytes: the same address with `.jpg` replaced by `.t.jpg`.
///
///   …/supplier/0016/ITM-E5151439.jpg?v=1791450070480
///   …/supplier/0016/ITM-E5151439.t.jpg?v=1791450070480
///
/// The query string rides along, so a replaced photograph is a new address for
/// its thumbnail too. New uploads write the thumbnail themselves
/// (`uploadSupplierItemImage`, `uploadArticleImage`); `scripts/backfill-thumbs.py`
/// wrote the ones that were there before. The key is built on the node
/// (`thumbnail_key` in `backend/src/cloud/media.rs`) by the same rule, and no
/// photograph's own key can end in `.t.jpg`.

/// A photograph the catalogue stored: under the supplier or the catalogue
/// prefix of the image store, a JPEG. Anything else — a supplier's own site, a
/// presigned link — has no thumbnail to look for.
const PHOTO =
  /^(https?:\/\/[^?#]*\/(?:supplier|catalogue)\/[^?#]+)\.jpg((?:[?#].*)?)$/i

/// Photographs asked for a thumbnail and told there is none, for as long as the
/// page is open: the second list that draws the same picture does not ask
/// again. A thumbnail may be missing — a photograph from before the backfill,
/// or one uploaded from an older build — and the photograph itself is then the
/// answer.
const without = new Set<string>()

/// Where `url`'s thumbnail would be, or `null` when it cannot have one.
export function thumbUrl(url: string | null | undefined): string | null {
  if (url === null || url === undefined || url === "" || without.has(url))
    return null
  const found = PHOTO.exec(url)
  if (found === null || found[1].endsWith(".t")) return null
  return `${found[1]}.t.jpg${found[2]}`
}

/// `url` has no thumbnail: stop asking for it.
export function hasNoThumb(url: string): void {
  without.add(url)
}
