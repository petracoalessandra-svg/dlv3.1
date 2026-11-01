const test=require('node:test'), assert=require('node:assert/strict'), vm=require('node:vm'), fs=require('node:fs');
const token='b91c47d9-3284-4baa-981f-20e6150ce715.'+'a'.repeat(64);
const valid=(status='PAID')=>({status,amount:2799,expiresAt:Date.now()+86400000,serverNow:Date.now(),tmtExpiresAt:Date.now()+600000,orderReference:'EV-TEST'});
const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve()};
function app(fetch,opts={}) {
  const timers=new Map(), events={}, elements=new Map(), stored=new Map();let seq=0;
  const document={hidden:false,addEventListener:(k,f)=>events[k]=f,removeEventListener:k=>delete events[k],getElementById:id=>{if(!elements.has(id))elements.set(id,{hidden:id==='verified-order',textContent:'',value:'',listeners:{},addEventListener(k,f){this.listeners[k]=f;}});return elements.get(id)}};
  const window={PAYMENT_SESSION_ENABLED:true,PIX_API_BASE_URL:'https://worker.example',fetch,navigator:{onLine:true},location:{href:'https://shop.example/pagamento.html?cpf=123&utm_source=ad&redirect=https://bad.example',hash:'',replace:url=>window.redirects.push(url)},redirects:[],localStorage:{getItem:k=>stored.get(k),setItem:(k,v)=>{if(opts.blockStorage)throw Error();stored.set(k,v)}},setTimeout:(fn,ms)=>{timers.set(++seq,{fn,ms});return seq},clearTimeout:id=>timers.delete(id),setInterval:(fn,ms)=>{timers.set(++seq,{fn,ms});return seq},clearInterval:id=>timers.delete(id),addEventListener:(k,f)=>events[k]=f,removeEventListener:k=>delete events[k]};
  if(opts.channel)window.BroadcastChannel=opts.channel;
  const ctx=vm.createContext({window,document,URL,URLSearchParams,AbortController,Date,Math,console});vm.runInContext(fs.readFileSync('js/payment-session.js','utf8'),ctx);
  return {window,document,timers,events,ctx,elements,session:()=>window.PaymentSession.save(token,Date.now()+86400000),async next(){const entry=[...timers].find(([,v])=>v.ms!==8000);assert.ok(entry);timers.delete(entry[0]);entry[1].fn();await flush();return entry[1].ms}};
}
test('PAID redirects once to the fixed page carrying only token and allowed campaign, even with blocked storage',async()=>{
  const a=app(async()=>Response.json(valid()),{blockStorage:true});a.window.PaymentSession.start(a.session(),{amount:2799});await flush();
  assert.equal(a.window.redirects.length,1);const url=new URL(a.window.redirects[0],'https://shop.example');assert.equal(url.pathname,'/tmt.html');assert.equal(url.search,'?utm_source=ad');assert.equal(new URLSearchParams(url.hash.slice(1)).get('token'),token);assert.equal(a.timers.size,0);
});
test('paid polling fires browser Purchase and keepalive CAPI before redirect without a webhook',async()=>{
  const requests=[],pixel=[],order=[];
  const a=app(async(url,init)=>{
    if(url.endsWith('/api/meta')){requests.push({body:JSON.parse(init.body),keepalive:init.keepalive});order.push('capi');return Response.json({ok:true});}
    return Response.json(valid());
  });
  a.window.fbq=(...args)=>{pixel.push(args);if(args[1]==='Purchase')order.push('pixel');};
  a.window.crypto={randomUUID:()=> '123e4567-e89b-42d3-a456-426614174000'};
  a.window.sessionStorage={getItem:()=>null};
  vm.runInContext(fs.readFileSync('js/meta-tracking.js','utf8'),a.ctx);
  a.window.location.replace=url=>{order.push('redirect');a.window.redirects.push(url);};
  a.window.PaymentSession.start(a.session(),{amount:2799});await flush();
  const purchase=pixel.filter(args=>args[1]==='Purchase');assert.equal(purchase.length,1);
  assert.equal(purchase[0][2].value,27.99);assert.equal(purchase[0][2].currency,'BRL');assert.equal(purchase[0][3].eventID,token.split('.')[0]);
  const capi=requests.filter(x=>x.body.event_name==='Purchase');assert.equal(capi.length,1);assert.equal(capi[0].keepalive,true);assert.equal(capi[0].body.event_id,purchase[0][3].eventID);assert.equal(capi[0].body.requestId,token.split('.')[0]);
  assert.equal(capi[0].body.event_source_url,'https://shop.example/pagamento.html');assert.equal(JSON.stringify(capi).includes(token),false);
  assert.ok(order.indexOf('pixel')<order.indexOf('redirect'));assert.ok(order.indexOf('capi')<order.indexOf('redirect'));assert.equal(a.window.redirects.length,1);
});
test('tracking failure cannot stop redirect, and unconfirmed or mismatched payments never send Purchase',async()=>{
  const a=app(async()=>Response.json(valid()));a.window.MetaTracking={track:()=>{throw Error('blocked')}};
  a.window.PaymentSession.start(a.session());await flush();assert.equal(a.window.redirects.length,1);
  for(const [status,amount] of [['PENDING',2799],['REFUNDED',2799],['CANCELLED',2799],['PAID',100]]){
    let purchases=0;const b=app(async()=>Response.json(valid(status)));b.window.MetaTracking={track:()=>purchases++};b.window.PaymentSession.start(b.session(),{amount});await flush();assert.equal(purchases,0);assert.equal(b.window.redirects.length,0);
  }
});
test('timeouts abort in-flight fetch and sequential polling backs off then resets after recovery',async()=>{
  let calls=0, active=0,max=0;
  const a=app(async(_url,init)=>{calls++;active++;max=Math.max(active,max);try {if(calls===1) await new Promise((_,reject)=>init.signal.addEventListener('abort',()=>reject(Error('aborted'))));return Response.json(valid('PENDING'));}finally{active--;}});
  a.window.PaymentSession.start(a.session());await flush();a.events.focus();await a.next();assert.equal(calls,1);
  [...a.timers.values()].find(v=>v.ms===8000).fn();await flush();const delay=await a.next();assert.ok(delay>=12000&&delay<=13000);assert.equal(calls,2);assert.equal(max,1);const next=[...a.timers.values()].find(v=>v.ms!==8000);assert.ok(next.ms>=6000&&next.ms<=7000);
});
test('429 honors Retry-After and hidden/offline tabs resume without trusting mismatched amounts',async()=>{
  let calls=0;const a=app(async()=>{calls++;return calls===1 ? new Response('{}',{status:429,headers:{'Retry-After':'45'}}):Response.json(valid());});
  a.window.PaymentSession.start(a.session(),{amount:100});await flush();assert.ok([...a.timers.values()].some(v=>v.ms>=45000));
  a.document.hidden=true;await a.next();assert.equal(calls,1);a.document.hidden=false;a.window.navigator.onLine=false;a.events.online();await a.next();assert.equal(calls,1);a.window.navigator.onLine=true;a.events.online();await a.next();assert.equal(calls,2);assert.equal(a.window.redirects.length,0);
});
test('cross-tab checking messages defer duplicate work; broadcasts cannot assert PAID',async()=>{
  let channel,calls=0;
  class Channel{constructor(){channel=this}postMessage(){}close(){}}
  const a=app(async()=>{calls++;return Response.json(valid('PENDING'))},{channel:Channel});a.window.PaymentSession.start(a.session());await flush();channel.onmessage({data:'PAID'});assert.equal(a.window.redirects.length,0);channel.onmessage({data:'checking'});await a.next();assert.equal(calls,1);
});
test('TMT uses verified order details when available without blocking public access',async()=>{
  const deadline=Date.now()+550000;
  for(let i=0;i<2;i++) {
    const a=app(async()=>Response.json({...valid(),tmtExpiresAt:deadline}));a.window.location.hash='#token='+token;
    vm.runInContext(fs.readFileSync('js/tmt.js','utf8'),a.ctx);await flush();assert.equal(a.document.getElementById('verified-order').hidden,false);assert.equal(a.document.getElementById('order-reference').textContent,'PEDIDO EV-TEST');assert.match(a.document.getElementById('timer-text').textContent,/09:1[01]/);
  }
  for (const status of [401,409,410,503]) {
    const a=app(async()=>new Response('{}',{status}));a.window.location.hash='#token='+token;vm.runInContext(fs.readFileSync('js/tmt.js','utf8'),a.ctx);await flush();assert.equal(a.document.getElementById('verified-order').hidden,false);assert.equal(a.document.getElementById('session-message').hidden,true);assert.match(a.document.getElementById('timer-text').textContent,/10:00/);
  }
});
test('TMT opens directly without a session, API or storage and preserves the direct timer across reloads',async()=>{
  for (const blockStorage of [false,true]) {
    let requests=0;const a=app(async()=>{requests++;throw Error('offline')},{blockStorage});
    a.window.PAYMENT_SESSION_ENABLED=false;
    vm.runInContext(fs.readFileSync('js/tmt.js','utf8'),a.ctx);
    assert.equal(a.document.getElementById('verified-order').hidden,false);assert.equal(a.document.getElementById('session-message').hidden,true);assert.equal(requests,0);assert.match(a.document.getElementById('timer-text').textContent,/10:00/);
    const first=a.window.localStorage.getItem('tmt_deadline_v1:direct');
    vm.runInContext(fs.readFileSync('js/tmt.js','utf8'),a.ctx);
    assert.equal(a.window.localStorage.getItem('tmt_deadline_v1:direct'),first);
  }
  const html=fs.readFileSync('tmt.html','utf8');assert.match(html,/id="verified-order">/);assert.doesNotMatch(html,/id="verified-order" hidden/);
});
test('TMT button opens the separate payment page with the same token and campaign only',async()=>{
  const a=app(async()=>Response.json(valid()));a.window.location.hash='#token='+token;
  a.window.location.assign=url=>a.window.target=url;
  vm.runInContext(fs.readFileSync('js/tmt.js','utf8'),a.ctx);
  a.document.getElementById('tmt-pay').listeners.click();
  const url=new URL(a.window.target);assert.equal(url.pathname,'/pagamento-tmt.html');assert.equal(url.search,'?utm_source=ad');assert.equal(new URLSearchParams(url.hash.slice(1)).get('token'),token);
});
test('fee page requests server customer first, copies PIX and confirms its own Purchase without redirecting',async()=>{
  const requests=[],purchases=[],feeId='123e4567-e89b-42d3-a456-426614174000',storage=new Map();
  const a=app(async(url,init)=>{requests.push({url,body:JSON.parse(init.body)});return Response.json({feeRequestId:feeId,amount:990,status:url.endsWith('/status')?'PAID':'PENDING',paymentData:{copyPaste:'000201-fee',qrCodeBase64:'data:image/png;base64,AAAA'}});});
  a.window.location.hash='#token='+token;
  storage.set('tmt_customer:'+token.split('.')[0],JSON.stringify({customer:{name:'Maria Silva',email:'maria@example.com',phone:'11987654321',cpf:'52998224725'},expiresAt:Date.now()+60000}));
  a.window.sessionStorage={getItem:k=>storage.get(k),removeItem:k=>storage.delete(k)};
  a.window.MetaTracking={track:(...args)=>purchases.push(args)};
  let copied;a.window.navigator.clipboard={writeText:async value=>copied=value};
  vm.runInContext(fs.readFileSync('js/pagamento-tmt.js','utf8'),a.ctx);await flush();
  assert.equal(requests[0].body.customer,undefined);assert.equal(requests[0].body.token,token);assert.equal(a.document.getElementById('tmt-code').textContent,'000201-fee');assert.equal(a.document.getElementById('tmt-pix').hidden,false);
  await a.document.getElementById('tmt-copy').listeners.click();assert.equal(copied,'000201-fee');
  await a.next();assert.equal(a.document.getElementById('tmt-success').hidden,false);assert.equal(a.document.getElementById('tmt-pix').hidden,true);assert.equal(purchases.length,1);assert.equal(purchases[0][0],'Purchase');assert.equal(purchases[0][1].value,9.9);assert.equal(purchases[0][2],feeId);assert.notEqual(feeId,token.split('.')[0]);assert.equal(a.window.redirects.length,0);assert.equal(storage.size,0);
});
test('fee page asks for missing customer data and rejects an incorrect amount without displaying a PIX',async()=>{
  let calls=0;
  const a=app(async()=>{calls++;return calls===1?new Response(JSON.stringify({code:'CUSTOMER_REQUIRED',error:'Confira os dados.'}),{status:400}):Response.json({feeRequestId:'123e4567-e89b-42d3-a456-426614174000',amount:1,status:'PENDING',paymentData:{copyPaste:'wrong'}});});
  a.window.location.hash='#token='+token;a.document.getElementById('tmt-pix').hidden=true;
  vm.runInContext(fs.readFileSync('js/pagamento-tmt.js','utf8'),a.ctx);await flush();assert.equal(a.document.getElementById('tmt-customer').hidden,false);
  for(const key of ['name','phone','email','cpf'])a.document.getElementById('tmt-'+key).value='value';
  a.document.getElementById('tmt-customer').listeners.submit({preventDefault(){}});await flush();assert.equal(calls,2);assert.equal(a.document.getElementById('tmt-pix').hidden,true);assert.equal(a.document.getElementById('tmt-retry').hidden,false);
});
test('fee page generates from server context without browser customer storage',async()=>{
  const requests=[];const a=app(async(url,init)=>{requests.push(JSON.parse(init.body));return Response.json({feeRequestId:'123e4567-e89b-42d3-a456-426614174000',amount:990,status:'PENDING',paymentData:{copyPaste:'server-customer-pix'}});},{blockStorage:true});
  a.window.location.hash='#token='+token;a.window.sessionStorage={getItem(){throw Error('blocked')},removeItem(){throw Error('blocked')}};
  vm.runInContext(fs.readFileSync('js/pagamento-tmt.js','utf8'),a.ctx);await flush();assert.equal(requests.length,1);assert.equal(requests[0].customer,undefined);assert.equal(requests[0].token,token);assert.equal(a.document.getElementById('tmt-customer').hidden,true);assert.equal(a.document.getElementById('tmt-code').textContent,'server-customer-pix');
});
test('fee page retains legacy browser handoff only after server requests it',async()=>{
  const requests=[],customer={name:'Maria Silva',email:'maria@example.com',phone:'11987654321',cpf:'52998224725'};
  const a=app(async(url,init)=>{const body=JSON.parse(init.body);requests.push(body);return body.customer?Response.json({feeRequestId:'123e4567-e89b-42d3-a456-426614174000',amount:990,status:'PENDING',paymentData:{copyPaste:'legacy-pix'}}):new Response(JSON.stringify({code:'CUSTOMER_REQUIRED'}),{status:400});});
  a.window.location.hash='#token='+token;a.window.sessionStorage={getItem:()=>JSON.stringify({customer,expiresAt:Date.now()+60000})};
  vm.runInContext(fs.readFileSync('js/pagamento-tmt.js','utf8'),a.ctx);await flush();assert.equal(requests.length,2);assert.equal(requests[0].customer,undefined);assert.deepEqual(requests[1].customer,customer);assert.equal(a.document.getElementById('tmt-code').textContent,'legacy-pix');assert.equal(a.document.getElementById('tmt-customer').hidden,true);
});
