#!/usr/bin/env python3
"""Give every catalogue photograph in the media bucket a 200px thumbnail.

A photograph is stored once, at up to 1600px (`frontend-hub/src/lib/image.ts`),
and is drawn at 32-56px in every list. The thumbnail is a second object beside
it — same key, `.jpg` replaced by `.t.jpg`:

    supplier/0016/ITM-E5151439.jpg     the photograph, 1200x1600, ~100 KB
    supplier/0016/ITM-E5151439.t.jpg   its thumbnail, 200x267, ~10 KB

The hub derives the thumbnail's address from the photograph's
(`frontend-hub/src/lib/thumb.ts`) and falls back to the photograph when there
is no thumbnail, so this can run at any time and run twice: it adds objects,
it never changes or deletes the originals. A key cannot contain a dot (see
`path_safe` in `backend/src/cloud/media.rs`), so `.t.jpg` can never be a
photograph's own key.

New uploads make their own thumbnail in the browser; this is for what was
uploaded before that.

    python3 scripts/backfill-thumbs.py --dry-run
    python3 scripts/backfill-thumbs.py
    python3 scripts/backfill-thumbs.py --force          # redo every thumbnail

Needs `gcloud` signed in with write access to the bucket, and either Pillow or
macOS `sips` to resize.
"""

import argparse
import concurrent.futures
import os
import re
import shutil
import subprocess
import sys
import tempfile

parser = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
parser.add_argument("--bucket", default="gs://itulah-media-21f41328")
parser.add_argument("--prefix", action="append", default=None,
                    help="key prefix to cover; repeatable (default supplier/ and catalogue/)")
parser.add_argument("--project", default="project-21f41328-b088-4894-b3f")
parser.add_argument("--short-edge", type=int, default=200,
                    help="the shorter side of the thumbnail, in pixels")
parser.add_argument("--quality", type=int, default=80)
parser.add_argument("--force", action="store_true", help="rewrite thumbnails that exist")
parser.add_argument("--dry-run", action="store_true")
args = parser.parse_args()
PREFIXES = args.prefix or ["supplier/", "catalogue/"]
BUCKET = args.bucket.rstrip("/")

try:
    from PIL import Image  # type: ignore
except ImportError:
    Image = None
if Image is None and shutil.which("sips") is None:
    sys.exit("need Pillow (pip install pillow) or macOS sips to resize pictures")


def gcloud(*argv, check=True):
    return subprocess.run(["gcloud", "--project", args.project, "storage", *argv],
                          capture_output=True, text=True, check=check)


def listing():
    """Every `.jpg` under the prefixes, as full gs:// addresses."""
    found = []
    for prefix in PREFIXES:
        out = gcloud("ls", "-r", f"{BUCKET}/{prefix}", check=False).stdout
        found += [line.strip() for line in out.splitlines() if line.strip().endswith(".jpg")]
    return found


def thumb_of(address):
    return re.sub(r"\.jpg$", ".t.jpg", address)


def resize(source, target):
    """Shorter side = --short-edge, never enlarged; white-backed JPEG."""
    if Image is not None:
        with Image.open(source) as picture:
            picture = picture.convert("RGB")
            width, height = picture.size
            short = min(width, height)
            if short > args.short_edge:
                ratio = args.short_edge / short
                picture = picture.resize(
                    (max(1, round(width * ratio)), max(1, round(height * ratio))),
                    Image.LANCZOS)
            picture.save(target, "JPEG", quality=args.quality, optimize=True, progressive=True)
        return
    size = subprocess.run(["sips", "-g", "pixelWidth", "-g", "pixelHeight", source],
                          capture_output=True, text=True, check=True).stdout
    width = int(re.search(r"pixelWidth: (\d+)", size).group(1))
    height = int(re.search(r"pixelHeight: (\d+)", size).group(1))
    resample = []
    if min(width, height) > args.short_edge:
        resample = (["--resampleWidth", str(args.short_edge)] if width <= height
                    else ["--resampleHeight", str(args.short_edge)])
    subprocess.run(["sips", *resample, source, "--out", target,
                    "--setProperty", "format", "jpeg",
                    "--setProperty", "formatOptions", str(args.quality)],
                   capture_output=True, check=True)


def one(address, existing):
    try:
        return attempt(address, existing)
    except Exception as error:  # one unreadable file must not stop the others
        return ("failed", address, 0, str(error).strip().splitlines()[-1][:120] if str(error).strip() else type(error).__name__)


def attempt(address, existing):
    thumb = thumb_of(address)
    if thumb in existing and not args.force:
        return ("skip", address, 0, 0)
    if args.dry_run:
        return ("would", address, 0, 0)
    with tempfile.TemporaryDirectory() as work:
        original, small = os.path.join(work, "o.jpg"), os.path.join(work, "t.jpg")
        gcloud("cp", address, original)
        resize(original, small)
        # The same short cache the originals have: a replaced photograph is
        # written over its own key, so a year-long cache would show the old one.
        gcloud("cp", small, thumb, "--content-type=image/jpeg",
               "--cache-control=public, max-age=3600")
        return ("made", address, os.path.getsize(original), os.path.getsize(small))


def main():
    jpgs = listing()
    thumbs = {a for a in jpgs if a.endswith(".t.jpg")}
    originals = [a for a in jpgs if not a.endswith(".t.jpg")]
    print(f"{len(originals)} photographs, {len(thumbs)} thumbnails already there")
    made = skipped = failed = 0
    before = after = 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        for status, address, big, small in pool.map(lambda a: one(a, thumbs), originals):
            if status == "made":
                made += 1
                before += big
                after += small
                print(f"  made   {address.replace(BUCKET + '/', '')}  {big // 1024} KB -> {small / 1024:.1f} KB")
            elif status == "skip":
                skipped += 1
            elif status == "failed":
                failed += 1
                print(f"  FAILED {address.replace(BUCKET + '/', '')}: {small}")
            else:
                print(f"  would  {address.replace(BUCKET + '/', '')}")
    print(f"done: {made} made, {skipped} already had one, {failed} failed"
          + (f"; {before // 1024} KB of photographs now also have {after // 1024} KB of thumbnails" if made else ""))


main()
