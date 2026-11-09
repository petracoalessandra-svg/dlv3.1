import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import worker, {PixRequest} from './worker.mjs';
const id='b91c47d9-3284-4baa-981f-20e6150ce715';
function envFactory(){
 const records=new Map(),objects=new Map();const env={ALLOWED_ORIGINS:'https://site.test',VENOPAG_CLIENT_ID:'client-test',VENOPAG_CLIENT_SECRET:'secret-test',VENOPAG_WEBHOOK_SECRET:'webhook-test',VENOPAG_WEBHOOK_URL:'https://worker.test/api/venopag/webhook',PIX_RATE_LIMITER:{limit:async()=>({success:true})}};
 env.PIX_REQUESTS={idFromName:n=>n,get(n){if(!objects.has(n)){let queue=Promise.resolve();const storage={get:async k=>records.get(n+':'+k),put:async(k,v)=>records.set(n+':'+k,structuredClone(v)),delete:async k=>records.delete(n+':'+k),transaction(fn){const result=queue.then(()=>fn(this));queue=result.catch(()=>{});return result;}};objects.set(n,new PixRequest({storage},env));}return {fetch:(url,init)=>objects.get(n).fetch(new Request(url,init))}}};env.TMT_CUSTOMER_KEY='1'.repeat(64);env.PIX_STATUS_RATE_LIMITER={limit:async()=>({success:true})};env.META_RATE_LIMITER={limit:async()=>({success:true})};const kv=new Map();env.PAYMENT_SESSIONS={put:async(k,v)=>kv.set(k,v),get:async(k,t)=>t==='json'?JSON.parse(kv.get(k)||'null'):kv.get(k)};return {env,records,kv};
}
const order={requestId:id,items:[{name:'Costelinha de Porco Premium - 400g',quantity:1},{name:'Mini Pudim',quantity:1}],customer:{name:'Maria Silva',phone:'11987654321',email:'maria@example.com',cpf:'52998224725'},address:{street:'Praça da Sé',number:'12',neighborhood:'Sé',city:'São Paulo',state:'SP',cep:'01001000'}};
const request=(path,body)=>new Request('https://worker.test'+path,{method:'POST',headers:{Origin:'https://site.test','Content-Type':'application/json','CF-Connecting-IP':'192.0.2.1'},body:JSON.stringify(body)});
const createResponse={ok:true,status:'pending',amount:27.99,request_number:'veo_test',transaction_id:'txn-test',copyPaste:'000201-test',qr_img:'AAAA',expire_minutes:45};
function signed(body,secret='webhook-test',timestamp=Math.floor(Date.now()/1000)){const raw=JSON.stringify(body),signature=createHmac('sha256',secret).update(timestamp+'.'+raw).digest('hex');return new Request('https://worker.test/api/venopag/webhook?requestId='+id,{method:'POST',headers:{'X-Veno-Client-Id':'client-test','X-Veno-Event-Id':'event-1','X-Veno-Signature':`t=${timestamp},v1=${signature}`},body:raw});}
test('cria PIX em reais, preserva sessão e concilia webhook assinado e reversões',async()=>{
 const {env,records}=envFactory(),old=globalThis.fetch,calls=[];let status='pending';
 globalThis.fetch=async(url,init)=>{calls.push({url,init});return Response.json(url.endsWith('/api/cashin')?createResponse:{ok:true,status,amount:27.99,request_number:'veo_test',transaction_id:'txn-test'});};
 try{
  let response=await worker.fetch(request('/api/pix',order),env);assert.equal(response.status,201);const pix=await response.json();assert.equal(pix.amount,2799);assert.equal(pix.paymentData.qrCodeBase64,'data:image/png;base64,AAAA');
  const payload=JSON.parse(calls[0].init.body);assert.equal(payload.amount,27.99);assert.equal(payload.document,order.customer.cpf);assert.equal(new URL(payload.webhook_url).searchParams.get('requestId'),id);assert.equal(calls[0].init.headers['X-Client-Id'],'client-test');
  response=await worker.fetch(request('/api/pix',order),env);assert.equal(response.status,200);assert.equal(calls.length,1);
  const body={type:'cashin',status:'confirmed',request_number:'veo_test'};assert.equal((await worker.fetch(signed(body,'wrong'),env)).status,401);assert.equal((await worker.fetch(signed(body,'webhook-test',1),env)).status,401);assert.equal(calls.length,1);
  status='confirmed';assert.equal((await worker.fetch(signed(body),env)).status,200);assert.equal(records.get(id+':sale').response.status,'PAID');assert.match(calls[1].url,/consult-transaction\?request_number=veo_test/);
  status='refunded';assert.equal((await worker.fetch(signed(body),env)).status,200);assert.equal(records.get(id+':sale').response.status,'REFUNDED');
  status='expired';await worker.fetch(signed(body),env);assert.equal(records.get(id+':sale').response.status,'CANCELLED');status='confirmed';await worker.fetch(signed(body),env);assert.equal(records.get(id+':sale').response.status,'PAID');
 }finally{globalThis.fetch=old;}
});
test('erro de negócio HTTP 200 é recusado e timeout não gera cobrança duplicada',async()=>{
 const {env}=envFactory(),old=globalThis.fetch;let calls=0;
 try{globalThis.fetch=async()=>{calls++;return Response.json({ok:false,error:'Valor mínimo para PIX é de R$ 5,00'},{headers:{'X-App-Error-Code':'400'}})};let r=await worker.fetch(request('/api/pix',order),env);assert.equal(r.status,400);assert.match((await r.json()).error,/Valor mínimo/);
 globalThis.fetch=async()=>{calls++;throw Error('timeout')};r=await worker.fetch(request('/api/pix',order),env);assert.equal(r.status,502);r=await worker.fetch(request('/api/pix',order),env);assert.equal(r.status,409);assert.equal(calls,2);
 }finally{globalThis.fetch=old;}
});

test('Purchase usa valor e dados verificados, mesmo ID no webhook e navegador e repete envio falho',async()=>{
 const {env,records}=envFactory(),old=globalThis.fetch,meta=[];env.META_ACCESS_TOKEN='test-meta';let status='pending',metaOk=false;
 globalThis.fetch=async(url,init)=>{if(url.endsWith('/api/cashin'))return Response.json(createResponse);if(url.includes('consult-transaction'))return Response.json({ok:true,status,amount:27.99,request_number:'veo_test',transaction_id:'txn-test'});if(url.includes('graph.facebook.com')){meta.push(JSON.parse(init.body).data[0]);return new Response('{}',{status:metaOk?200:503});}throw Error('unexpected url');};
 try{
  const created=await worker.fetch(request('/api/pix',order),env);assert.equal(created.status,201);const pix=await created.json();assert.ok(pix.sessionToken);
  const body={type:'cashin',status:'confirmed',request_number:'veo_test'};status='confirmed';assert.equal((await worker.fetch(signed(body),env)).status,503);assert.equal(records.get(id+':sale').response.status,'PAID');
  metaOk=true;assert.equal((await worker.fetch(signed(body),env)).status,200);assert.equal((await worker.fetch(signed(body),env)).status,200);assert.equal(meta.length,2);
  assert.equal(meta[1].event_id,id);assert.equal(meta[1].event_name,'Purchase');assert.equal(meta[1].custom_data.value,27.99);assert.match(meta[1].user_data.em[0],/^[a-f0-9]{64}$/);
  const browser={event_name:'Purchase',event_id:id,requestId:id,event_source_url:'https://site.test/pagamento.html',custom_data:{currency:'BRL',value:1},user_data:{email:'other@example.com'}};
  assert.equal((await worker.fetch(request('/api/meta',browser),env)).status,200);assert.equal(meta[2].event_id,id);assert.equal(meta[2].custom_data.value,27.99);assert.deepEqual(meta[2].user_data,meta[1].user_data);
  status='refunded';await worker.fetch(signed(body),env);assert.equal((await worker.fetch(request('/api/meta',browser),env)).status,400);
 }finally{globalThis.fetch=old;}
});
