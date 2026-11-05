(function (root) {
  'use strict';
  const el=id=>document.getElementById('delivery-fee-'+id);
  const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  let session, customer, feeId, timer, inFlight=false, polling=false, finished=false, failures=0;
  try {session=root.PaymentSession.read();} catch (_) {}
  if (!session) {el('status').textContent='Pedido não identificado';el('message').textContent='Abra esta etapa pelo link do pagamento da TMT.';return;}
  const customerKey='tmt_customer:'+session.token.split('.')[0];
  try {const cached=JSON.parse(root.sessionStorage.getItem(customerKey));if(cached && cached.expiresAt>Date.now())customer=cached.customer;} catch (_) {}
  const back=new URL('/pagamento-tmt.html',root.location.href);
  back.search=new URL(root.location.href).search;back.hash=new URLSearchParams({token:session.token}).toString();el('back').href=back.href;
  try {
    const preview=JSON.parse(root.sessionStorage.getItem('checkout_payment_preview')||'null');
    const a=preview && preview.address, c=preview && preview.customer;
    if(a && [a.street,a.number,a.city,a.state].every(v=>typeof v==='string' && v.trim())) {
      const parts=[a.street,a.number,a.neighborhood,a.city,a.state,a.cep,'Brasil'].filter(Boolean);
      el('map').src='https://maps.google.com/maps?output=embed&q='+encodeURIComponent(parts.join(', '));
      el('person').textContent=c && typeof c.name==='string'?c.name:'';
      el('address').textContent=[a.street+', '+a.number,a.neighborhood,a.city+'/'+a.state].filter(Boolean).join(' · ');
      el('map-section').hidden=false;
    }
  } catch (_) {}
  async function api(action,data={}) {
    const controller=new AbortController(),timeout=root.setTimeout(()=>controller.abort(),action==='pix'?25000:8000);
    try {
      const endpoint=new URL('/api/entrega/'+action,root.PIX_API_BASE_URL);
      if(endpoint.protocol!=='https:' && !['localhost','127.0.0.1'].includes(endpoint.hostname))throw Error('Configuração inválida.');
      const response=await root.fetch(endpoint.href,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:session.token,...data}),cache:'no-store',referrerPolicy:'no-referrer',signal:controller.signal});
      const result=await response.json();
      if(!response.ok){const error=new Error(result.error||'Não foi possível consultar o PIX.');error.code=result.code;error.status=response.status;error.retryMs=Number(response.headers.get('Retry-After'))*1000||0;throw error;}
      if(result.amount!==790 || !['PENDING','PAID','CANCELLED','REFUNDED'].includes(result.status) || !uuid.test(result.feeRequestId||'') || result.feeRequestId===session.token.split('.')[0] || (feeId && feeId!==result.feeRequestId))throw Error('Resposta de pagamento inválida.');
      feeId=result.feeRequestId;return result;
    } finally {root.clearTimeout(timeout);}
  }
  function applyStatus(result) {
    if(result.status==='PENDING'){el('status').textContent='Aguardando pagamento';return;}
    if(finished)return;
    finished=true;root.clearTimeout(timer);el('pix').hidden=true;el('customer').hidden=true;el('retry').hidden=true;el('message').textContent='';
    if(result.status==='PAID'){
      el('status').textContent='Pagamento confirmado';el('success').hidden=false;
      try {if(root.MetaTracking)root.MetaTracking.track('Purchase',{currency:'BRL',value:7.90},feeId);} catch (_) {}
      try {root.sessionStorage.removeItem(customerKey);} catch (_) {}
    } else el('status').textContent=result.status==='REFUNDED'?'Pagamento estornado':'PIX cancelado';
  }
  const schedule=delay=>{root.clearTimeout(timer);if(!finished)timer=root.setTimeout(poll,delay);};
  async function poll() {
    if(finished||polling)return;
    if(document.hidden||root.navigator.onLine===false){schedule(6000);return;}
    polling=true;let delay=6000;
    try {const result=await api('status');failures=0;el('message').textContent='';applyStatus(result);}
    catch(error){failures++;delay=Math.max(Math.min(30000,6000*2**Math.min(failures,3)),error.retryMs||0);el('message').textContent='Não foi possível atualizar o status. A verificação será repetida.';if([401,410].includes(error.status)){finished=true;el('message').textContent=error.message;}}
    finally {polling=false;schedule(delay+Math.floor(Math.random()*1001));}
  }
  async function generate() {
    if(inFlight||finished)return;inFlight=true;el('generate').disabled=true;el('retry').hidden=true;el('message').textContent='Gerando ou recuperando seu PIX…';
    try {
      let result;
      try {result=await api('pix');}
      catch(error){if(error.code==='CUSTOMER_REQUIRED' && customer)result=await api('pix',{customer});else throw error;}
      applyStatus(result);if(finished)return;
      const payment=result.paymentData,code=payment && payment.copyPaste;
      if(typeof code!=='string'||!code||code.length>4096)throw Error('Código PIX indisponível.');
      el('code').textContent=code;
      const image=payment.qrCodeBase64;
      if(typeof image==='string' && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(image) && image.length<=500000){el('qr').src=image;el('qr').hidden=false;}
      else {try {const qr=root.qrcode(0,'M');qr.addData(code,'Byte');qr.make();el('qr').src=qr.createDataURL(5,20);el('qr').hidden=false;} catch (_){el('qr').hidden=true;}}
      el('pix').hidden=false;el('customer').hidden=true;el('message').textContent='';schedule(6000);
    } catch(error) {
      el('message').textContent=error.code==='CUSTOMER_REQUIRED'?error.message:'Não foi possível confirmar a geração do PIX. Tente recuperar a mesma cobrança; se persistir, entre em contato com a loja.';
      el('status').textContent='PIX ainda não disponível';
      if(error.code==='CUSTOMER_REQUIRED'){el('customer').hidden=false;for(const key of ['name','email','phone','cpf'])if(customer && customer[key])el(key).value=customer[key];}
      else el('retry').hidden=false;
    } finally {inFlight=false;el('generate').disabled=false;}
  }
  el('customer').addEventListener('submit',event=>{event.preventDefault();customer={};for(const key of ['name','email','phone','cpf'])customer[key]=el(key).value.trim();generate();});
  el('retry').addEventListener('click',generate);
  el('copy').addEventListener('click',async()=>{try {await root.navigator.clipboard.writeText(el('code').textContent);el('copy-status').textContent='Código PIX copiado.';}catch(_){el('copy-status').textContent='Selecione o código PIX acima para copiar.';}});
  const wake=()=>{if(feeId&&!finished)schedule(0);};root.addEventListener('online',wake);root.addEventListener('focus',wake);document.addEventListener('visibilitychange',wake);
  generate();
})(window);
