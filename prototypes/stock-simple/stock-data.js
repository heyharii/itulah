/* Local demo data. A physical observation never changes the stock ledger. */
(() => {
  'use strict';
  const KEY = 'cikupa-stock-simple-v1';
  const catalog = [
    {id:'ox-n-m',name:'Kemeja Oxford',code:'00000002',color:'Navy',hex:'#344768',size:'M',shape:'shirt',warehouse:2,floor:0},
    {id:'ox-n-l',name:'Kemeja Oxford',code:'00000002',color:'Navy',hex:'#344768',size:'L',shape:'shirt',warehouse:3,floor:1},
    {id:'ox-w-m',name:'Kemeja Oxford',code:'00000002',color:'Putih',hex:'#e8e7e2',size:'M',shape:'shirt',warehouse:1,floor:1},
    {id:'tee-c-s',name:'Kaos Oblong',code:'00000003',color:'Abu tua',hex:'#54565b',size:'S',shape:'tee',warehouse:2,floor:1},
    {id:'tee-c-m',name:'Kaos Oblong',code:'00000003',color:'Abu tua',hex:'#54565b',size:'M',shape:'tee',warehouse:4,floor:1},
    {id:'tee-b-l',name:'Kaos Oblong',code:'00000003',color:'Hitam',hex:'#292a30',size:'L',shape:'tee',warehouse:2,floor:0},
    {id:'bl-s-s',name:'Blus Linen',code:'00000008',color:'Sage',hex:'#a0b29a',size:'S',shape:'shirt',warehouse:1,floor:0},
    {id:'bl-s-m',name:'Blus Linen',code:'00000008',color:'Sage',hex:'#a0b29a',size:'M',shape:'shirt',warehouse:2,floor:0},
    {id:'bl-s-l',name:'Blus Linen',code:'00000008',color:'Sage',hex:'#a0b29a',size:'L',shape:'shirt',warehouse:0,floor:1},
    {id:'ch-k-30',name:'Celana Chino',code:'00000009',color:'Khaki',hex:'#beaa83',size:'30',shape:'pants',warehouse:2,floor:1},
    {id:'ch-k-32',name:'Celana Chino',code:'00000009',color:'Khaki',hex:'#beaa83',size:'32',shape:'pants',warehouse:2,floor:0},
    {id:'ch-n-34',name:'Celana Chino',code:'00000009',color:'Navy',hex:'#344768',size:'34',shape:'pants',warehouse:1,floor:0}
  ];
  const places = {warehouse:'Gudang toko',floor:'Area jual'};
  const key = (id,place) => `${id}:${place}`;
  function fresh() {
    const now = Date.now();
    const stock = Object.fromEntries(catalog.map(p=>[p.id,{warehouse:p.warehouse,floor:p.floor}]));
    const revision = {};
    const observations = {};
    const seed = (id,place,qty,minutes,rev=0) => {
      observations[key(id,place)] = {id,place,qty,at:now-minutes*60000,who:'Dewi',revision:rev,expected:stock[id][place]};
    };
    seed('ox-n-m','warehouse',2,22);
    seed('ox-n-l','warehouse',2,25);
    seed('ox-w-m','warehouse',2,80);
    revision[key('ox-w-m','warehouse')] = 1;
    seed('tee-c-s','warehouse',2,35);
    seed('tee-c-m','floor',0,30);
    seed('ox-n-l','floor',1,15);
    return {version:1,stock,revision,observations,history:[],checks:[],serial:0};
  }
  let storageAvailable = true;
  function read() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) { const value=JSON.parse(raw); if(value.version===1 && catalog.every(p=>value.stock?.[p.id])) return value; }
    } catch { storageAvailable=false; }
    return fresh();
  }
  let state = read();
  const persist = () => { try { localStorage.setItem(KEY,JSON.stringify(state)); } catch { storageAvailable=false; } };
  const product = id => catalog.find(p=>p.id===id);
  const revision = (id,place) => state.revision[key(id,place)] || 0;
  function status(id,place) {
    const seen=state.observations[key(id,place)];
    if(!seen) return {kind:'unchecked',label:'Belum dicek',seen:null};
    if(seen.revision!==revision(id,place)) return {kind:'stale',label:'Perlu cek ulang',seen};
    const diff=seen.qty-state.stock[id][place];
    return {kind:diff===0?'match':'gap',label:diff===0?'Sesuai':`Selisih ${Math.abs(diff)} pcs`,diff,seen};
  }
  function validate(lines,from,to) {
    if(!places[from] || !places[to] || from===to) throw new Error('Pilih lokasi asal dan tujuan yang berbeda.');
    if(!lines.length) throw new Error('Pilih barang yang akan dipindahkan.');
    const ids=new Set();
    for(const l of lines) {
      if(!product(l.id)||ids.has(l.id)||!Number.isInteger(l.qty)||l.qty<=0) throw new Error('Periksa kembali jumlah barang.');
      if(l.qty>state.stock[l.id][from]) throw new Error(`Stok ${product(l.id).name} ${product(l.id).size} tidak mencukupi. Periksa jumlahnya.`);
      ids.add(l.id);
    }
  }
  function move(lines,from,to) {
    validate(lines,from,to);
    const record={id:++state.serial,from,to,at:Date.now(),who:'Maya',undone:false,lines:lines.map(l=>({...l,before:{...state.stock[l.id]}}))};
    for(const l of lines) {
      state.stock[l.id][from]-=l.qty; state.stock[l.id][to]+=l.qty;
      for(const place of [from,to]) state.revision[key(l.id,place)]=revision(l.id,place)+1;
    }
    state.history.unshift(record); persist(); return record;
  }
  function undo(recordId) {
    const record=state.history.find(r=>r.id===recordId);
    if(!record || record.undone) throw new Error('Perpindahan ini sudah dibatalkan.');
    if(record.lines.some(l=>state.stock[l.id][record.to]<l.qty)) throw new Error('Stok tujuan sudah berkurang. Periksa barang sebelum membatalkan.');
    for(const l of record.lines) {
      state.stock[l.id][record.to]-=l.qty; state.stock[l.id][record.from]+=l.qty;
      for(const place of [record.from,record.to]) state.revision[key(l.id,place)]=revision(l.id,place)+1;
    }
    record.undone=true; persist();
  }
  function observe(lines,place) {
    if(!places[place]||!lines.length) throw new Error('Isi hasil hitung terlebih dahulu.');
    const ids=new Set();
    for(const l of lines) {
      if(!product(l.id)||ids.has(l.id)||!Number.isInteger(l.qty)||l.qty<0||l.qty>9999||l.revision!==revision(l.id,place)) throw new Error('Stok berubah selama pengecekan. Tutup ringkasan, lalu hitung dan isi kembali barang yang ditandai.');
      ids.add(l.id);
    }
    const at=Date.now();
    const saved=lines.map(l=>({id:l.id,place,qty:l.qty,at,who:'Maya',revision:revision(l.id,place),expected:state.stock[l.id][place]}));
    for(const item of saved) state.observations[key(item.id,place)]=item;
    state.checks.unshift({at,place,lines:saved}); persist(); return saved;
  }
  globalThis.StockDemo={catalog,places,product,status,revision,move,undo,observe,
    get state(){return state},get storageAvailable(){return storageAvailable},
    reload(){state=read()}, reset(){state=fresh();persist()},key:KEY};
})();
