import glob
d = '/Users/hari/Documents/itulah/finance-menu-final/'
base = open(d + 'base.html').read()
css = open(d + 'base.css').read()
js = open(d + 'base.js').read() + '\n' + open(d + 'data.js').read()
# screens register in the menu's order: stores · cash · pay · acc · rep · setup
for f in ['scr-stores.js', 'scr-cash.js', 'scr-cash2.js', 'scr-pay.js', 'scr-acc.js', 'scr-rep.js']:
    try:
        js += '\n;/* ═════ ' + f + ' ═════ */\n' + open(d + f).read() + '\n;'
    except FileNotFoundError:
        pass
js += '\nboot()\n'
out = base.replace('/*@CSS*/', css).replace('/*@JS*/', js.replace('</script>', '<\\/script>'))
open('/Users/hari/Documents/itulah/finance-menu-final-prototype.html', 'w').write(out)
print('built', len(out))
