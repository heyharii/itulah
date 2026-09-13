import json,sys,os
shell=open('proto-shell.html',encoding='utf-8').read()
cube=open('coa-cube.json',encoding='utf-8').read()
sp='screens.js'
screens=open(sp,encoding='utf-8').read() if os.path.exists(sp) else 'const SCREENS={};'
out=shell.replace('/*__CUBE__*/{}',cube).replace('/*__SCREENS__*/',screens)
open('prototipe-finance.html','w',encoding='utf-8').write(out)
print("built prototipe-finance.html",len(out),"bytes; screens src",len(screens))
