const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync('js/pagamento.js','utf8');
function page(cart, preview, opts = {}) {
  const elements = new Map();
  class Element { constructor(){this.hidden=false;this.open=false;this.children=[];this.textContent='';this.listeners={}} appendChild(child){this.children.push(child)} replaceChildren(...children){this.children=children} addEventListener(type, listener){this.listeners[type]=listener} showModal(){this.open=true} close(){this.open=false} }
  const document={readyState:'complete',getElementById(id){if(!elements.has(id)) elements.set(id,new Element());return elements.get(id)},createElement(){return new Element()}};
  const window={localStorage:{getItem:()=>JSON.stringify(cart)},sessionStorage:{getItem:()=>JSON.stringify(preview)},navigator:{clipboard:{writeText:async()=>{}}},setInterval:()=>0, PIX_API_BASE_URL: opts.api, fetch: opts.fetch, qrcode:opts.qrcode};
  vm.runInNewContext(source,{window,document,Intl,Date,URL}); return id=>document.getElementById(id);
}
test('payment base displays selected items, their total and the supplied address',()=>{
  const cart=[{id:1,name:'Costelinha',quantity:1,price:22.99},{id:'checkout-mini-pudim',name:'Mini Pudim',quantity:1,price:5}];
  const preview={address:{street:'Estrada Mato Grosso',number:'3223',neighborhood:'Lagoinha',city:'Nova Iguaçu',state:'RJ'},customer:{name:'Laura Silva'},cart:{items:cart.map(x=>({...x,total:x.price})),total:27.99},createdAt:Date.now()};
  const el=page(cart,preview); assert.equal(el('payment-content').hidden,false); assert.equal(el('delivery-street').textContent,'Estrada Mato Grosso, 3223'); assert.equal(el('delivery-city').textContent,'Lagoinha · Nova Iguaçu/RJ'); assert.equal(el('receipt-items').children.length,2); assert.match(el('receipt-total').textContent,/27,99/);
  const map = new URL(el('delivery-map').src); assert.equal(map.hostname,'maps.google.com'); assert.equal(map.searchParams.get('q'),'Estrada Mato Grosso, 3223, Lagoinha, Nova Iguaçu, RJ, Brasil');
  el('delivery-track-open').listeners.click(); assert.equal(el('delivery-dialog').open,true); assert.equal(el('delivery-dialog-map').src,el('delivery-map').src); el('delivery-dialog-close').listeners.click(); assert.equal(el('delivery-dialog').open,false);
  const changed=page([{...cart[0],quantity:2}],preview); assert.equal(changed('payment-content').hidden,true); assert.equal(changed('payment-error').hidden,false);
  const missing=page(null,null); assert.equal(missing('payment-error').hidden,false);
});
test('generates a QR locally if the provider returns only the copy-and-paste code',()=>{
  const qrContext=vm.createContext({});
  vm.runInContext(fs.readFileSync('js/qrcode-generator.js','utf8'),qrContext);
  vm.runInContext(fs.readFileSync('js/qrcode-utf8.js','utf8'),qrContext);
  const cart=[{id:1,name:'Prato',quantity:1,price:20,total:20}];
  const preview={address:{street:'Rua A',number:'10',city:'São Paulo',state:'SP'},customer:{name:'Maria Silva'},cart:{items:cart,total:20},pix:{status:'PENDING',amount:2000,paymentData:{copyPaste:'000201010212PIX',qrCodeBase64:null,expiresAt:null}}};
  const el=page(cart,preview,{qrcode:qrContext.qrcode});
  assert.equal(el('pix-qr').hidden,false); assert.match(el('pix-qr').src,/^data:image\/gif;base64,/); assert.equal(el('pix-code').textContent,'000201010212PIX');
});
test('an expired PIX is shown as expired and cannot be copied',()=>{
  const cart=[{id:1,name:'Prato',quantity:1,price:20,total:20}];
  const preview={address:{street:'Rua A',number:'10',city:'São Paulo',state:'SP'},customer:{name:'Maria Silva'},cart:{items:cart,total:20},pix:{status:'PENDING',amount:2000,paymentData:{copyPaste:'000201pix',expiresAt:'2020-01-01T00:00:00Z'}}};
  const el=page(cart,preview); assert.equal(el('payment-status').textContent,'PIX expirado'); assert.equal(el('pix-copy').disabled,true);
});
test('five-minute display counts from the saved checkout without changing PIX validity',()=>{
  const cart=[{id:1,name:'Prato',quantity:1,price:20,total:20}];
  const preview={address:{street:'Rua A',number:'10',city:'São Paulo',state:'SP'},customer:{name:'Maria Silva'},cart:{items:cart,total:20},pix:{status:'PENDING',amount:2000,paymentData:{copyPaste:'000201pix',expiresAt:'2099-01-01T00:00:00Z'}},createdAt:Date.now()-30000};
  const active=page(cart,preview); assert.match(active('pix-expiration').textContent,/^04:(29|30)$/); assert.equal(active('payment-status').textContent,'Aguardando pagamento');
  preview.createdAt=Date.now()-301000; const elapsed=page(cart,preview); assert.equal(elapsed('pix-expiration').textContent,'00:00'); assert.equal(elapsed('payment-status').textContent,'Aguardando pagamento'); assert.equal(elapsed('pix-copy').disabled,false);
});
test('payment page accepts a valid order over R$ 98',()=>{
  const cart=[{id:1,name:'Prato',quantity:5,price:22.99,total:114.95}];
  const preview={address:{street:'Rua A',number:'10',city:'São Paulo',state:'SP'},customer:{name:'Maria Silva'},cart:{items:cart,total:114.95},pix:{status:'PENDING',amount:11495,paymentData:{copyPaste:'000201pix'}}};
  const el=page(cart,preview); assert.equal(el('payment-content').hidden,false); assert.match(el('payment-total').textContent,/114,95/); assert.equal(el('pix-copy').disabled,false);
});
test('payment is marked paid only after authenticated backend status matches the amount',async()=>{
  const cart=[{id:1,name:'Prato',quantity:1,price:20,total:20}];
  const preview={address:{street:'Rua A',number:'10',city:'São Paulo',state:'SP'},customer:{name:'Maria Silva'},cart:{items:cart,total:20},pix:{requestId:'123e4567-e89b-42d3-a456-426614174000',status:'PENDING',amount:2000,paymentData:{copyPaste:'000201-PIX',qrCodeBase64:'data:image/png;base64,YQ==',expiresAt:'2099-01-01T00:00:00Z'}}};
  let received;
  const el=page(cart,preview,{api:'https://payments.example.test',fetch:async (url,options)=>{received={url,body:JSON.parse(options.body)};return {ok:true,json:async()=>({status:'PAID',amount:2000})}}});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(received.url,'https://payments.example.test/api/pix/status'); assert.equal(received.body.requestId,preview.pix.requestId); assert.equal(el('payment-status').textContent,'Pagamento confirmado'); assert.equal(el('pix-copy').disabled,true); assert.match(el('delivery-dialog-status-text').textContent,/confirmado/); assert.match(el('delivery-event-second').textContent,/não disponível/);
});
test('a valid pending PIX shows its code and image, even when the cart changes',()=>{
  const original=[{id:1,name:'Prato',quantity:1,price:20,total:20}];
  const preview={address:{street:'Rua A',number:'10',city:'São Paulo',state:'SP'},customer:{name:'Maria Silva'},cart:{items:original,total:20},pix:{status:'PENDING',amount:2000,paymentData:{copyPaste:'000201-PIX',qrCodeBase64:'data:image/png;base64,YQ==',expiresAt:'2099-01-01T00:00:00Z'}},createdAt:Date.now()};
  const el=page([],preview); assert.equal(el('payment-content').hidden,false); assert.equal(el('pix-code').textContent,'000201-PIX'); assert.equal(el('pix-qr').hidden,false); assert.equal(el('pix-copy').disabled,false); assert.equal(el('payment-status').textContent,'Aguardando pagamento');
  preview.pix.amount=1900; const mismatch=page([],preview); assert.notEqual(mismatch('pix-copy').disabled,false);
});
