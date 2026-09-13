/* A local-only purchase-order draft composer. */
const PO_STORAGE = 'hub-prototype.purchase-order-drafts.v1';
let poStored = [];
try {
  const stored = JSON.parse(localStorage.getItem(PO_STORAGE) || '[]');
  if (Array.isArray(stored)) poStored = stored.filter(o => o && typeof o.id === 'string' && typeof o.no === 'string' && typeof o.supplier === 'string' && typeof o.expected === 'string' && Array.isArray(o.items) && Number.isFinite(o.value));
  // Only records from this prototype key are loaded, with text escaped at use.
  poStored.forEach(o => { if (!ORDERS.some(r => r.id === o.id)) ORDERS.unshift(o); });
} catch { /* An unavailable browser store does not prevent viewing the prototype. */ }
const PO_SUPPLIERS = [...new Set(ORDERS.map(o => o.supplier))].sort();
const PO_ARTICLES = ORDER_LINES.map(([name, sku]) => ({name, sku}));
let poDraft = null, poErrors = {}, poFocus = null;
/* ── payment terms ───────────────────────────────────────────────────────
   What the supplier is owed, and WHEN — the half of a purchase order this
   prototype had left out. A template is the usual arrangement with that
   supplier; the schedule under it is what this order actually promises, and it
   is editable because the usual arrangement is not always what was agreed on
   the phone.

   The portions are basis points of the order, so the amounts follow the total
   as lines are added. They have to come to 100%: a schedule that adds up to
   90% is a promise with a tenth of the money unaccounted for, and the form
   says so rather than quietly rounding. */
const PAYMENT_TEMPLATES = {
  "": [],
  "40% advance, 60% before dispatch": [
    { label: "Advance", days: 0, bps: 4000 },
    { label: "Before dispatch", days: 30, bps: 6000 },
  ],
  "50% advance, 50% on delivery": [
    { label: "Advance", days: 0, bps: 5000 },
    { label: "On delivery", days: 45, bps: 5000 },
  ],
  "Net 30": [{ label: "Net 30", days: 30, bps: 10000 }],
  "Cash on delivery": [{ label: "On delivery", days: 0, bps: 10000 }],
}

function freshPODraft() {
  return {supplier:'', destination:'DC Cikarang', expected:'', assignee:PEOPLE[0], notes:'', template:'', terms:[], lines:[{article:'',qty:1,price:0}]};
}

/// When a portion falls due, counted from the day the order is raised.
const termDue = (days) => {
  const at = new Date()
  at.setDate(at.getDate() + Number(days || 0))
  return at.toISOString().slice(0, 10)
}
const termsBps = () => (poDraft.terms ?? []).reduce((sum, t) => sum + (Number(t.bps) || 0), 0)
function openCreatePO() {
  poDraft ||= freshPODraft(); poErrors = {}; state.menu = null; state.filterDrawer = false;
  state.sheet = {table:'create',id:'new-po'}; render();
  document.getElementById('po-supplier')?.focus();
}
const poTotal = () => poDraft.lines.reduce((sum,l) => sum + (Number(l.qty)||0)*(Number(l.price)||0),0);
const poError = key => poErrors[key] ? `<span class="po-field-error" id="error-${key}">${escapeMarkup(poErrors[key])}</span>` : '';
const poInvalid = key => poErrors[key] ? `aria-invalid="true" aria-describedby="error-${key}"` : '';
function createPOSheet() {
  const d = poDraft;
  return {id:'Buying / Procurement',title:'Create purchase order',subtitle:'Start with a draft. Review it before issuing to your supplier.',
    body:`<form id="po-form" novalidate>
      ${poErrors.form ? `<div class="po-form-error" role="alert">${escapeMarkup(poErrors.form)}</div>` : ''}
      <section class="po-section"><div class="detail-section-head"><h4>Order information</h4><span>Required fields marked *</span></div>
        <div class="po-fields">
          <label>Supplier *<input id="po-supplier" aria-label="Supplier" required data-po-field="supplier" list="po-suppliers" placeholder="Search or select a supplier" value="${escapeMarkup(d.supplier)}" autocomplete="off" ${poInvalid('supplier')}><datalist id="po-suppliers">${PO_SUPPLIERS.map(v=>`<option value="${escapeMarkup(v)}">`).join('')}</datalist>${poError('supplier')}</label>
          <label>Expected delivery *<input id="po-expected" aria-label="Expected delivery" required type="date" data-po-field="expected" value="${escapeMarkup(d.expected)}" ${poInvalid('expected')}>${poError('expected')}</label>
          <label>Destination<select data-po-field="destination"><option>DC Cikarang</option></select></label>
          <label>Assigned to<select data-po-field="assignee">${PEOPLE.map(v=>`<option ${d.assignee===v?'selected':''}>${v}</option>`).join('')}</select></label>
        </div>
      </section>
      <section class="po-section"><div class="detail-section-head"><h4>Order lines</h4><span>Currency · IDR</span></div>
        <div class="po-lines">${d.lines.map((l,i)=>`<div class="po-line">
          <div class="po-line-head"><span>Item ${i+1}</span><button type="button" class="icon-btn" data-po-remove="${i}" aria-label="Remove item ${i+1}" ${d.lines.length===1?'disabled':''}>${icon('x','ico-xs')}</button></div>
          <label class="po-article">Article *<select aria-label="Article ${i+1}" required data-po-line="${i}" data-po-prop="article" ${poInvalid(`article-${i}`)}><option value="">Select article</option>${PO_ARTICLES.map((a,j)=>`<option value="${j}" ${String(l.article)===String(j)?'selected':''}>${escapeMarkup(a.name)} · ${a.sku}</option>`).join('')}</select>${poError(`article-${i}`)}</label>
          <div class="po-line-values"><label>Quantity *<input type="number" aria-label="Quantity ${i+1}" required min="1" step="1" data-po-line="${i}" data-po-prop="qty" value="${escapeMarkup(l.qty)}" ${poInvalid(`qty-${i}`)}>${poError(`qty-${i}`)}</label><label>Unit price (Rp) *<input type="number" aria-label="Unit price ${i+1}" required min="1" step="1" data-po-line="${i}" data-po-prop="price" value="${l.price || ''}" placeholder="0" ${poInvalid(`price-${i}`)}>${poError(`price-${i}`)}</label><div class="po-line-total"><span>Line total</span><strong data-po-line-total="${i}">${money((Number(l.qty)||0)*(Number(l.price)||0))}</strong></div></div>
        </div>`).join('')}</div>
        <button type="button" class="btn po-add" data-po-add="1">${icon('plus')} Add item</button>
      </section>
      <section class="po-section"><div class="detail-section-head"><h4>Payment terms</h4><span>${termsBps() === 10000 ? "Adds up to 100%" : `${(termsBps() / 100).toFixed(0)}% of 100% scheduled`}</span></div>
        <label class="po-terms-template">Template<select data-po-template>${Object.keys(PAYMENT_TEMPLATES).map((name) => `<option value="${escapeMarkup(name)}" ${d.template === name ? "selected" : ""}>${name === "" ? "No template — schedule it here" : name}</option>`).join("")}</select></label>
        ${(d.terms ?? []).length === 0 ? `<p class="po-terms-empty">Nothing scheduled. Pick a template, or add a row and say what is due when.</p>` : `
        <div class="detail-table-wrap"><table class="mini po-terms">
          <colgroup><col style="width:34px"><col><col style="width:112px"><col style="width:78px"><col style="width:104px"><col style="width:30px"></colgroup>
          <thead><tr><th>No</th><th>Payment term</th><th>Due date</th><th class="r">Portion</th><th class="r">Amount</th><th></th></tr></thead>
          <tbody>${(d.terms ?? []).map((t, i) => `<tr>
            <td>${i + 1}</td>
            <td><input data-po-term="${i}" data-po-termprop="label" value="${escapeMarkup(t.label)}" aria-label="Payment term ${i + 1}"></td>
            <td>${day(termDue(t.days))}</td>
            <td class="r"><input type="number" min="0" max="100" step="1" data-po-term="${i}" data-po-termprop="bps" value="${Math.round((Number(t.bps) || 0) / 100)}" aria-label="Portion ${i + 1}"><span class="po-pct">%</span></td>
            <td class="r" data-po-term-amount="${i}">${money(Math.round((poTotal() * (Number(t.bps) || 0)) / 10000))}</td>
            <td><button type="button" class="icon-btn" data-po-term-remove="${i}" aria-label="Remove payment term ${i + 1}">${icon("x", "ico-xs")}</button></td>
          </tr>`).join("")}</tbody>
        </table></div>`}
        <button type="button" class="btn po-add" data-po-term-add="1">${icon("plus")} Add a term</button>
      </section>
      <section class="po-section"><label class="po-note-label">Notes<textarea data-po-field="notes" rows="3" placeholder="Delivery instructions or notes for this order">${escapeMarkup(d.notes)}</textarea></label></section>
      <div class="po-summary"><div><span>Draft total</span><small data-po-units>${d.lines.length} items · ${count(d.lines.reduce((n,l)=>n+(Number(l.qty)||0),0))} pcs</small></div><strong data-po-total>${money(poTotal())}</strong></div>
      <p class="po-save-note">Saved in this browser as a draft. Nothing is sent to the supplier.</p>
    </form>`,
    foot:`<button class="btn" type="button" data-sheet-close="1">Cancel</button><button class="btn btn-primary" type="submit" form="po-form">${icon('save')} Save draft</button>`};
}
function restorePOFocus() {
  if (!poFocus) return;
  const el = document.querySelector(poFocus); poFocus = null; el?.focus();
}
function updatePOSummary() {
  document.querySelectorAll('[data-po-line-total]').forEach(el => {const l=poDraft.lines[Number(el.dataset.poLineTotal)];el.textContent=money((Number(l.qty)||0)*(Number(l.price)||0));});
  const total = document.querySelector('[data-po-total]'); if(total)total.textContent=money(poTotal());
  document.querySelectorAll('[data-po-term-amount]').forEach((el) => {
    const t = poDraft.terms[Number(el.dataset.poTermAmount)]
    el.textContent = money(Math.round((poTotal() * (Number(t.bps) || 0)) / 10000))
  })
  const units=document.querySelector('[data-po-units]');if(units)units.textContent=`${poDraft.lines.length} items · ${count(poDraft.lines.reduce((n,l)=>n+(Number(l.qty)||0),0))} pcs`;
}
function capturePOInput(e) {
  if (!poDraft || !e.target.closest('#po-form')) return;
  const el=e.target;
  if (el.dataset.poTemplate !== undefined) {
    poDraft.template = el.value
    poDraft.terms = PAYMENT_TEMPLATES[el.value].map((t) => ({ ...t }))
    poErrors = {}; render(); return
  }
  if (el.dataset.poTerm !== undefined) {
    const term = poDraft.terms[Number(el.dataset.poTerm)]
    if (el.dataset.poTermprop === 'bps') term.bps = Math.round(Number(el.value || 0) * 100)
    else term.label = el.value
    // The template no longer describes this schedule once it is edited.
    poDraft.template = ''
    updatePOSummary(); return
  }
  if(el.dataset.poField) poDraft[el.dataset.poField]=el.value;
  if(el.dataset.poProp) poDraft.lines[Number(el.dataset.poLine)][el.dataset.poProp]=el.value;
  updatePOSummary();
}
document.addEventListener('input',capturePOInput);
document.addEventListener('change',capturePOInput);
document.addEventListener('click',e=>{
  const termAdd=e.target.closest('[data-po-term-add]'), termRemove=e.target.closest('[data-po-term-remove]');
  if (termAdd || termRemove) {
    e.preventDefault(); e.stopImmediatePropagation();
    if (termAdd) (poDraft.terms ??= []).push({ label: 'On delivery', days: 30, bps: Math.max(0, 10000 - termsBps()) })
    else poDraft.terms.splice(Number(termRemove.dataset.poTermRemove), 1)
    poDraft.template = ''; render(); return
  }
  const add=e.target.closest('[data-po-add]'), remove=e.target.closest('[data-po-remove]');
  if(!add&&!remove)return;
  e.preventDefault();e.stopImmediatePropagation();
  if(add){poDraft.lines.push({article:'',qty:1,price:0});poFocus=`[data-po-line="${poDraft.lines.length-1}"][data-po-prop="article"]`;}
  else if(poDraft.lines.length>1){poDraft.lines.splice(Number(remove.dataset.poRemove),1);poFocus='[data-po-add]';}
  poErrors={};render();
},true);
document.addEventListener('submit',e=>{
  if(e.target.id!=='po-form')return;
  e.preventDefault();poErrors={};const d=poDraft;
  if(!PO_SUPPLIERS.includes(d.supplier))poErrors.supplier='Select a supplier from the list.';
  if(!/^\d{4}-\d{2}-\d{2}$/.test(d.expected)||!Number.isFinite(Date.parse(d.expected)))poErrors.expected='Choose an expected delivery date.';
  d.lines.forEach((l,i)=>{
    if(l.article===''||!PO_ARTICLES[Number(l.article)])poErrors[`article-${i}`]='Select an article.';
    if(!Number.isSafeInteger(Number(l.qty))||Number(l.qty)<1)poErrors[`qty-${i}`]='Enter a whole quantity of at least 1.';
    if(!Number.isSafeInteger(Number(l.price))||Number(l.price)<1)poErrors[`price-${i}`]='Enter a unit price of at least Rp 1.';
  });
  if(!Number.isSafeInteger(poTotal())||poTotal()<1)poErrors.form='Check the quantities and unit prices.';
  if((d.terms ?? []).length>0&&termsBps()!==10000)poErrors.form=`The payment schedule comes to ${(termsBps()/100).toFixed(0)}%, not 100%.`;
  if(Object.keys(poErrors).length){render();document.querySelector('#po-form [aria-invalid="true"]')?.focus();return;}
  const now=new Date(),stamp=String(now.getTime());
  const record={id:`local-${stamp}`,no:`PO-DRAFT-${stamp.slice(-8)}`,supplier:d.supplier,issued:null,expected:d.expected,lines:d.lines.length,ordered:d.lines.reduce((n,l)=>n+Number(l.qty),0),received:0,value:poTotal(),status:'draft',dest:d.destination,assignee:d.assignee,creator:'Hari',notes:d.notes,items:d.lines.map(l=>{const a=PO_ARTICLES[Number(l.article)];return[a.name,a.sku,Number(l.qty),0,Number(l.price)];})};
  try{localStorage.setItem(PO_STORAGE,JSON.stringify([...poStored,record]));}
  catch{poErrors.form='This browser could not save the draft. Your entries are still here; try again.';render();return;}
  poStored.push(record);ORDERS.unshift(record);poDraft=null;poErrors={};
  state.quick.orders={};state.facet.orders={};state.picked.orders.clear();state.sheet={table:'orders',id:record.id};render();toast('Draft saved in this browser');
});
document.addEventListener('keydown',e=>{
  if(e.key==='ArrowDown'&&e.target.matches('[data-facet-search]')){e.preventDefault();e.target.closest('.menu').querySelector('.facet-options button:not([hidden])')?.focus();}
});
