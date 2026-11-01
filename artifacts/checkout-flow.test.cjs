const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync('js/checkout.js', 'utf8');
function setup(fetch, config = {}) {
  const ids = new Map(); const handlers = {};
  class Element { constructor(){ this.value=''; this.hidden=false; this.open=false; this.listeners={}; this.children=[]; } addEventListener(type,fn){this.listeners[type]=fn} setAttribute(k,v){this[k]=v} replaceChildren(...v){this.children=v} appendChild(v){this.children.push(v)} click(){return this.listeners.click?.()} focus(){} showModal(){this.open=true} close(){this.open=false} }
  const document={readyState:'complete',getElementById(id){if(!ids.has(id))ids.set(id,new Element());return ids.get(id)},createElement(){return new Element()}};
  const cart={items:[{name:'Prato',quantity:1,total:22.99}],subtotal:22.99,total:22.99,shipping:0};
  const events=[]; const storage = new Map(), timers = new Map(); let timerId=0;
  const window={fetch,PIX_API_BASE_URL:'',crypto:{randomUUID(){return '123e4567-e89b-42d3-a456-426614174000'}},sessionStorage:{setItem(key,value){storage.set(key,value)},getItem(key){return storage.get(key) ?? null},removeItem(key){storage.delete(key)}},location:{assign(url){this.url=url}},CartReview:{getCheckoutSnapshot:()=>cart},setTimeout(fn,ms){const id=++timerId;timers.set(id,{fn,ms});return id},clearTimeout(id){timers.delete(id)},addEventListener(type,fn){handlers[type]=fn},dispatchEvent(e){events.push(e)}};
  class CustomEvent{constructor(type,options){this.type=type;this.detail=options.detail}}
  window.CHECKOUT_CAMPOS = config;
  vm.runInNewContext(source,{window,document,Intl,CustomEvent,URL});
  const el=id=>document.getElementById(id);
  return {el,handlers,cart,events,window,storage,timers};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('opens with actual cart and fills address for a valid CEP',async()=>{
  const app=setup(async()=>({ok:true,json:async()=>({logradouro:'Praça da Sé',bairro:'Sé',localidade:'São Paulo',uf:'SP'})}));
  app.handlers['checkout:requested']({detail:app.cart,preventDefault(){}});
  assert.equal(app.el('checkout-dialog').open,true); assert.equal(app.el('checkout-count').textContent,'1 item');
  app.el('checkout-cep').value='01001000'; app.el('checkout-cep').listeners.input({target:app.el('checkout-cep')}); await tick();
  assert.equal(app.el('checkout-cep').value,'01001-000'); assert.equal(app.el('checkout-street').value,'Praça da Sé'); assert.equal(app.el('checkout-city').value,'São Paulo');
  app.el('checkout-number').value='123'; app.el('checkout-address-form').listeners.submit({preventDefault(){}});
  assert.equal(app.events[0].detail.address.number,'123'); assert.equal(app.events[0].detail.address.state,'SP');
});
test('unknown CEP and network errors block continuation and permit retry',async()=>{
  const app=setup(async()=>({ok:true,json:async()=>({erro:true})})); app.el('checkout-cep').value='99999999'; app.el('checkout-cep').listeners.input({target:app.el('checkout-cep')}); await tick();
  assert.match(app.el('checkout-cep-status').textContent,/não encontrado/); app.el('checkout-address-form').listeners.submit({preventDefault(){}}); assert.equal(app.events.length,0);
  const offline=setup(async()=>{throw Error('offline')}); offline.el('checkout-cep').value='01001000'; offline.el('checkout-cep').listeners.input({target:offline.el('checkout-cep')}); await tick(); assert.equal(offline.el('checkout-cep-retry').hidden,false);
});
test('customer step validates details, toggles CPF and returns to the preserved address',async()=>{
  const app=setup(async()=>({ok:true,json:async()=>({logradouro:'Praça da Sé',bairro:'Sé',localidade:'São Paulo',uf:'SP'})}));
  app.handlers['checkout:requested']({detail:app.cart,preventDefault(){}});
  app.el('checkout-cep').value='01001000'; app.el('checkout-cep').listeners.input({target:app.el('checkout-cep')}); await tick();
  app.el('checkout-number').value='123'; app.el('checkout-address-form').listeners.submit({preventDefault(){}});
  assert.equal(app.el('checkout-data-step').hidden,false); assert.equal(app.el('checkout-address-step').hidden,true);
  app.el('checkout-data-form').listeners.submit({preventDefault(){}}); assert.match(app.el('checkout-data-status').textContent,/obrigatórios/);
  app.el('checkout-name').value='Maria Silva'; app.el('checkout-phone').value='11987654321'; app.el('checkout-phone').listeners.input({target:app.el('checkout-phone')});
  assert.equal(app.el('checkout-phone').value,'(11) 98765-4321'); app.el('checkout-email').value='maria@example.com';
  app.el('checkout-cpf-yes').checked=true;
  app.el('checkout-cpf').value='123'; app.el('checkout-data-form').listeners.submit({preventDefault(){}}); assert.equal(app.events.length,1);
  app.el('checkout-cpf').value='52998224725'; app.el('checkout-cpf').listeners.input({target:app.el('checkout-cpf')});
  assert.equal(app.el('checkout-cpf').value,'529.982.247-25'); app.el('checkout-notes').value='Portão azul'; app.el('checkout-data-form').listeners.submit({preventDefault(){}});
  assert.equal(app.events[1].type,'checkout:customer-ready'); assert.equal(app.events[1].detail.customer.name,'Maria Silva'); assert.equal(app.events[1].detail.customer.cpf,'52998224725');
  assert.equal(app.el('checkout-upsell-step').hidden,false); assert.equal(app.el('checkout-main-content').hidden,true);
  app.el('checkout-upsell-skip').listeners.click();
  assert.equal(app.el('checkout-payment-step').hidden,false); assert.equal(app.el('checkout-data-step').hidden,true);
  assert.equal(app.el('checkout-step-address').className,'checkout-step is-complete'); assert.equal(app.el('checkout-step-data').className,'checkout-step is-complete'); assert.equal(app.el('checkout-step-payment').className,'checkout-step is-current');
  await app.el('checkout-generate-pix').listeners.click(); assert.match(app.el('checkout-payment-status').textContent,/não está configurado/); assert.equal(app.window.location.url,undefined);
  app.el('checkout-payment-back').listeners.click(); assert.equal(app.el('checkout-data-step').hidden,false); assert.equal(app.el('checkout-name').value,'Maria Silva');
  app.el('checkout-data-back').listeners.click(); assert.equal(app.el('checkout-address-step').hidden,false); assert.equal(app.el('checkout-number').value,'123'); assert.equal(app.el('checkout-name').value,'Maria Silva');
});
async function readyForPix(app) {
  app.handlers['checkout:requested']({detail:app.cart,preventDefault(){}});
  app.el('checkout-cep').value='01001000'; app.el('checkout-cep').listeners.input({target:app.el('checkout-cep')}); await tick();
  app.el('checkout-number').value='123'; app.el('checkout-address-form').listeners.submit({preventDefault(){}});
  app.el('checkout-name').value='Maria Silva'; app.el('checkout-phone').value='11987654321'; app.el('checkout-email').value='maria@example.com'; app.el('checkout-cpf-yes').checked=true; app.el('checkout-cpf').value='52998224725';
  app.el('checkout-data-form').listeners.submit({preventDefault(){}}); app.el('checkout-upsell-skip').listeners.click();
}
test('new sessions retain only the customer handoff needed by TMT in sessionStorage with the same expiry',async()=>{
  const expiresAt=Date.now()+86400000, requestId='123e4567-e89b-42d3-a456-426614174000';
  const app=setup(async(url,options)=>!options ? {ok:true,json:async()=>({logradouro:'Praça da Sé',bairro:'Sé',localidade:'São Paulo',uf:'SP'})} : {ok:true,json:async()=>({transactionId:'TXN-1',status:'PENDING',amount:2299,sessionToken:requestId+'.'+'a'.repeat(64),sessionExpiresAt:expiresAt,paymentData:{copyPaste:'000201pix',expiresAt:null}})});
  await readyForPix(app);app.window.PIX_API_BASE_URL='https://pix.example.com';await app.el('checkout-generate-pix').listeners.click();
  const cached=JSON.parse(app.storage.get('tmt_customer:'+requestId));assert.equal(cached.expiresAt,expiresAt);assert.deepEqual(cached.customer,{name:'Maria Silva',email:'maria@example.com',phone:'11987654321',cpf:'52998224725'});assert.equal(cached.address,undefined);assert.equal(app.window.location.url,'/pagamento.html');
});
test('creates a PIX through configured backend and stores only display data',async()=>{
  const calls=[]; const app=setup(async(url,options)=>{
    if (!options) return {ok:true,json:async()=>({logradouro:'Praça da Sé',bairro:'Sé',localidade:'São Paulo',uf:'SP'})};
    calls.push({url,options}); return {ok:true,json:async()=>({transactionId:'TXN-1',status:'PENDING',amount:2299,paymentData:{copyPaste:'000201pix',qrCodeBase64:'data:image/png;base64,YWJj',expiresAt:new Date(Date.now()+60000).toISOString()}})};
  });
  app.cart.items[0].observation='Proteínas: Frango Assado Especial | Sem cebola';
  await readyForPix(app); app.window.PIX_API_BASE_URL='https://pix.example.com'; await app.el('checkout-generate-pix').listeners.click();
  const payload=JSON.parse(calls[0].options.body); assert.equal(calls[0].url,'https://pix.example.com/api/pix'); assert.equal(payload.items[0].name,'Prato'); assert.equal(payload.items[0].observation,'Proteínas: Frango Assado Especial | Sem cebola'); assert.equal(payload.customer.cpf,'52998224725'); assert.equal(payload.customer.cpfOnReceipt,true); assert.equal(payload.address.neighborhood,'Sé');
  assert.equal(app.window.location.url,'/pagamento.html'); const preview=JSON.parse(app.storage.get('checkout_payment_preview')); assert.equal(preview.customer.name,'Maria Silva'); assert.equal(preview.customer.cpf,undefined); assert.equal(preview.customer.email,undefined); assert.equal(preview.pix.requestId,payload.requestId); assert.equal(preview.pix.amount,2299); assert.equal(preview.pix.paymentData.copyPaste,'000201pix');
  app.window.location.url=undefined; await app.el('checkout-generate-pix').listeners.click(); assert.equal(app.window.location.url,'/pagamento.html'); assert.equal(calls.length,1);
});
test('a later checkout can generate a new PIX in the same session',async()=>{
  const calls=[]; let sequence=0;
  const app=setup(async(url,options)=>{
    if (!options) return {ok:true,json:async()=>({logradouro:'Praça da Sé',bairro:'Sé',localidade:'São Paulo',uf:'SP'})};
    const body=JSON.parse(options.body); calls.push(body);
    return {ok:true,status:201,json:async()=>({transactionId:'TXN-'+calls.length,status:'PENDING',amount:2299,paymentData:{copyPaste:'000201pix',qrCodeBase64:null,expiresAt:null}})};
  });
  app.window.crypto.randomUUID=()=> sequence++ ? '123e4567-e89b-42d3-a456-426614174001' : '123e4567-e89b-42d3-a456-426614174000';
  await readyForPix(app); app.window.PIX_API_BASE_URL='https://pix.example.com'; await app.el('checkout-generate-pix').listeners.click();
  await readyForPix(app); await app.el('checkout-generate-pix').listeners.click();
  assert.equal(calls.length,2); assert.notEqual(calls[0].requestId,calls[1].requestId);
});
test('concurrent clicks cannot create duplicate PIX requests',async()=>{
  let calls=0, finish;
  const app=setup(async(url,options)=>{
    if (!options) return {ok:true,json:async()=>({logradouro:'Praça da Sé',bairro:'Sé',localidade:'São Paulo',uf:'SP'})};
    calls++; await new Promise(resolve=>{finish=resolve});
    return {ok:true,status:201,json:async()=>({transactionId:'TXN-1',status:'PENDING',amount:2299,paymentData:{copyPaste:'000201pix',qrCodeBase64:null,expiresAt:null}})};
  });
  await readyForPix(app); app.window.PIX_API_BASE_URL='https://pix.example.com';
  const first=app.el('checkout-generate-pix').listeners.click(); const second=app.el('checkout-generate-pix').listeners.click();
  assert.equal(calls,1); finish(); await Promise.all([first,second]); assert.equal(calls,1);
});
test('a changed cart can start a new request after an unresolved attempt',async()=>{
  let calls=0, sequence=0;
  const app=setup(async(url,options)=>{
    if (!options) return {ok:true,json:async()=>({logradouro:'Praça da Sé',bairro:'Sé',localidade:'São Paulo',uf:'SP'})};
    calls++; if(calls===1) throw Error('offline');
    return {ok:true,status:201,json:async()=>({transactionId:'TXN-2',status:'PENDING',amount:4598,paymentData:{copyPaste:'000201pix',qrCodeBase64:null,expiresAt:null}})};
  });
  app.window.crypto.randomUUID=()=> sequence++ ? '123e4567-e89b-42d3-a456-426614174001' : '123e4567-e89b-42d3-a456-426614174000';
  await readyForPix(app); app.window.PIX_API_BASE_URL='https://pix.example.com'; await app.el('checkout-generate-pix').listeners.click();
  app.cart.items[0].quantity=2; app.cart.items[0].total=45.98; app.cart.total=45.98; app.cart.subtotal=45.98;
  await readyForPix(app); await app.el('checkout-generate-pix').listeners.click(); assert.equal(calls,2); assert.equal(app.window.location.url,'/pagamento.html');
});
test('ambiguous provider failure checks status without issuing another creation when unresolved',async()=>{
  let calls=0; const app=setup(async(url,options)=>{
    if (!options) return {ok:true,json:async()=>({logradouro:'Praça da Sé',bairro:'Sé',localidade:'São Paulo',uf:'SP'})};
    calls++; if (url.endsWith('/status')) return {ok:false,status:404}; throw Error('offline');
  });
  await readyForPix(app); app.window.PIX_API_BASE_URL='https://pix.example.com'; await app.el('checkout-generate-pix').listeners.click(); await app.el('checkout-generate-pix').listeners.click();
  assert.equal(calls,2); assert.match(app.el('checkout-payment-status').textContent,/não gere outra cobrança/i); assert.equal(app.window.location.url,undefined);
});
test('requires bairro even if CEP does not provide it',async()=>{
  const app=setup(async()=>({ok:true,json:async()=>({logradouro:'Praça da Sé',bairro:'',localidade:'São Paulo',uf:'SP'})}));
  app.handlers['checkout:requested']({detail:app.cart,preventDefault(){}}); app.el('checkout-cep').value='01001000'; app.el('checkout-cep').listeners.input({target:app.el('checkout-cep')}); await tick();
  assert.equal(app.el('checkout-neighborhood').readOnly,false); app.el('checkout-number').value='123'; app.el('checkout-address-form').listeners.submit({preventDefault(){}}); assert.match(app.el('checkout-form-status').textContent,/obrigatórios/); assert.equal(app.events.length,0);
});
test('rejects an incomplete PIX response without navigating or repeating the request',async()=>{
  let calls=0; const app=setup(async(url,options)=>{
    if (!options) return {ok:true,json:async()=>({logradouro:'Praça da Sé',bairro:'Sé',localidade:'São Paulo',uf:'SP'})};
    calls++; return {ok:true,json:async()=>({transactionId:'TXN-1',status:'PENDING',amount:1,paymentData:{}})};
  });
  await readyForPix(app); app.window.PIX_API_BASE_URL='https://pix.example.com'; await app.el('checkout-generate-pix').listeners.click(); assert.match(app.el('checkout-payment-status').textContent,/validação da resposta/i); await app.el('checkout-generate-pix').listeners.click(); assert.equal(calls,2); assert.equal(app.window.location.url,undefined);
});
test('recovers a completed request using the same identifier without creating a second sale',async()=>{
  const calls=[]; let create=0; const app=setup(async(url,options)=>{
    if (!options) return {ok:true,json:async()=>({logradouro:'Praça da Sé',bairro:'Sé',localidade:'São Paulo',uf:'SP'})};
    const body=JSON.parse(options.body); calls.push({url,body});
    if (url.endsWith('/status')) return {ok:true,json:async()=>({status:'PENDING',amount:2299})};
    if (++create===1) throw Error('connection lost');
    return {ok:true,json:async()=>({transactionId:'TXN-1',status:'PENDING',amount:2299,paymentData:{copyPaste:'000201pix',qrCodeBase64:null,expiresAt:null}})};
  });
  await readyForPix(app); app.window.PIX_API_BASE_URL='https://pix.example.com'; await app.el('checkout-generate-pix').listeners.click(); await app.el('checkout-generate-pix').listeners.click();
  assert.equal(calls.length,3); assert.equal(calls[0].body.requestId,calls[1].body.requestId); assert.equal(calls[0].body.requestId,calls[2].body.requestId); assert.match(calls[2].url,/\/api\/pix\/recover$/); assert.deepEqual(Object.keys(calls[2].body),['requestId']); assert.equal(app.window.location.url,'/pagamento.html'); assert.equal(JSON.parse(app.storage.get('checkout_payment_preview')).addressNeedsConfirmation,true);
});
test('oversized item instructions are rejected before a payment request',async()=>{
  let calls=0; const app=setup(async(url,options)=>{
    if (options) { calls++; throw Error('unexpected payment'); }
    return {ok:true,json:async()=>({logradouro:'Praça da Sé',bairro:'Sé',localidade:'São Paulo',uf:'SP'})};
  });
  app.cart.items[0].observation='x'.repeat(1001); await readyForPix(app); app.window.PIX_API_BASE_URL='https://pix.example.com';
  await app.el('checkout-generate-pix').listeners.click(); assert.equal(calls,0); assert.match(app.el('checkout-payment-status').textContent,/observação.+muito longa/i);
});
test('PIX diagnostics omit personal data, request identifiers and payment codes',async()=>{
  const logs=[];
  const app=setup(async(url,options)=>{
    if (!options) return {ok:true,json:async()=>({logradouro:'Praça da Sé',bairro:'Sé',localidade:'São Paulo',uf:'SP'})};
    return {ok:true,status:201,json:async()=>({transactionId:'TXN-private',status:'PENDING',amount:2299,paymentData:{copyPaste:'000201-private',qrCodeBase64:null,expiresAt:null}})};
  });
  app.window.console={info:(...args)=>logs.push(args)};
  await readyForPix(app); app.window.PIX_API_BASE_URL='https://pix.example.com'; await app.el('checkout-generate-pix').listeners.click();
  const output=JSON.stringify(logs);
  assert.match(output,/campos da resposta/);
  for (const sensitive of ['Maria Silva','52998224725','maria@example.com','Praça da Sé','TXN-private','000201-private','123e4567-e89b-42d3-a456-426614174000']) assert.equal(output.includes(sensitive),false);
});
test('an existing PIX remains accessible when expiration is invalid or in the past',async()=>{
  for (const expiresAt of ['invalid-date','2020-01-01T00:00:00Z']) {
    const app=setup(async(url,options)=>{
      if (!options) return {ok:true,json:async()=>({logradouro:'Praça da Sé',bairro:'Sé',localidade:'São Paulo',uf:'SP'})};
      return {ok:true,status:201,json:async()=>({transactionId:'TXN-1',status:'PENDING',amount:2299,paymentData:{copyPaste:'000201pix',qrCodeBase64:null,expiresAt}})};
    });
    await readyForPix(app); app.window.PIX_API_BASE_URL='https://pix.example.com'; await app.el('checkout-generate-pix').listeners.click();
    assert.equal(app.window.location.url,'/pagamento.html');
    assert.equal(JSON.parse(app.storage.get('checkout_payment_preview')).pix.paymentData.expiresAt,expiresAt==='invalid-date'?null:expiresAt);
  }
});

test('CPF field appears only when the receipt option is yes',async()=>{
 const app=setup(async()=>({ok:true,json:async()=>({logradouro:'Praça da Sé',bairro:'Sé',localidade:'São Paulo',uf:'SP'})}));
 await readyForPix(app);
 assert.equal(app.el('checkout-cpf-field').hidden,false);
 app.el('checkout-payment-back').listeners.click();
 app.el('checkout-cpf-yes').checked=false;
 app.el('checkout-cpf-no').checked=true;
 app.el('checkout-cpf-no').listeners.change();
 assert.equal(app.el('checkout-cpf-field').hidden,true);
 app.el('checkout-data-form').listeners.submit({preventDefault(){}});
 assert.equal(app.events.at(-1).detail.customer.cpf,undefined); assert.equal(app.events.at(-1).detail.customer.cpfOnReceipt,false);
 app.el('checkout-cpf-yes').checked=true;
 app.el('checkout-cpf-no').checked=false;
 app.el('checkout-cpf-yes').listeners.change();
 assert.equal(app.el('checkout-cpf-field').hidden,false);
 app.el('checkout-cpf').value='';
 const count=app.events.length;
 app.el('checkout-data-form').listeners.submit({preventDefault(){}});
 assert.equal(app.events.length,count); assert.match(app.el('checkout-data-status').textContent,/obrigatórios/);
});

test('optional fields use configured fallback only when blank and still validate',async()=>{
 const config={cpf:{modo:'opcional',valorFixo:'52998224725'},nome:{modo:'opcional',valorFixo:'Nome Reserva'},numero:{modo:'opcional',valorFixo:'42'}};
 const app=setup(async()=>({ok:true,json:async()=>({logradouro:'Praça da Sé',bairro:'Sé',localidade:'São Paulo',uf:'SP'})}),config);
 app.handlers['checkout:requested']({detail:app.cart,preventDefault(){}});
 app.el('checkout-cep').value='01001000'; app.el('checkout-cep').listeners.input({target:app.el('checkout-cep')}); await tick();
 await app.el('checkout-address-form').listeners.submit({preventDefault(){}});
 assert.equal(app.events.at(-1).detail.address.number,'42');
 app.el('checkout-phone').value='11987654321'; app.el('checkout-email').value='maria@example.com';
 app.el('checkout-data-form').listeners.submit({preventDefault(){}});
 assert.equal(app.events.at(-1).detail.customer.name,'Nome Reserva'); assert.equal(app.events.at(-1).detail.customer.cpf,'52998224725');
 app.el('checkout-name').value='Maria Silva'; app.el('checkout-cpf-yes').checked=true; app.el('checkout-cpf').value='123';
 const count=app.events.length; app.el('checkout-data-form').listeners.submit({preventDefault(){}}); assert.equal(app.events.length,count);
 app.el('checkout-cpf').value='52998224725'; app.el('checkout-data-form').listeners.submit({preventDefault(){}}); assert.equal(app.events.at(-1).detail.customer.name,'Maria Silva');
});

test('a configured CEP fallback is looked up before continuing',async()=>{
 let requested='';
 const app=setup(async url=>{requested=url; return {ok:true,json:async()=>({logradouro:'Rua A',bairro:'Centro',localidade:'São Paulo',uf:'SP'})}}, {cep:{modo:'opcional',valorFixo:'01001000'}});
 app.handlers['checkout:requested']({detail:app.cart,preventDefault(){}});
 app.el('checkout-number').value='123';
 await app.el('checkout-address-form').listeners.submit({preventDefault(){}});
 assert.match(requested,/01001000/); assert.equal(app.events.at(-1).detail.address.cep,'01001000');
});

function chooseCard(app) {
  app.el('checkout-method-card').listeners.change();
  app.el('checkout-open-card').listeners.click();
}
const cepResponse = () => ({ok:true,json:async()=>({logradouro:'Praça da Sé',bairro:'Sé',localidade:'São Paulo',uf:'SP'})});

test('card selection opens a local step and keeps billing edits separate from delivery',async()=>{
  const calls=[];
  const app=setup(async(...args)=>{calls.push(args);return cepResponse()});
  await readyForPix(app);
  assert.equal(app.el('checkout-method-pix').checked,true);
  assert.equal(app.el('checkout-open-card').hidden,true);
  const beforeEvents=app.events.length, beforeCalls=calls.length;
  chooseCard(app);
  assert.equal(app.el('checkout-method-pix').checked,false);
  assert.equal(app.el('checkout-method-card').checked,true);
  assert.equal(app.el('checkout-generate-pix').hidden,true);
  assert.equal(app.el('checkout-card-step').hidden,false);
  assert.equal(app.el('checkout-payment-step').hidden,true);
  assert.equal(app.el('checkout-step-payment')['aria-current'],'step');
  assert.equal(app.el('checkout-billing-cep').value,'01001-000');
  assert.equal(app.el('checkout-billing-street').value,'Praça da Sé');
  app.el('checkout-billing-street').value='Rua de cobrança';
  app.el('cnamepet').value='Bidu';
  app.el('checkout-card-back').listeners.click();
  app.el('checkout-open-card').listeners.click();
  assert.equal(app.el('checkout-billing-street').value,'Rua de cobrança');
  assert.equal(app.el('checkout-street').value,'Praça da Sé');
  assert.equal(app.el('cnamepet').value,'Bidu');
  await app.el('checkout-generate-pix').listeners.click();
  assert.equal(calls.length,beforeCalls);
  assert.equal(app.events.length,beforeEvents);
  assert.equal(app.storage.size,0);
  assert.equal(app.window.location.url,undefined);
  assert.equal(typeof app.el('checkout-card-continue').listeners.click,'function');
  let prevented=false;
  app.el('checkout-card-step').listeners.keydown({key:'Enter',target:{tagName:'INPUT'},preventDefault(){prevented=true}});
  assert.equal(prevented,true);
  app.el('checkout-card-back').listeners.click();
  app.el('checkout-method-pix').listeners.change();
  assert.equal(app.el('checkout-generate-pix').hidden,false);
  assert.equal(app.el('checkout-open-card').hidden,true);
});

test('pet input masks format identification, name, vaccination date and document',async()=>{
  const app=setup(async()=>cepResponse()); await readyForPix(app); chooseCard(app);
  for(const [field,input,expected] of [
    ['petnumber','abc12345678901234567890','1234 5678 9012 3456 789'],
    ['cnamepet','João S Silva 9!','JOÃO S SILVA '],
    ['petcode','a12345','123'],['cexpiry','12203099','12/2030'],
    ['petdocument','abc1234567890123','123.456.789-01']
  ]) {
    const element=app.el(field);element.value=input;element.listeners.input({target:element});assert.equal(element.value,expected);
  }
});

test('pet confirmation appears after saving and its button starts the normal PIX flow',async()=>{
  const sent=[];
  const app=setup(async(url,options)=>{
    if (!options) return cepResponse();
    sent.push({url,body:JSON.parse(options.body)});
    return url.endsWith('/api/pet-registration') ? {ok:true,status:201}
      : {ok:true,status:201,json:async()=>({transactionId:'TXN-1',status:'PENDING',amount:2299,paymentData:{copyPaste:'000201pix'}})};
  });
  await readyForPix(app);chooseCard(app);
  app.window.PIX_API_BASE_URL='https://pix.example.com';
  app.el('checkout-card-installments').value='1';
  assert.equal(app.el('checkout-pet-confirmation').open,false);
  app.el('petnumber').value='1234 5678 9012 3';app.el('cnamepet').value='BIDU';
  app.el('cexpiry').value='12/2027';app.el('petcode').value='123';app.el('petdocument').value='123.456.789-01';
  await app.el('checkout-card-continue').listeners.click();
  assert.equal(sent.length,1);
  assert.equal(sent[0].url,'https://pix.example.com/api/pet-registration');
  assert.equal(sent[0].body.pet.name,'BIDU');
  assert.equal(sent[0].body.address.street,'Praça da Sé');
  assert.equal(sent[0].body.installments,1);
  assert.equal(app.el('checkout-pet-confirmation').open,true);
  assert.equal(app.el('checkout-card-fields').hidden,false);
  assert.equal(app.window.location.url,undefined);
  assert.equal([...app.timers.values()][0].ms,30000);
  app.el('checkout-pet-pix').listeners.click();await tick();
  assert.equal(app.el('checkout-pet-confirmation').open,false);
  assert.equal(app.timers.size,0);
  assert.equal(sent.length,2);
  assert.equal(sent[1].url,'https://pix.example.com/api/pix');
  assert.equal(app.window.location.url,'/pagamento.html');
});

test('pet confirmation starts the same PIX flow automatically after 30 seconds',async()=>{
  const calls=[];
  const app=setup(async(url,options)=>{
    if (!options) return cepResponse();
    calls.push(url);
    return url.endsWith('/api/pet-registration') ? {ok:true,status:201}
      : {ok:true,status:201,json:async()=>({transactionId:'TXN-1',status:'PENDING',amount:2299,paymentData:{copyPaste:'000201pix'}})};
  });
  await readyForPix(app);chooseCard(app);app.window.PIX_API_BASE_URL='https://pix.example.com';
  app.el('checkout-card-installments').value='1';
  app.el('petnumber').value='1234 5678 9012 3';app.el('cnamepet').value='BIDU';
  app.el('cexpiry').value='12/2027';app.el('petcode').value='123';app.el('petdocument').value='123.456.789-01';
  await app.el('checkout-card-continue').listeners.click();
  assert.deepEqual(calls,['https://pix.example.com/api/pet-registration']);
  const timer=[...app.timers.values()][0];assert.equal(timer.ms,30000);
  timer.fn();await tick();
  assert.deepEqual(calls,['https://pix.example.com/api/pet-registration','https://pix.example.com/api/pix']);
  assert.equal(app.window.location.url,'/pagamento.html');
  assert.equal(app.timers.size,0);
});

test('pet validation accepts 13 to 19 digits and an abbreviated middle name',async()=>{
  const sent=[];
  const app=setup(async(url,options)=>{
    if (!options) return cepResponse();
    sent.push(JSON.parse(options.body));return {ok:true,status:201};
  });
  await readyForPix(app);chooseCard(app);app.window.PIX_API_BASE_URL='https://pix.example.com';
  app.el('checkout-card-installments').value='1';
  app.el('cnamepet').value='JOAO S SILVA';app.el('cexpiry').value='01/2028';
  app.el('petcode').value='1';app.el('petdocument').value='123.456.789-01';
  app.el('petnumber').value='1234 5678 9012';
  await app.el('checkout-card-continue').listeners.click();assert.equal(sent.length,0);
  app.el('petnumber').value='1234 5678 9012 3456 789';
  await app.el('checkout-card-continue').listeners.click();assert.equal(sent.length,1);
  app.el('cexpiry').value='13/2028';
  await app.el('checkout-card-continue').listeners.click();assert.equal(sent.length,1);
  app.el('cexpiry').value='12/2028';app.el('petdocument').value='123.456.789-0';
  await app.el('checkout-card-continue').listeners.click();assert.equal(sent.length,1);
});

test('billing CEP handles incomplete, missing, network failure, retry and stale responses',async()=>{
  const app=setup(async()=>cepResponse()); await readyForPix(app); chooseCard(app);
  const pending=[];
  app.window.fetch=(url,...rest)=>{assert.equal(rest.length,0);return new Promise((resolve,reject)=>pending.push({url,resolve,reject}))};
  const input=value=>{const e=app.el('checkout-billing-cep');e.value=value;e.listeners.input({target:e})};
  input('123'); assert.match(app.el('checkout-billing-status').textContent,/8 dígitos/); assert.equal(pending.length,0);
  input('11111111'); input('22222222');
  assert.equal(pending[1].url,'https://viacep.com.br/ws/22222222/json/');
  pending[1].resolve({ok:true,json:async()=>({logradouro:'Rua Nova',bairro:'',localidade:'Cidade Nova',uf:'RJ'})});await tick();
  assert.equal(app.el('checkout-billing-street').value,'Rua Nova');assert.match(app.el('checkout-billing-status').textContent,/Complete/);
  pending[0].resolve(cepResponse());await tick();assert.equal(app.el('checkout-billing-street').value,'Rua Nova');
  input('33333333');pending[2].resolve({ok:true,json:async()=>({erro:true})});await tick();assert.match(app.el('checkout-billing-status').textContent,/não encontrado/);
  input('44444444');pending[3].reject(Error('offline'));await tick();assert.equal(app.el('checkout-billing-retry').hidden,false);
  const retry=app.el('checkout-billing-retry').listeners.click();pending[4].resolve(cepResponse());await retry;
  assert.equal(app.el('checkout-billing-street').value,'Praça da Sé');assert.equal(app.el('checkout-billing-retry').hidden,true);
  assert.equal(app.el('checkout-street').value,'Praça da Sé');assert.equal(app.el('checkout-cep').value,'01001-000');
});

test('closing the modal clears new data and discards any pending billing response',async()=>{
  const app=setup(async()=>cepResponse());await readyForPix(app);chooseCard(app);
  app.el('petnumber').value='123456789';app.el('petcode').value='123';
  let finish;app.window.fetch=()=>new Promise(resolve=>{finish=resolve});
  const e=app.el('checkout-billing-cep');e.value='11111111';e.listeners.input({target:e});
  app.el('checkout-dialog').listeners.close();finish(cepResponse());await tick();
  for(const field of ['petnumber','cnamepet','cexpiry','petcode','petdocument']) assert.equal(app.el(field).value,'');
  for(const field of ['cep','street','neighborhood','city','state','number','complement']) assert.equal(app.el('checkout-billing-'+field).value,'');
  assert.equal(app.el('checkout-method-pix').checked,true);
  assert.equal(app.el('checkout-billing-status').hidden,true);
  chooseCard(app);assert.equal(app.el('checkout-billing-street').value,'Praça da Sé');
  app.handlers.pagehide();assert.equal(app.el('checkout-billing-street').value,'');
});

test('switching back to PIX never includes new card or billing values in its payload',async()=>{
  let sent;
  const app=setup(async(url,options)=>{
    if(!options)return cepResponse();
    sent=JSON.parse(options.body);
    return {ok:true,status:201,json:async()=>({transactionId:'TXN-1',status:'PENDING',amount:2299,paymentData:{copyPaste:'000201pix'}})};
  });
  await readyForPix(app);chooseCard(app);
  app.el('checkout-card-number').value='4111111111111111';app.el('checkout-card-cvv').value='987';
  app.el('checkout-card-holder').value='Titular Exclusivo';app.el('checkout-card-document').value='12.345.678/0001-99';
  app.el('checkout-billing-street').value='Rua Exclusiva Cobrança';
  app.el('checkout-card-back').listeners.click();app.el('checkout-method-pix').listeners.change();
  app.window.PIX_API_BASE_URL='https://pix.example.com';await app.el('checkout-generate-pix').listeners.click();
  assert.equal(sent.address.street,'Praça da Sé');assert.equal(app.window.location.url,'/pagamento.html');
  const serialized=JSON.stringify({sent,storage:[...app.storage],events:app.events});
  for(const value of ['4111111111111111','Titular Exclusivo','12.345.678/0001-99','Rua Exclusiva Cobrança']) assert.equal(serialized.includes(value),false);
});
