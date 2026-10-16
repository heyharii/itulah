from pathlib import Path

base = Path(__file__).resolve().parent
root = base.parent.parent
html = (base / 'index.html').read_text()
css = (base / 'styles.css').read_text()
model = (base / 'model.mjs').read_text().replace('export ', '')
app = '\n'.join((base / 'app.mjs').read_text().splitlines()[1:])
html = html.replace('<link rel="stylesheet" href="styles.css">', f'<style>{css}</style>')
html = html.replace('<script type="module" src="app.mjs"></script>', f'<script type="module">{model}\n{app}</script>')
for destination in [root / 'stock-observed-options.html', root / 'frontend-store-new/public/prototypes/stock-observed-options.html']:
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(html)
    print(destination)
