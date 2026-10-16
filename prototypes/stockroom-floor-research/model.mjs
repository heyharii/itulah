export const places = { warehouse: 'Stockroom', floor: 'Shop floor', reject: 'Return stock' };
export const products = [
  { sku: '24010001102', name: 'Oxford stripe shirt', colour: 'Blue stripe', size: 'M', kind: 'shirt', tone: 'blue', back: 8, floor: 2, reject: 0 },
  { sku: '24010001103', name: 'Oxford stripe shirt', colour: 'Blue stripe', size: 'L', kind: 'shirt', tone: 'blue', back: 5, floor: 1, reject: 0 },
  { sku: '24010002103', name: 'Essential cotton tee', colour: 'Off white', size: 'L', kind: 'tee', tone: 'cream', back: 6, floor: 2, reject: 0 },
  { sku: '24010003202', name: 'Everyday chino', colour: 'Sand', size: 'M', kind: 'pants', tone: 'sand', back: 4, floor: 3, reject: 0 },
  { sku: '24010004302', name: 'Linen camp shirt', colour: 'Olive', size: 'M', kind: 'shirt', tone: 'olive', back: 2, floor: 0, reject: 2 },
];
export function createState() {
  return { version: 2, stock: products.map(p=>({sku:p.sku,warehouse:p.back,floor:p.floor,reject:p.reject})), from:'warehouse', to:'floor', queue:[], history:[], online:true, failNext:false, sequence:0, note:'', session:1 };
}
export function balances(state, sku) {
  const result = {warehouse:0,floor:0,reject:0};
  for(const row of state.stock) if(!sku || row.sku === sku) for(const place of Object.keys(places)) result[place] += row[place];
  return result;
}
export function totalStock(state) {return Object.values(balances(state)).reduce((sum,q)=>sum+q,0);}
export function totalQuantity(rows) {return rows.reduce((sum,row)=>sum+row.quantity,0);}
export function grouped(rows) {return rows.map(row=>({...products.find(p=>p.sku===row.sku),...row}));}
export function setRoute(state, from, to) {
  if(state.queue.length) return {ok:false,message:'Selesaikan atau kosongkan pilihan sebelum mengganti arah.'};
  if(!places[from] || !places[to] || from === to) return {ok:false,message:'Lokasi asal dan tujuan harus berbeda.'};
  state.from=from;state.to=to;return {ok:true};
}
export function setQuantity(state, sku, raw) {
  const quantity = raw === '' ? 0 : Number(raw);
  const stock=state.stock.find(row=>row.sku===sku);
  if(!stock) return {ok:false,message:'Varian tidak ditemukan.'};
  if(!Number.isSafeInteger(quantity) || quantity<0) return {ok:false,message:'Isi jumlah bulat, minimal 0.'};
  if(quantity>stock[state.from]) return {ok:false,message:`Maksimal ${stock[state.from]} potong di ${places[state.from]}.`};
  const existing=state.queue.find(row=>row.sku===sku);
  if(quantity === 0) state.queue=state.queue.filter(row=>row.sku!==sku);
  else if(!existing || existing.quantity !== quantity) {
    state.sequence++;
    const line={sku,quantity,key:`quantity-${state.session}-${state.sequence}`,status:'ready',error:''};
    if(existing) state.queue=state.queue.map(row=>row.sku===sku?line:row);else state.queue.push(line);
  }
  return {ok:true};
}
export function commit(state, at=new Date().toISOString()) {
  const requested=totalQuantity(state.queue);
  if(!state.online) return {ok:false,success:0,failed:requested,message:'Server toko tidak tersambung. Pilihan tersimpan; saldo belum berubah.'};
  if(!requested) return {ok:false,success:0,failed:0,message:'Isi jumlah minimal satu varian sebelum memindahkan.'};
  if(state.from === state.to) return {ok:false,success:0,failed:requested,message:'Lokasi asal dan tujuan harus berbeda.'};
  const movement={id:`MV-${String(state.history.length+1).padStart(4,'0')}`,at,from:state.from,to:state.to,rows:[],note:state.note,actor:'Maya · contoh',mode:'quantity'};
  const remaining=[];
  let forcedFailure=state.failNext;
  for(const line of state.queue) {
    if(state.history.some(event=>event.rows.some(row=>row.key===line.key))) continue;
    const stock=state.stock.find(row=>row.sku===line.sku);
    let error=!stock?'Varian tidak ditemukan.':!Number.isSafeInteger(line.quantity)||line.quantity<=0?'Jumlah tidak valid.':stock[state.from]<line.quantity?`Stok berubah: tersedia ${stock[state.from]} potong di ${places[state.from]}. Kurangi jumlah atau keluarkan varian.`:'';
    if(!error && forcedFailure){error='Varian ini ditolak server (simulasi). Coba ulang jumlah yang belum dipindahkan.';forcedFailure=false;}
    if(error) remaining.push({...line,status:'failed',error});
    else {stock[state.from]-=line.quantity;stock[state.to]+=line.quantity;movement.rows.push({...line,status:'done',error:''});}
  }
  state.failNext=false;
  if(movement.rows.length) state.history.unshift(movement);
  state.queue=remaining;
  if(!remaining.length){state.note='';state.session++;}
  const success=totalQuantity(movement.rows);const failed=totalQuantity(remaining);
  return {ok:!remaining.length,success,failed,message:remaining.length?`${success} potong berhasil dipindahkan; ${failed} potong dari ${remaining.length} varian belum pindah. Hanya jumlah yang gagal tersisa dalam pilihan.`:`${success} potong berhasil dipindahkan ke ${places[state.to]}.`};
}
