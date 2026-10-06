"""Background removal for catalogue photographs.

A small, deliberate wrapper around `rembg`, not `rembg s`: the stock server
loads whatever model it likes per request, answers anybody, and takes minutes
on a big model. This one loads ONE small model at start (baked into the image,
so a cold start is a few seconds and not a download), takes a picture, and
returns a PNG with the background transparent.

    GET  /api/remove   ->  422 JSON   (is the service up? the hub asks this)
    POST /api/remove   ->  image/png  (multipart "file"; needs X-Api-Key)

The key is not a login. The hub's web server adds it to what it forwards, so
the browser never holds it and this URL is of no use to anybody without it.
"""
import io
import os

from fastapi import FastAPI, File, Header, HTTPException, Response, UploadFile
from PIL import Image
from rembg import new_session, remove

MODEL = os.environ.get("REMBG_MODEL", "u2net")
KEY = os.environ.get("API_KEY", "")
# A phone photograph is 4000px and the model looks at 320: shrinking first
# saves decode and compose time, and the hub squares the result anyway.
LONGEST = int(os.environ.get("LONGEST_EDGE", "1600"))

app = FastAPI(title="rembg")
session = new_session(MODEL)


@app.get("/api/remove")
def ask():
    # The status is deliberate: a 422 with a JSON body is how the hub tells
    # this service from its own web server's page, which answers 200 to any path.
    raise HTTPException(status_code=422, detail="POST a picture as the form field 'file'.")


@app.post("/api/remove")
async def remove_background(
    file: UploadFile = File(...), x_api_key: str | None = Header(default=None)
):
    if KEY and x_api_key != KEY:
        raise HTTPException(status_code=401, detail="no")
    data = await file.read()
    try:
        picture = Image.open(io.BytesIO(data))
        picture.load()
    except Exception:
        raise HTTPException(status_code=415, detail="not a picture this can read")
    picture = picture.convert("RGB")
    longest = max(picture.size)
    if longest > LONGEST:
        scale = LONGEST / longest
        picture = picture.resize(
            (max(1, round(picture.width * scale)), max(1, round(picture.height * scale))),
            Image.LANCZOS,
        )
    cut = remove(picture, session=session)
    out = io.BytesIO()
    cut.save(out, format="PNG")
    return Response(content=out.getvalue(), media_type="image/png")
