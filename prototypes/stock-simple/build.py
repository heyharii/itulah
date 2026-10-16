"""Bundle both local prototypes into one directly openable HTML file."""
from pathlib import Path

root = Path(__file__).resolve().parent
html = (root / "movement.html").read_text()
html = html.replace('<link rel="stylesheet" href="stock.css">', '<style>\n' + (root / "stock.css").read_text() + '\n</style>')
html = html.replace('  <script defer src="stock-data.js"></script>\n', '').replace('  <script defer src="stock-ui.js"></script>\n', '')
scripts = '\n'.join((root / name).read_text() for name in ['stock-data.js', 'stock-ui.js'])
html = html.replace('</body>', '<script>\n' + scripts + '\n</script>\n</body>')
output = root.parent.parent / "store-stock-simple-prototype.html"
output.write_text(html)
print(output)
