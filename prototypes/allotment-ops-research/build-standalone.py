"""Bundle the buildless demo into an HTML file that also works via file://."""
from pathlib import Path
import re

root = Path(__file__).resolve().parent
html = (root / 'index.html').read_text()
css = (root / 'styles.css').read_text()
model = re.sub(r'^export ', '', (root / 'model.mjs').read_text(), flags=re.M)
research = re.sub(r'^export ', '', (root / 'research.mjs').read_text(), flags=re.M)
app = re.sub(r'^import .*?;\n', '', (root / 'app.mjs').read_text(), flags=re.M)
html = html.replace('<link rel="stylesheet" href="styles.css">', f'<style>{css}</style>')
html = html.replace('<script type="module" src="app.mjs"></script>', f'<script type="module">\n{model}\n{research}\n{app}\n</script>')
output = root / 'allotment-ops-prototype.html'
output.write_text(html)
print(f'Wrote {output.name}: {len(html)} characters, no external imports')
