"""Builds po-soft-preview.html, the client's copy of po-matte-options.html.

Only two looks (Now, Soft = the "Soft cards" level), Matte phone icons and the Soft desk
layout fixed, no doctype/html/head/body (the Artifact publish wraps the page), and a
phone that fits a real phone. Re-run after editing po-matte-options.html:
    python3 scripts/po-soft-preview.py
"""
import re
from pathlib import Path

root = Path(__file__).resolve().parent.parent
s = (root / "po-matte-options.html").read_text()

def rep(old, new):
    global s
    assert s.count(old) == 1, old[:80]
    s = s.replace(old, new)

# the publish wraps the page in its own skeleton
for tag in ['<!doctype html>\n', '<html lang="en">\n', '<head>\n', '</head>\n', '<body>\n', '</body>\n', '</html>\n']:
    rep(tag, "")
s = re.sub(r'<meta charset="utf-8">\n<meta name="viewport"[^>]*>\n', "", s)
rep("<title>PO matte options</title>", "<title>Central Soft Cards</title>")

# two looks only: Now and Soft (the Soft cards level)
rep('''  <button class="proto-picker-item">Now</button>
  <button class="proto-picker-item">Touch</button>
  <button class="proto-picker-item">Matte</button>
  <button class="proto-picker-item">Soft</button>
  <button class="proto-picker-item">Soft cards</button>''', '''  <button class="proto-picker-item">Now</button>
  <button class="proto-picker-item">Soft</button>''')
rep('aria-label="Prototype variants"', 'aria-label="Look"')
rep('makePicker(document.getElementById("variants"), "v", 5, (i) => { level = i; if (booted) mount(); });',
    'makePicker(document.getElementById("variants"), "v", 2, (i) => { level = [0, 4][i]; if (booted) mount(); });')
rep("if (n >= 1 && n <= 5) picker.set(n - 1);", "if (n >= 1 && n <= 2) picker.set(n - 1);")
rep("picker.set((level + 1) % 5);", "picker.set((picker.at + 1) % 2);")
rep("picker.set((level + 4) % 5);", "picker.set((picker.at + 1) % 2);")

# the Soft-cards pill is fixed for the client: Matte phone icons, Soft desk layout
CLIENT_CSS = '''
/* client preview: the look is fixed beyond Now/Soft; the page fits a phone; pills clear the notch */
#icons, #layout { display: none !important; }
body:is([data-icons], [data-layout]) #stage { padding-top: 152px; }
.proto-picker[data-position="top"] { margin-top: env(safe-area-inset-top, 0px); }
@media (max-width: 767px) { body:is([data-icons], [data-layout]) #stage { padding-top: 124px; } }
@media (max-width: 480px) {
  .phone { width: 100%; height: 812px; padding: 0; border-radius: 0; background: none; box-shadow: none; }
  .ps { border-radius: 18px; box-shadow: 0 0 0 1px rgb(0 0 0 / 6%), 0 12px 32px rgb(0 0 0 / 12%); }
}
</style>'''
rep("</style>", CLIENT_CSS)

(root / "po-soft-preview.html").write_text(s)
print("wrote po-soft-preview.html")
