import glob,re
d='/Users/hari/Documents/itulah/finance-7soft/'
base=open(d+'base.html').read()
css=open(d+'base.css').read()
js=open(d+'data-coa.js').read()+'\n'+open(d+'data-manual.js').read()+'\n'+open(d+'data-coverage.js').read()+'\n'+open(d+'data-menus.js').read()+'\n'+open(d+'base.js').read()
for f in sorted(glob.glob(d+'decide-*.js'))+sorted(glob.glob(d+'scr-*.js'))+sorted(glob.glob(d+'scr7-*.js')): js+='\n;/* ═════ '+f.split('/')[-1]+' ═════ */\n'+open(f).read()+'\n;'
js+='\n/* ═════ extras ═════ */\n'
for f in sorted(glob.glob(d+'link-*.js')): js+=open(f).read()
js+='\nboot()\n'
out=base.replace('/*@CSS*/',css).replace('/*@JS*/',js.replace('</script>','<\\/script>'))
open('/Users/hari/Documents/itulah/finance-7soft-prototype.html','w').write(out)
print('built',len(out))
