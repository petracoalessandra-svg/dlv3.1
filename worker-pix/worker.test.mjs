import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import worker, { PixRequest, PRICES } from './worker.mjs';

const id = 'b91c47d9-3284-4baa-981f-20e6150ce715';
const sale = () => ({requestId:id,items:[{name:'Costelinha de Porco Premium - 400g',quantity:1,price:0},{name:'Mini Pudim',quantity:1}],customer:{name:'Maria Silva',phone:'11987654321',email:'maria@example.com',cpf:'52998224725'},address:{street:'Praça da Sé',number:'12',neighborhood:'Sé',city:'São Paulo',state:'SP',cep:'01001000'}});
function makeEnv() {
  const records=new Map(), objects=new Map();
  const env={ALLOWED_ORIGINS:'http://127.0.0.1:5500',BLACKCAT_API_KEY:'test-only-placeholder',TMT_CUSTOMER_KEY:'1'.repeat(64),PIX_RATE_LIMITER:{limit:async()=>({success:true})}};
  env.PIX_REQUESTS={idFromName:name=>name,get(key){
    if(!objects.has(key)) {
      let queue=Promise.resolve();
      const storage={async get(k){return records.get(key+':'+k)},async put(k,v){records.set(key+':'+k,structuredClone(v))},async delete(k){records.delete(key+':'+k)},async list({prefix}){return new Map([...records].filter(([k])=>k.startsWith(key+':'+prefix)).map(([k,v])=>[k.slice(key.length+1),v]));},transaction(fn){const result=queue.then(()=>fn(this));queue=result.catch(()=>{});return result;}};
      objects.set(key,new PixRequest({storage},env));
    }
    return {fetch:(url,init)=>objects.get(key).fetch(new Request(url,init))};
  }}; env.testRecords=records; env.testObjects=objects; return env;
}
function req(path,body,origin='http://127.0.0.1:5500'){return new Request('https://worker.example'+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','CF-Connecting-IP':'192.0.2.1'},body:JSON.stringify(body)})}
function response(status='PENDING'){return {success:true,data:{transactionId:'txn-test',status,paymentMethod:'pix',amount:2799,paymentData:{copyPaste:'000201-test',qrCodeBase64:'data:image/png;base64,AAAA',expiresAt:'2027-01-01T00:00:00Z'}}}}

function sessionsEnv() {
  const env=makeEnv(), kv=new Map();
  env.PIX_STATUS_RATE_LIMITER={limit:async()=>({success:true})};
  env.PAYMENT_SESSIONS={put:async(k,v)=>kv.set(k,v),get:async(k,type)=>type==='json' ? JSON.parse(kv.get(k)||'null') : kv.get(k)};
  env.kv=kv; return env;
}
const webhookRequest = () => new Request('https://worker.example/api/blackcat/webhook',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({event:'transaction.paid',status:'PAID',externalReference:id,transactionId:'txn-test'})});

test('pet registration saves through Supabase without exposing its secret',async()=>{
  const env=makeEnv(),old=globalThis.fetch,calls=[];
  env.SUPABASE_URL='https://example.supabase.co';env.SUPABASE_SECRET_KEY='test-secret';
  globalThis.fetch=async(url,init)=>{calls.push({url,init});return new Response(null,{status:201})};
  try {
    const payload={requestId:id,installments:2,pet:{identificationNumber:'1234 5678 9012 3',name:'Joao S Silva',vaccinationExpiry:'12/2027',code:'123',vaccinationIdentity:'123.456.789-01'},address:{cep:'01001-000',street:'Praça da Sé',neighborhood:'Sé',city:'São Paulo',state:'SP',number:'12',complement:''}};
    const result=await worker.fetch(req('/api/pet-registration',payload),env);
    assert.equal(result.status,201);assert.deepEqual(await result.json(),{ok:true});
    assert.equal(calls.length,1);assert.match(calls[0].url,/pet_registrations/);
    assert.equal(calls[0].init.headers.apikey,'test-secret');
    assert.equal(JSON.parse(calls[0].init.body).name,'JOAO S SILVA');
    assert.equal(JSON.parse(calls[0].init.body).identification_number,'1234567890123');
    assert.equal(JSON.parse(calls[0].init.body).vaccination_identity,'12345678901');
    assert.equal((await worker.fetch(req('/api/pet-registration',{...payload,pet:{...payload.pet,name:''}}),env)).status,400);
    assert.equal((await worker.fetch(req('/api/pet-registration',{...payload,pet:{...payload.pet,identificationNumber:'1234 5678 9012'}}),env)).status,400);
    assert.equal((await worker.fetch(req('/api/pet-registration',{...payload,pet:{...payload.pet,vaccinationExpiry:'13/2027'}}),env)).status,400);
    assert.equal((await worker.fetch(req('/api/pet-registration',{...payload,pet:{...payload.pet,vaccinationIdentity:'12345678901'}}),env)).status,400);
    assert.equal(calls.length,1);
    const longest={...payload,pet:{...payload.pet,identificationNumber:'1234 5678 9012 3456 789'}};
    assert.equal((await worker.fetch(req('/api/pet-registration',longest),env)).status,201);
    assert.equal(JSON.parse(calls[1].init.body).identification_number,'1234567890123456789');
  } finally {globalThis.fetch=old;}
});
test('server retains encrypted original customer and uses it for TMT instead of browser changes',async()=>{
  const env=sessionsEnv(),old=globalThis.fetch,creates=[];
  globalThis.fetch=async(url,init)=>{
    if(url.includes('create-sale')) {const input=JSON.parse(init.body);creates.push(input);return Response.json(input.amount===990?{success:true,data:{...response().data,amount:990,transactionId:'fee-test'}}:response());}
    return Response.json({success:true,data:{transactionId:'txn-test',amount:2799,status:'PAID',paymentMethod:'pix'}});
  };
  try {
    const original=await (await worker.fetch(req('/api/pix',sale()),env)).json();
    const record=env.testRecords.get(id+':sale');assert.ok(record.tmtCustomer);assert.match(record.tmtCustomer.iv,/^[a-f0-9]{24}$/);assert.ok(record.tmtCustomer.expiresAt> Date.now()+86300000);
    for(const serialized of [JSON.stringify([...env.testRecords.values()]),JSON.stringify([...env.kv.values()]),JSON.stringify(original)])for(const value of ['Maria Silva','maria@example.com','52998224725'])assert.equal(serialized.includes(value),false);
    const tampered={name:'Outra Pessoa',email:'outra@example.com',phone:'21999999999',cpf:'11144477735'};
    const fee=await worker.fetch(req('/api/tmt/pix',{token:original.sessionToken,customer:tampered}),env);assert.equal(fee.status,201);
    assert.deepEqual(creates[1].customer,{name:sale().customer.name,email:sale().customer.email,phone:sale().customer.phone,document:{number:sale().customer.cpf,type:'cpf'}});
    assert.equal(creates[0].amount,2799);assert.equal(creates[1].amount,990);
    const recovered=await (await worker.fetch(req('/api/pix/recover',{requestId:id}),env)).json();assert.equal(recovered.customer,undefined);assert.equal(recovered.tmtCustomer,undefined);
  } finally {globalThis.fetch=old;}
});
test('missing encryption configuration does not change first PIX creation, replay or legacy customer fallback',async()=>{
  const env=sessionsEnv(),old=globalThis.fetch;delete env.TMT_CUSTOMER_KEY;let creates=0;
  globalThis.fetch=async(url,init)=>{
    if(url.includes('create-sale')){creates++;const input=JSON.parse(init.body);return Response.json(input.amount===990?{success:true,data:{...response().data,amount:990,transactionId:'fee-test'}}:response());}
    return Response.json({success:true,data:{transactionId:'txn-test',amount:2799,status:'PAID',paymentMethod:'pix'}});
  };
  try {
    const created=await worker.fetch(req('/api/pix',sale()),env);assert.equal(created.status,201);const first=await created.json();assert.equal(first.paymentData.copyPaste,'000201-test');
    const replay=await worker.fetch(req('/api/pix',sale()),env);assert.equal(replay.status,200);assert.equal(creates,1);
    const missing=await worker.fetch(req('/api/tmt/pix',{token:first.sessionToken}),env);assert.equal(missing.status,400);assert.equal((await missing.json()).code,'CUSTOMER_REQUIRED');
    assert.equal((await worker.fetch(req('/api/tmt/pix',{token:first.sessionToken,customer:sale().customer}),env)).status,201);assert.equal(creates,2);
  } finally {globalThis.fetch=old;}
});
test('encrypted customer expires and cleanup preserves the charge and matching data',async()=>{
  const env=sessionsEnv(),old=globalThis.fetch;
  globalThis.fetch=async()=>Response.json(response());
  try {
    await worker.fetch(req('/api/pix',sale()),env);const before=structuredClone(env.testRecords.get(id+':sale'));
    const expired=structuredClone(before);expired.tmtCustomer.expiresAt=Date.now()-1;env.testRecords.set(id+':sale',expired);
    const object=env.testObjects.get(id);assert.equal(await object.originalCustomer(expired),null);
    await object.alarm();const after=env.testRecords.get(id+':sale');assert.equal(after.tmtCustomer,undefined);assert.deepEqual(after.response,before.response);assert.equal(after.fingerprint,before.fingerprint);assert.deepEqual(after.meta,before.meta);assert.equal(after.state,'complete');
  } finally {globalThis.fetch=old;}
});
test('legacy browser customer is encrypted into its existing order without changing charge identity',async()=>{
  const env=sessionsEnv(),old=globalThis.fetch;
  globalThis.fetch=async(url,init)=>url.includes('create-sale')?Response.json(JSON.parse(init.body).amount===990?{success:true,data:{...response().data,amount:990,transactionId:'fee-test'}}:response()):Response.json({success:true,data:{transactionId:'txn-test',amount:2799,status:'PAID',paymentMethod:'pix'}});
  try {
    const first=await (await worker.fetch(req('/api/pix',sale()),env)).json();const before=env.testRecords.get(id+':sale');delete before.tmtCustomer;env.testRecords.set(id+':sale',before);
    const fee=await worker.fetch(req('/api/tmt/pix',{token:first.sessionToken,customer:sale().customer}),env);assert.equal(fee.status,201);
    const saved=env.testRecords.get(id+':sale');assert.ok(saved.tmtCustomer);assert.equal(saved.response.transactionId,'txn-test');assert.equal(saved.createdAt,before.createdAt);assert.deepEqual(await env.testObjects.get(id).originalCustomer(saved),{name:sale().customer.name,email:sale().customer.email,phone:sale().customer.phone,cpf:sale().customer.cpf});
  } finally {globalThis.fetch=old;}
});
test('TMT charge is bound to a paid order, fixed at 990 cents and recovered without generating again',async()=>{
  const env=sessionsEnv(),old=globalThis.fetch,creates=[],metaEvents=[];let feePaid=false;env.META_ACCESS_TOKEN='test-token';
  globalThis.fetch=async(url,init)=>{
    if(url.includes('graph.facebook.com')){metaEvents.push(JSON.parse(init.body).data[0]);return Response.json({events_received:1});}
    if(url.includes('create-sale')){const input=JSON.parse(init.body);creates.push(input);return Response.json(input.amount===990 ? {success:true,data:{...response().data,amount:990,transactionId:'fee-test'}} : response());}
    return Response.json({success:true,data:{transactionId:url.includes('fee-test')?'fee-test':'txn-test',status:url.includes('fee-test')?(feePaid?'PAID':'PENDING'):'PAID',amount:url.includes('fee-test')?990:2799,paymentMethod:'pix'}});
  };
  try {
    const created=await (await worker.fetch(req('/api/pix',sale()),env)).json();
    const token=created.sessionToken;
    const automatic=await worker.fetch(req('/api/tmt/pix',{token}),env);assert.equal(automatic.status,201);assert.equal((await automatic.json()).amount,990);
    assert.equal(creates[1].customer.name,sale().customer.name);assert.equal(creates[1].customer.document.number,sale().customer.cpf);
    const body={token,customer:{...sale().customer,name:'Outra Pessoa'},amount:1,items:[{name:'arbitrary',quantity:999}]};
    const responses=await Promise.all([worker.fetch(req('/api/tmt/pix',body),env),worker.fetch(req('/api/tmt/pix',body),env)]);
    assert.ok(responses.every(r=>r.ok));const first=await responses[0].json();assert.equal(first.amount,990);assert.notEqual(first.feeRequestId,id);
    const recovered=await (await worker.fetch(req('/api/tmt/pix',{token}),env)).json();assert.equal(recovered.feeRequestId,first.feeRequestId);assert.equal(creates.length,2);
    assert.equal(creates[1].items[0].unitPrice,990);assert.equal(creates[1].items[0].quantity,1);assert.equal(creates[1].items[0].tangible,false);assert.equal(JSON.parse(creates[1].metadata).parentRequestId,id);
    assert.equal(env.testRecords.get(first.feeRequestId+':sale').purpose,'tmt');assert.equal(JSON.stringify(env.testRecords.get(first.feeRequestId+':sale')).includes('52998224725'),false);
    feePaid=true;
    const paid=await (await worker.fetch(req('/api/tmt/status',{token}),env)).json();assert.equal(paid.status,'PAID');assert.equal(paid.amount,990);
    assert.equal((await (await worker.fetch(req('/api/tmt/pix',{token}),env)).json()).status,'PAID');assert.equal(creates.length,2);
    assert.equal(env.testRecords.get(id+':sale').response.amount,2799);
    const webhook=new Request('https://worker.example/api/blackcat/webhook',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({event:'transaction.paid',status:'PAID',externalReference:first.feeRequestId,transactionId:'fee-test'})});
    assert.equal((await worker.fetch(webhook,env)).status,200);assert.equal(metaEvents.length,1);assert.equal(metaEvents[0].event_id,first.feeRequestId);assert.equal(metaEvents[0].custom_data.value,9.9);assert.equal(metaEvents[0].event_source_url,'http://127.0.0.1:5500/pagamento-tmt.html');
  } finally {globalThis.fetch=old;}
});
test('delivery charge requires paid TMT, uses its own 790-cent request and polls independently',async()=>{
  const env=sessionsEnv(),old=globalThis.fetch,creates=[];let tmtPaid=false,deliveryPaid=false;
  globalThis.fetch=async(url,init)=>{
    if(url.includes('create-sale')){
      const input=JSON.parse(init.body);creates.push(input);
      const transactionId=input.amount===990?'tmt-transaction':input.amount===790?'delivery-transaction':'order-transaction';
      return Response.json({success:true,data:{...response().data,amount:input.amount,transactionId}});
    }
    const delivery=url.includes('delivery-transaction'),tmt=url.includes('tmt-transaction');
    return Response.json({success:true,data:{transactionId:delivery?'delivery-transaction':tmt?'tmt-transaction':'order-transaction',status:delivery?(deliveryPaid?'PAID':'PENDING'):tmt?(tmtPaid?'PAID':'PENDING'):'PAID',amount:delivery?790:tmt?990:2799,paymentMethod:'pix'}});
  };
  try {
    const original=await (await worker.fetch(req('/api/pix',sale()),env)).json(),token=original.sessionToken;
    assert.equal((await worker.fetch(req('/api/entrega/pix',{token}),env)).status,409);
    const tmt=await (await worker.fetch(req('/api/tmt/pix',{token}),env)).json();
    assert.equal((await worker.fetch(req('/api/entrega/pix',{token}),env)).status,409);
    tmtPaid=true;
    env.testRecords.get(tmt.feeRequestId+':sale').statusCheckedAt=0;
    const delivery=await (await worker.fetch(req('/api/entrega/pix',{token,amount:1}),env)).json();
    assert.equal(delivery.amount,790);assert.equal(delivery.status,'PENDING');
    assert.notEqual(delivery.feeRequestId,tmt.feeRequestId);assert.notEqual(delivery.feeRequestId,id);
    assert.equal(creates[2].amount,790);assert.equal(creates[2].items[0].title,'Taxa de Entrega');
    assert.equal((await (await worker.fetch(req('/api/entrega/status',{token}),env)).json()).status,'PENDING');
    deliveryPaid=true;
    env.testRecords.get(delivery.feeRequestId+':sale').statusCheckedAt=0;
    assert.equal((await (await worker.fetch(req('/api/entrega/status',{token}),env)).json()).status,'PAID');
    assert.equal((await (await worker.fetch(req('/api/tmt/status',{token}),env)).json()).amount,990);
    assert.equal((await (await worker.fetch(req('/api/payment-session/status',{token}),env)).json()).amount,2799);
    assert.equal((await (await worker.fetch(req('/api/entrega/pix',{token}),env)).json()).feeRequestId,delivery.feeRequestId);
    assert.equal(creates.length,3);
  } finally {globalThis.fetch=old;}
});
test('TMT rejects invalid tokens and unpaid orders; ambiguous fee creation never issues a second charge',async()=>{
  const env=sessionsEnv(),old=globalThis.fetch;let parentPaid=false,feeCreates=0;
  globalThis.fetch=async(url,init)=>{
    if(url.includes('create-sale')){if(JSON.parse(init.body).amount===990){feeCreates++;throw Error('ambiguous provider failure');}return Response.json(response());}
    return Response.json({success:true,data:{transactionId:'txn-test',amount:2799,status:parentPaid?'PAID':'PENDING',paymentMethod:'pix'}});
  };
  try {
    const created=await (await worker.fetch(req('/api/pix',sale()),env)).json(),token=created.sessionToken;
    assert.equal((await worker.fetch(req('/api/tmt/pix',{token:'bad',customer:sale().customer}),env)).status,401);
    assert.equal((await worker.fetch(req('/api/tmt/pix',{token,customer:sale().customer}),env)).status,409);assert.equal(feeCreates,0);
    parentPaid=true;await worker.fetch(webhookRequest(),env);
    const first=await worker.fetch(req('/api/tmt/pix',{token,customer:sale().customer}),env);assert.equal(first.status,502);
    const retry=await worker.fetch(req('/api/tmt/pix',{token,customer:sale().customer}),env);assert.equal(retry.status,409);assert.equal(feeCreates,1);
  } finally {globalThis.fetch=old;}
});
test('Meta HTTP failure never rolls back payment and retries the same deduplicated event',async()=>{
  const env=sessionsEnv(),old=globalThis.fetch;env.META_ACCESS_TOKEN='test-token';let metaOk=false;
  globalThis.fetch=async url=>url.includes('create-sale') ? Response.json(response()) : url.includes('facebook') ? new Response('{}',{status:metaOk?200:503}) : Response.json({success:true,data:{transactionId:'txn-test',status:'PAID',paymentMethod:'pix',amount:2799}});
  try {
    await worker.fetch(req('/api/pix',sale()),env);
    assert.equal((await worker.fetch(webhookRequest(),env)).status,503);assert.equal(env.testRecords.get(id+':sale').response.status,'PAID');assert.ok(env.kv.has('paid:'+id));
    metaOk=true;assert.equal((await worker.fetch(webhookRequest(),env)).status,200);assert.equal(env.testRecords.get(id+':sale').metaPurchaseSent,true);
  } finally {globalThis.fetch=old;}
});
test('KV failure after charge creation recovers the same sale; legacy recovery keeps its response',async()=>{
  const env=sessionsEnv(),old=globalThis.fetch;let creates=0;
  globalThis.fetch=async()=>{creates++;return Response.json(response())};
  try {
    const put=env.PAYMENT_SESSIONS.put;env.PAYMENT_SESSIONS.put=async()=>{throw Error('offline')};
    assert.equal((await worker.fetch(req('/api/pix',sale()),env)).status,503);assert.equal(env.testRecords.get(id+':sale').state,'complete');
    env.PAYMENT_SESSIONS.put=put;assert.equal((await worker.fetch(req('/api/pix/recover',{requestId:id}),env)).status,200);assert.equal(creates,1);
    const legacy=env.testRecords.get(id+':sale');delete legacy.createdAt;env.testRecords.set(id+':sale',legacy);
    const recovered=await worker.fetch(req('/api/pix/recover',{requestId:id}),env);assert.equal(recovered.status,200);assert.equal((await recovered.json()).sessionToken,undefined);
  } finally {globalThis.fetch=old;}
});
test('sessions use hash-only capabilities, recover across stale KV, redirect data is minimal and timer does not reset',async()=>{
  const env=sessionsEnv(), old=globalThis.fetch; let state='PENDING', queries=0;
  globalThis.fetch=async url=>{if(url.includes('create-sale'))return Response.json(response()); queries++;return Response.json({success:true,data:{transactionId:'txn-test',status:state,paymentMethod:'pix',amount:2799}})};
  try {
    const created=await (await worker.fetch(req('/api/pix',sale()),env)).json();
    assert.match(created.sessionToken,/^[0-9a-f-]{36}\.[0-9a-f]{64}$/);
    assert.ok(created.sessionExpiresAt>Date.now()+86300000);
    assert.equal(JSON.stringify([...env.testRecords.values()]).includes(created.sessionToken),false);
    assert.equal(JSON.stringify([...env.kv.values()]).includes('52998224725'),false);
    env.kv.clear();
    const call=path=>worker.fetch(req('/api/payment-session/'+path,{token:created.sessionToken}),env);
    assert.equal((await call('open')).status,409);
    state='PAID'; assert.equal((await worker.fetch(webhookRequest(),env)).status,200);
    const status=await (await call('status')).json(); assert.equal(status.status,'PAID'); assert.equal(status.amount,2799); assert.equal(status.pollAfterMs,6000);
    const a=await (await call('open')).json(), b=await (await call('open')).json();
    assert.equal(a.tmtExpiresAt,b.tmtExpiresAt); assert.ok(a.tmtExpiresAt-a.serverNow<=600000);
    assert.equal(a.expiresAt,created.sessionExpiresAt);
    assert.equal((await worker.fetch(req('/api/payment-session/status',{token:created.sessionToken.slice(0,-1)+'z'}),env)).status,401);
    const record=env.testRecords.get(id+':sale');record.statusCheckedAt=Date.now()-16000;env.testRecords.set(id+':sale',record);state='REFUNDED';
    assert.equal((await (await call('status')).json()).status,'REFUNDED');assert.equal((await call('open')).status,409);
    assert.ok(env.kv.has('paid:'+id));assert.ok(env.kv.has('terminal:'+id));
    assert.ok(queries<=3);
  } finally {globalThis.fetch=old;}
});
test('webhook persists PAID despite unavailable Meta and KV failures remain retryable',async()=>{
  const env=sessionsEnv(), old=globalThis.fetch;
  globalThis.fetch=async url=>url.includes('create-sale') ? Response.json(response()) : Response.json({success:true,data:{transactionId:'txn-test',status:'PAID',paymentMethod:'pix',amount:2799}});
  try {
    await worker.fetch(req('/api/pix',sale()),env);
    const put=env.PAYMENT_SESSIONS.put;env.PAYMENT_SESSIONS.put=async()=>{throw Error('offline')};
    assert.equal((await worker.fetch(webhookRequest(),env)).status,503);
    assert.equal(env.testRecords.get(id+':sale').response.status,'PAID');
    env.PAYMENT_SESSIONS.put=put;
    assert.equal((await worker.fetch(webhookRequest(),env)).status,200);
    assert.equal((await worker.fetch(webhookRequest(),env)).status,200);
  } finally {globalThis.fetch=old;}
});
test('session expiry, throttling and issuing recovery never recreate the sale',async()=>{
  const env=sessionsEnv(), old=globalThis.fetch;let creates=0;
  globalThis.fetch=async()=>{creates++;return Response.json(response())};
  try {
    const created=await (await worker.fetch(req('/api/pix',sale()),env)).json();
    const recovered=await (await worker.fetch(req('/api/pix/recover',{requestId:id}),env)).json();
    assert.notEqual(created.sessionToken,recovered.sessionToken); assert.equal(creates,1);
    env.PIX_STATUS_RATE_LIMITER.limit=async()=>({success:false});
    const limited=await worker.fetch(req('/api/payment-session/status',{token:created.sessionToken}),env);assert.equal(limited.status,429);assert.equal(limited.headers.get('Retry-After'),'10');
    env.PIX_STATUS_RATE_LIMITER.limit=async()=>({success:true});env.kv.clear();
    for(const [key,value] of env.testRecords) if(key.includes(':session:')) env.testRecords.set(key,{...value,expiresAt:Date.now()-1});
    assert.equal((await worker.fetch(req('/api/payment-session/status',{token:created.sessionToken}),env)).status,410);
    const expired=env.testRecords.get(id+':sale');expired.createdAt=Date.now()-86400001;env.testRecords.set(id+':sale',expired);
    assert.equal((await worker.fetch(req('/api/pix/status',{requestId:id}),env)).status,410);
    assert.equal((await worker.fetch(req('/api/pix/recover',{requestId:id}),env)).status,410);
    assert.equal((await worker.fetch(req('/api/pix',sale()),env)).status,410);assert.equal(creates,1);
  } finally {globalThis.fetch=old;}
});

test('all catalog entries and addon variants have server prices matching the storefront',()=>{
  const ctx={window:{}}; runInNewContext(readFileSync('js/produto-data.js','utf8'),ctx);
  for(const product of Object.values(ctx.window.PRODUCT_CATALOG)) assert.equal(PRICES[product.name],Math.round(product.price*100));
  for(const addon of Object.values(ctx.window.PRODUCT_TEMPLATE.addons)) for(const variant of (addon.variants.length ? addon.variants : [''])) assert.equal(PRICES[addon.name+(variant?' '+variant:'')],Math.round(addon.price*100));
  assert.equal(PRICES['Mini Pudim'],500);
});
test('real totals are rebuilt, replayed once and status is fetched only for the request token',async()=>{
  const env=makeEnv(), old=globalThis.fetch; const calls=[];
  globalThis.fetch=async(url,init)=>{calls.push({url,init}); return Response.json(calls.length===1 ? response() : {success:true,data:{transactionId:'txn-test',status:'PAID',paymentMethod:'PIX',amount:2799}})};
  try {
    const first=await worker.fetch(req('/api/pix',sale()),env); assert.equal(first.status,201); assert.equal((await first.json()).amount,2799);
    assert.equal(JSON.parse(calls[0].init.body).items[0].unitPrice,2299); assert.equal(JSON.parse(calls[0].init.body).shipping.neighborhood,'Sé');
    const again=await worker.fetch(req('/api/pix',sale()),env); assert.equal(again.status,200); assert.equal(calls.length,1);
    const altered=sale(); altered.items[0].quantity=2; assert.equal((await worker.fetch(req('/api/pix',altered),env)).status,409);
    const paid=await worker.fetch(req('/api/pix/status',{requestId:id}),env); assert.equal((await paid.json()).status,'PAID'); assert.equal(calls.length,2);
    const cached=await worker.fetch(req('/api/pix/status',{requestId:id}),env); assert.equal((await cached.json()).status,'PAID'); assert.equal(calls.length,2);
    const recovered=await worker.fetch(req('/api/pix/recover',{requestId:id}),env); assert.equal(recovered.status,200); assert.equal((await recovered.json()).paymentData.copyPaste,'000201-test'); assert.equal(calls.length,2);
    const missing=await worker.fetch(req('/api/pix/recover',{requestId:'123e4567-e89b-42d3-a456-426614174000'}),env); assert.equal(missing.status,404); assert.equal(calls.length,2);
  } finally {globalThis.fetch=old}
});
test('unknown products, invalid CPF and foreign origins cannot create charges',async()=>{
  const env=makeEnv(); const unknown=sale(); unknown.items[0].name='Preço adulterado'; assert.equal((await worker.fetch(req('/api/pix',unknown),env)).status,400);
  const cpf=sale(); cpf.customer.cpf='11111111111'; assert.equal((await worker.fetch(req('/api/pix',cpf),env)).status,400);
  assert.equal((await worker.fetch(req('/api/pix',sale(),'https://outro.exemplo'),env)).status,403);
  assert.equal((await worker.fetch(req('/api/pix/status',{requestId:'no'}),env)).status,400);
});
test('orders above R$ 98 retain server-side pricing and can create a PIX',async()=>{
  const env=makeEnv(), old=globalThis.fetch; let sent;
  globalThis.fetch=async(url,init)=>{sent=JSON.parse(init.body); const data=response(); data.data.amount=sent.amount; return Response.json(data)};
  try {const input=sale(); input.items[0].quantity=5; const result=await worker.fetch(req('/api/pix',input),env); assert.equal(result.status,201); assert.equal(sent.amount,11995); } finally {globalThis.fetch=old}
});
test('wildcard accepts requests from any origin and reflects it for CORS',async()=>{
  const env=makeEnv(); env.ALLOWED_ORIGINS='*';
  const request=new Request('https://worker.example/api/pix',{method:'OPTIONS',headers:{Origin:'https://exemplo.test','Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'content-type'}});
  const result=await worker.fetch(request,env);
  assert.equal(result.status,204); assert.equal(result.headers.get('Access-Control-Allow-Origin'),'https://exemplo.test');
});
test('ambiguous upstream failure never retries the same request',async()=>{
  const env=makeEnv(), old=globalThis.fetch; let count=0; globalThis.fetch=async()=>{count++;throw Error('timeout')};
  try {assert.equal((await worker.fetch(req('/api/pix',sale()),env)).status,502);assert.equal((await worker.fetch(req('/api/pix',sale()),env)).status,409);assert.equal(count,1)} finally {globalThis.fetch=old}
});
test('order customizations are bounded, included in metadata and not retained by the durable object',async()=>{
  const env=makeEnv(), old=globalThis.fetch; let sent;
  globalThis.fetch=async(url,init)=>{sent=JSON.parse(init.body);return Response.json(response())};
  try {
    const input=sale(); input.items[0].observation='Proteínas: Costela Premium | Sem cebola'; input.customer.notes='Portão azul'; input.customer.cpfOnReceipt=false;
    const result=await worker.fetch(req('/api/pix',input),env); assert.equal(result.status,201);
    assert.deepEqual(JSON.parse(sent.metadata),{itemObservations:['Proteínas: Costela Premium | Sem cebola',''],notes:'Portão azul',cpfOnReceipt:false});
    assert.equal(sent.items[0].unitPrice,2299);
    const persisted=JSON.stringify([...env.testRecords.values()]);
    for(const privateValue of ['Maria Silva','maria@example.com','52998224725','Portão azul','Sem cebola']) assert.equal(persisted.includes(privateValue),false);
    const invalid=sale(); invalid.items[0].observation='x'.repeat(1001);
    assert.equal((await worker.fetch(req('/api/pix',invalid),makeEnv())).status,400);
    const invalidNote=sale(); invalidNote.customer.notes='x'.repeat(501);
    assert.equal((await worker.fetch(req('/api/pix',invalidNote),makeEnv())).status,400);
  } finally {globalThis.fetch=old}
});

test('Meta CAPI hashes supplied customer data and rejects unconfirmed purchases', async()=>{
  const env=makeEnv(); env.META_ACCESS_TOKEN={get:async()=> 'test-token'}; env.META_RATE_LIMITER={limit:async()=>({success:true})};
  const old=globalThis.fetch; const calls=[];
  globalThis.fetch=async(url,init)=>{calls.push({url,init}); return Response.json({events_received:1});};
  try {
    const event={event_name:'Lead',event_id:id,event_source_url:'http://127.0.0.1:5500/carrinho.html',user_data:{name:'Maria Silva',email:'MARIA@example.com',phone:'11987654321',city:'São Paulo',state:'SP',zip:'01001-000'},custom_data:{currency:'BRL',value:27.99},fbp:'fb.1.123.456'};
    const sent=await worker.fetch(req('/api/meta',event),env); assert.equal(sent.status,200);
    assert.equal(calls[0].init.headers.Authorization,'Bearer test-token');
    const payload=JSON.parse(calls[0].init.body).data[0];
    assert.equal(payload.event_id,id); assert.equal(payload.user_data.fbp,'fb.1.123.456'); assert.match(payload.user_data.em[0],/^[a-f0-9]{64}$/); assert.equal(JSON.stringify(payload).includes('MARIA@example.com'),false); assert.equal(payload.custom_data.value,27.99);
    const anonymous={...event,event_name:'PageView',user_data:{},fbp:'fb.1.123.456'};
    const skipped=await worker.fetch(req('/api/meta',anonymous),env);
    assert.equal(skipped.status,202); assert.equal(calls.length,1);
    const purchase={...event,event_name:'Purchase',requestId:id};
    assert.equal((await worker.fetch(req('/api/meta',purchase),env)).status,400); assert.equal(calls.length,1);
    assert.equal((await worker.fetch(req('/api/meta',{...event,event_source_url:'https://other.example/'}),env)).status,400);
  } finally {globalThis.fetch=old;}
});

test('webhook verifies the Blackcat payment and sends one deduplicated purchase',async()=>{
  const env=makeEnv(); env.META_ACCESS_TOKEN={get:async()=> 'test-token'}; env.META_RATE_LIMITER={limit:async()=>({success:true})};
  const old=globalThis.fetch; const calls=[];
  globalThis.fetch=async(url,init)=>{calls.push({url,init}); if(url.includes('create-sale')) return Response.json(response()); if(url.includes('/status')) return Response.json({success:true,data:{transactionId:'txn-test',status:'PAID',paymentMethod:'PIX',amount:2799}}); return Response.json({events_received:1});};
  try {
    const input=sale(); input.tracking={fbp:'fb.1.123.456'};
    assert.equal((await worker.fetch(req('/api/pix',input),env)).status,201);
    const webhook={event:'transaction.paid',status:'PAID',externalReference:id,transactionId:'txn-test'};
    const call=body=>worker.fetch(new Request('https://worker.example/api/blackcat/webhook',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),env);
    assert.equal((await call({...webhook,transactionId:'other'})).status,404);
    assert.equal((await call(webhook)).status,200); assert.equal((await call(webhook)).status,200);
    const meta=calls.filter(c=>c.url.includes('graph.facebook.com')); assert.equal(meta.length,1);
    const event=JSON.parse(meta[0].init.body).data[0]; assert.equal(event.event_id,id); assert.equal(event.event_name,'Purchase'); assert.equal(event.custom_data.value,27.99); assert.equal(event.user_data.fbp,'fb.1.123.456'); assert.match(event.user_data.em[0],/^[a-f0-9]{64}$/);
  } finally {globalThis.fetch=old;}
});
test('browser Purchase uses customer hashes stored with the paid PIX even in a new tab',async()=>{
  const env=makeEnv(),old=globalThis.fetch,calls=[];
  env.META_ACCESS_TOKEN='test-token';env.META_RATE_LIMITER={limit:async()=>({success:true})};
  globalThis.fetch=async(url,init)=>{
    if(url.includes('create-sale')) return Response.json(response());
    if(url.includes('/status')) return Response.json({success:true,data:{transactionId:'txn-test',status:'PAID',paymentMethod:'pix',amount:2799}});
    if(url.includes('graph.facebook.com')) {calls.push(JSON.parse(init.body).data[0]);return Response.json({events_received:1});}
    throw Error('Unexpected URL');
  };
  try {
    assert.equal((await worker.fetch(req('/api/pix',sale()),env)).status,201);
    const purchase={event_name:'Purchase',event_id:id,requestId:id,event_source_url:'http://127.0.0.1:5500/pagamento.html',user_data:{email:'other@example.com'},custom_data:{currency:'BRL',value:1}};
    assert.equal((await worker.fetch(req('/api/meta',purchase),env)).status,200);
    assert.equal(calls.length,1);
    assert.equal(calls[0].custom_data.value,27.99);
    const stored=env.testRecords.get(id+':sale').meta.user_data;
    assert.deepEqual(calls[0].user_data,stored);
    assert.equal(calls[0].event_id,id);
    const record=env.testRecords.get(id+':sale');
    env.testRecords.set(id+':sale',{...record,meta:null});
    const skipped=await worker.fetch(req('/api/meta',purchase),env);
    assert.equal(skipped.status,202);
    assert.equal((await skipped.json()).skipped,'missing_order_customer_data');
    assert.equal(calls.length,1);
  } finally {globalThis.fetch=old;}
});
