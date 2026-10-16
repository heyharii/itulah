export const locations = ['warehouse', 'floor'];
export const locationNames = { warehouse: 'Gudang', floor: 'Floor' };
const checked = (count, system, scope = 'Seluruh area', time = '14:23', complete = true) => ({ count, system, scope, time, complete });
export function seed() {
  return [
    { id: 'tee', name: 'Basic Tee', variant: 'Black / M', sku: 'BT-BLK-M', tint: 'black', system: { warehouse: 24, floor: 9 }, observed: { warehouse: checked(22, 24), floor: checked(9, 9) } },
    { id: 'jeans', name: 'Slim Jeans', variant: 'Blue / 32', sku: 'SJ-BLU-32', tint: 'blue', system: { warehouse: 14, floor: 4 }, observed: { warehouse: checked(12, 12), floor: checked(6, 6) } },
    { id: 'hoodie', name: 'Hoodie', variant: 'Grey / L', sku: 'HD-GRY-L', tint: 'grey', system: { warehouse: 9, floor: 5 }, observed: { warehouse: checked(9, 9), floor: checked(5, 5) } },
    { id: 'oxford', name: 'Oxford Shirt', variant: 'White / L', sku: 'OX-WHT-L', tint: 'white', system: { warehouse: 8, floor: 2 }, observed: { warehouse: null, floor: null } },
    { id: 'linen', name: 'Linen Shirt', variant: 'Olive / M', sku: 'LN-OLV-M', tint: 'olive', system: { warehouse: 0, floor: 0 }, observed: { warehouse: checked(0, 0), floor: checked(0, 0) } },
    { id: 'cargo', name: 'Cargo Pants', variant: 'Sand / L', sku: 'CG-SND-L', tint: 'sand', system: { warehouse: 10, floor: 3 }, observed: { warehouse: checked(4, 10, 'Rak B saja', '14:10', false), floor: null } },
  ].map(product => ({ ...product, changedLocations: product.id === 'jeans' ? [...locations] : [] }));
}
export function value(product, location, mode) {
  return mode === 'system' ? product.system[location] : product.observed[location]?.count ?? null;
}
export function total(product, mode) {
  const values = locations.map(location => value(product, location, mode));
  return values.some(n => n === null) ? null : values.reduce((a, b) => a + b, 0);
}
export function status(product) {
  const observations = locations.map(location => product.observed[location]);
  if (observations.every(observation => !observation)) return 'unchecked';
  if (locations.some(location => product.observed[location] && changedAt(product, location))) return 'changed';
  if (observations.some(observation => !observation || !observation.complete)) return 'partial';
  if (observations.some(observation => observation.count !== observation.system)) return 'difference';
  return 'match';
}
export function changedAt(product, location) {
  return product.changedLocations.includes(location) || (product.observed[location] && product.system[location] !== product.observed[location].system);
}
export const statuses = {
  difference: { label: 'Berbeda saat dicek', short: 'Berbeda', icon: '!', tone: 'amber' },
  changed: { label: 'Berubah sejak dicek', short: 'Ada perpindahan', icon: '↻', tone: 'blue' },
  match: { label: 'Sesuai saat dicek', short: 'Sesuai', icon: '✓', tone: 'green' },
  unchecked: { label: 'Belum dicek', short: 'Belum dicek', icon: '—', tone: 'muted' },
  partial: { label: 'Pengecekan sebagian', short: 'Sebagian dicek', icon: '◐', tone: 'muted' },
};
export function transfer(products, quantities, from, to) {
  if (!locations.includes(from) || !locations.includes(to) || from === to) throw new Error('Pilih dua lokasi berbeda.');
  const entries = Object.entries(quantities);
  if (!entries.length || !entries.some(([, n]) => n > 0)) throw new Error('Isi jumlah barang yang dipindahkan.');
  for (const [id, quantity] of entries) {
    const product = products.find(product => product.id === id);
    if (!product || !Number.isInteger(quantity) || quantity < 0) throw new Error('Jumlah harus bilangan bulat, minimal 0.');
    if (quantity > product.system[from]) throw new Error(`Jumlah ${product.name} melebihi stok Sistem di ${locationNames[from]}.`);
  }
  for (const [id, quantity] of entries) {
    const product = products.find(product => product.id === id);
    product.system[from] -= quantity;
    product.system[to] += quantity;
    if (quantity > 0) product.changedLocations = [...new Set([...product.changedLocations, from, to])];
  }
  return entries.reduce((sum, [, n]) => sum + n, 0);
}
