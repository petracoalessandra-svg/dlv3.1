// BEGIN GENERATED PRICES - updated from js/produto-data.js by generate-catalog.cjs
export const PRICES = Object.freeze({
  "Kit Família 3 Marmitas Churrasco G": 4990,
  "Marmita Artesanal Churrasco G": 2390,
  "Marmita Artesanal Churrasco P": 1890,
  "Marmitex Grande Com Bife Milanesa": 1890,
  "Marmitex Grande de Costela Assada": 2490,
  "Marmitex Grande Com Strogonoff": 2090,
  "Marmitex Grande Bife Parmegiana": 2490,
  "Marmitex Grande Tropeiro à Mineira": 2290,
  "Queijo Coalho no Espeto": 1290,
  "Pão de Alho Caseiro": 990,
  "Marmitex Grande de Feijoada Paulista": 2790,
  "Fraldinha Especial - 400g": 3199,
  "Coxa e Sobrecoxa Premium - 400g": 1799,
  "Costela Premium - 500g": 2999,
  "Frango Assado Especial": 4899,
  "Costelinha de Porco Premium - 400g": 2299,
  "Picanha Premium - 300g": 3699,
  "Cupim Assado Especial - 400g": 3799,
  "Costela Premium - 1kg": 6499,
  "Coca-Cola 2L Normal": 990,
  "Coca-Cola 2L Zero": 990,
  "Coca-Cola Lata Normal": 690,
  "Coca-Cola Lata Zero": 690,
  "Sobremesa da Casa": 890,
  "Mini Pudim": 500
});
// END GENERATED PRICES

const API = 'https://venopagments.com/api/cashin';
const venoHeaders = env => ({'Content-Type':'application/json','X-Client-Id':env.VENOPAG_CLIENT_ID,'X-Client-Secret':env.VENOPAG_CLIENT_SECRET});
const venoStatus = value => ({pending:'PENDING',confirmed:'PAID',expired:'CANCELLED',canceled:'CANCELLED',contested:'REFUNDED',chargedback:'REFUNDED',refunded:'REFUNDED'}[value] || 'CANCELLED');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy':'no-referrer', ...headers } });
const SESSION_TTL = 86400000;
const TOKEN = /^([0-9a-f-]{36})\.([0-9a-f]{64})$/;
const hashToken = async token => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))), x => x.toString(16).padStart(2,'0')).join('');

async function paymentSession(request, env, path, cors) {
  if (!env.PAYMENT_SESSIONS || !env.PIX_STATUS_RATE_LIMITER || !env.PIX_REQUESTS) return json({error:'Sessões indisponíveis.'},503,cors);
  const limiter = ['/api/tmt/pix','/api/entrega/pix'].includes(path) ? env.PIX_RATE_LIMITER : env.PIX_STATUS_RATE_LIMITER;
  if (!limiter) return json({error:'Serviço indisponível.'},503,cors);
  const rate = await limiter.limit({key:request.headers.get('CF-Connecting-IP') || 'unknown'});
  if (!rate.success) return json({error:'Aguarde para consultar novamente.'},429,{...cors,'Retry-After':'10','Access-Control-Expose-Headers':'Retry-After'});
  try {
    const raw = await request.text();
    if (raw.length > 2048) return json({error:'Solicitação inválida.'},400,cors);
    const body = JSON.parse(raw), {token} = body, match = typeof token === 'string' && TOKEN.exec(token);
    if (!match || !UUID.test(match[1])) return json({error:'Link inválido.'},401,cors);
    const object = env.PIX_REQUESTS.get(env.PIX_REQUESTS.idFromName(match[1]));
    const kind = path.startsWith('/api/tmt/') ? 'tmt' : path.startsWith('/api/entrega/') ? 'delivery' : null;
    const response = await object.fetch('https://worker.internal/' + (kind ? 'fee' : 'session'), {method:'POST',body:JSON.stringify(kind ? {token,kind,customer:body.customer,action:path.endsWith('/status')?'status':'create',source:request.headers.get('Origin') + (kind==='tmt'?'/pagamento-tmt.html':'/taxa-entrega.html')} : {token,open:path.endsWith('/open')})});
    return new Response(response.body,{status:response.status,headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
  } catch (_) { return json({error:'Não foi possível consultar o pedido.'},503,cors); }
}
const text = (value, max) => typeof value === 'string' && value.trim().length <= max ? value.trim() : '';
function cpfValid(cpf) {
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;
  for (let n = 9; n <= 10; n++) {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += Number(cpf[i]) * (n + 1 - i);
    if ((sum * 10 % 11) % 10 !== Number(cpf[n])) return false;
  }
  return true;
}
function saleFromInput(input) {
  if (!input || !UUID.test(input.requestId || '') || !Array.isArray(input.items) || !input.items.length || input.items.length > 50) throw Error('Dados do pedido inválidos.');
  let amount = 0;
  const itemNotes = [];
  const items = input.items.map(item => {
    if (!item || typeof item.name !== 'string' || !Object.hasOwn(PRICES, item.name) || !Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 99) throw Error('Produto ou quantidade inválidos.');
    if (item.observation !== undefined && (typeof item.observation !== 'string' || item.observation.length > 1000)) throw Error('Observação do item inválida.');
    itemNotes.push(typeof item.observation === 'string' ? item.observation.trim() : '');
    const unitPrice = PRICES[item.name];
    amount += unitPrice * item.quantity;
    return { title: item.name, quantity: item.quantity, unitPrice, tangible: true };
  });
  if (!Number.isSafeInteger(amount) || amount <= 0) throw Error('Valor do pedido inválido.');
  const c = input.customer || {}, a = input.address || {};
  if (c.notes !== undefined && (typeof c.notes !== 'string' || c.notes.length > 500)) throw Error('Observação do pedido inválida.');
  if (c.cpfOnReceipt !== undefined && typeof c.cpfOnReceipt !== 'boolean') throw Error('Opção de CPF na nota inválida.');
  const name = text(c.name, 120), email = text(c.email, 254), phone = text(c.phone, 20).replace(/\D/g, ''), cpf = text(c.cpf, 20).replace(/\D/g, '');
  const street = text(a.street, 150), number = text(a.number, 30), neighborhood = text(a.neighborhood, 100), city = text(a.city, 100), state = text(a.state, 2).toUpperCase(), zipCode = text(a.cep, 10).replace(/\D/g, ''), complement = text(a.complement || '', 120);
  if (name.split(/\s+/).length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !/^\d{10,11}$/.test(phone) || !cpfValid(cpf)) throw Error('Confira nome, e-mail, telefone e CPF.');
  if (!street || !number || !neighborhood || !city || !/^[A-Z]{2}$/.test(state) || !/^\d{8}$/.test(zipCode)) throw Error('Confira os campos de endereço, incluindo o bairro.');
  const metadata = JSON.stringify({ itemObservations: itemNotes, notes: c.notes ? c.notes.trim() : '', cpfOnReceipt: c.cpfOnReceipt === true });
  if (new TextEncoder().encode(metadata).length > 12000) throw Error('Observações muito longas.');
  return { amount, currency: 'BRL', paymentMethod: 'pix', items, customer: { name, email, phone, document: { number: cpf, type: 'cpf' } }, shipping: { name, street, number, complement, neighborhood, city, state, zipCode }, metadata, externalRef: input.requestId };
}
function allowedOrigin(request, env) {
  const origin = request.headers.get('Origin');
  const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map(x => x.trim()).filter(Boolean);
  return origin && (allowed.includes('*') || allowed.includes(origin)) ? origin : '';
}

async function petRegistration(request, env, cors) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY || !env.PIX_RATE_LIMITER) return json({error:'Cadastro do pet não configurado.'},503,cors);
  const rate = await env.PIX_RATE_LIMITER.limit({key:request.headers.get('CF-Connecting-IP') || 'unknown'});
  if (!rate.success) return json({error:'Muitas solicitações. Tente novamente mais tarde.'},429,cors);
  let input;
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).length > 4096) return json({error:'Solicitação muito grande.'},413,cors);
    input = JSON.parse(raw);
  } catch (_) { return json({error:'JSON inválido.'},400,cors); }
  const p = input && input.pet || {}, a = input && input.address || {};
  const identificationNumber = text(p.identificationNumber,23);
  const vaccinationIdentity = text(p.vaccinationIdentity,14);
  const name = text(p.name,120).toLocaleUpperCase('pt-BR');
  const identificationDigits = identificationNumber.replace(/\D/g,'');
  const formattedIdentification = (identificationDigits.match(/.{1,4}/g) || []).join(' ');
  const pet = {
    identification_number:identificationDigits, name,
    vaccination_expiry:text(p.vaccinationExpiry,7), code:text(p.code,3),
    vaccination_identity:vaccinationIdentity.replace(/\D/g,'')
  };
  const address = {
    cep:text(a.cep,9), street:text(a.street,160), neighborhood:text(a.neighborhood,120),
    city:text(a.city,120), state:text(a.state,2).toUpperCase(), number:text(a.number,30),
    complement:text(a.complement || '',120)
  };
  if (!input || !UUID.test(input.requestId || '') || !Number.isInteger(input.installments) || input.installments < 1 || input.installments > 6
    || identificationDigits.length < 13 || identificationDigits.length > 19 || identificationNumber !== formattedIdentification
    || !/^[\p{L}]+(?: [\p{L}]+)*$/u.test(name) || (name.split(' ').length < 2 && name.length < 3)
    || !/^(0[1-9]|1[0-2])\/\d{4}$/.test(pet.vaccination_expiry)
    || !/^\d{1,3}$/.test(pet.code) || !/^\d{3}\.\d{3}\.\d{3}-\d{2}$/.test(vaccinationIdentity)
    || !/^\d{5}-?\d{3}$/.test(address.cep) || !address.street || !address.neighborhood || !address.city
    || !/^[A-Z]{2}$/.test(address.state) || !address.number) return json({error:'Confira os dados do pet e endereço.'},400,cors);
  let endpoint;
  try {
    const base = new URL(env.SUPABASE_URL);
    if (base.protocol !== 'https:' || base.pathname !== '/' || base.search || base.hash) throw Error();
    endpoint = new URL('/rest/v1/pet_registrations?on_conflict=id',base);
  } catch (_) { return json({error:'Cadastro do pet não configurado.'},503,cors); }
  try {
    const result = await fetch(endpoint.href,{
      method:'POST',
      headers:{'Content-Type':'application/json','apikey':env.SUPABASE_SECRET_KEY,'Authorization':'Bearer '+env.SUPABASE_SECRET_KEY,'Prefer':'resolution=merge-duplicates,return=minimal'},
      body:JSON.stringify({id:input.requestId,installments:input.installments,...pet,address}),
      signal:AbortSignal.timeout(8000)
    });
    return result.ok ? json({ok:true},201,cors) : json({error:'Não foi possível salvar os dados.'},502,cors);
  } catch (_) { return json({error:'Não foi possível salvar os dados.'},503,cors); }
}

const META_PIXEL_ID = '4491668551074059';
const META_EVENTS = new Set(['PageView', 'ViewContent', 'AddToCart', 'InitiateCheckout', 'Lead', 'AddPaymentInfo', 'Purchase']);
async function metaUserData(request, body) {
  const input = body.user_data && typeof body.user_data === 'object' ? body.user_data : {};
  const normalize = value => text(value, 254).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const hash = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), b => b.toString(16).padStart(2,'0')).join('');
  const data = {};
  const name = normalize(input.name).split(/\s+/).filter(Boolean);
  const fields = {em:normalize(input.email), ph:normalize(input.phone).replace(/\D/g,''), fn:name[0] || '', ln:name.length > 1 ? name.slice(1).join(' ') : '', ct:normalize(input.city).replace(/[^a-z]/g,''), st:normalize(input.state).replace(/[^a-z]/g,''), zp:normalize(input.zip).replace(/\D/g,'')};
  if (fields.ph.length === 10 || fields.ph.length === 11) fields.ph = '55' + fields.ph;
  for (const [key,value] of Object.entries(fields)) if (value) data[key] = [await hash(value)];
  const ip = request.headers.get('CF-Connecting-IP'), ua = request.headers.get('User-Agent');
  if (ip) data.client_ip_address = ip;
  if (ua) data.client_user_agent = ua.slice(0, 1024);
  for (const key of ['fbp','fbc']) if (typeof body[key] === 'string' && /^fb\.1\.\d+\.[A-Za-z0-9_.-]{1,500}$/.test(body[key])) data[key] = body[key];
  return data;
}
function hasMetaCustomerData(data) {
  return ['em','ph','fn','ln','ct','st','zp'].some(key => Array.isArray(data?.[key]) && data[key].length > 0);
}
async function metaToken(env) {
  try { const token = typeof env.META_ACCESS_TOKEN === 'string' ? env.META_ACCESS_TOKEN : await env.META_ACCESS_TOKEN.get(); return typeof token === 'string' ? token.trim() : ''; } catch (_) { return ''; }
}
async function metaEvent(request, env, body, origin, cors) {
  if (!env.META_ACCESS_TOKEN || !env.META_RATE_LIMITER) return json({error:'Rastreamento não configurado.'}, 503, cors);
  let token;
  try { token = typeof env.META_ACCESS_TOKEN === 'string' ? env.META_ACCESS_TOKEN : await env.META_ACCESS_TOKEN.get(); }
  catch (_) { return json({error:'Rastreamento não configurado.'}, 503, cors); }
  if (typeof token !== 'string' || !token.trim()) return json({error:'Rastreamento não configurado.'}, 503, cors);
  const rate = await env.META_RATE_LIMITER.limit({key:request.headers.get('CF-Connecting-IP') || 'unknown'});
  if (!rate.success) return json({error:'Muitas solicitações.'}, 429, cors);
  if (!body || !META_EVENTS.has(body.event_name) || !UUID.test(body.event_id || '')) return json({error:'Evento inválido.'}, 400, cors);
  let source;
  try { source = new URL(body.event_source_url); if (source.origin !== origin || !['https:', 'http:'].includes(source.protocol) || source.search || source.hash) throw Error(); }
  catch (_) { return json({error:'Origem do evento inválida.'}, 400, cors); }
  let custom = body.custom_data && typeof body.custom_data === 'object' ? body.custom_data : {};
  let orderUserData = null;
  if (body.event_name === 'Purchase') {
    if (!env.PIX_REQUESTS || body.requestId !== body.event_id) return json({error:'Compra inválida.'}, 400, cors);
    const object = env.PIX_REQUESTS.get(env.PIX_REQUESTS.idFromName(body.requestId.toLowerCase()));
    const checked = await object.fetch('https://worker.internal/status', {method:'POST', headers:{'Content-Type':'application/json'}, body:'{}'});
    if (!checked.ok) return json({error:'Pagamento não confirmado.'}, 400, cors);
    const payment = await checked.json();
    if (payment.status !== 'PAID' || !Number.isSafeInteger(payment.amount) || payment.amount <= 0) return json({error:'Pagamento não confirmado.'}, 400, cors);
    custom = {currency:'BRL',value:payment.amount / 100};
    let stored;
    try { stored = await object.fetch('https://worker.internal/meta', {method:'POST'}); }
    catch (_) { return json({error:'Dados do pedido indisponíveis.'},503,cors); }
    if (!stored.ok) return json({ok:true,skipped:'missing_order_customer_data'},202,cors);
    try { orderUserData = (await stored.json()).user_data; }
    catch (_) { return json({error:'Dados do pedido indisponíveis.'},503,cors); }
  }
  const data = body.event_name === 'Purchase' ? orderUserData : await metaUserData(request, body);
  if (!hasMetaCustomerData(data)) return json({ok:true,skipped:'missing_customer_data'},202,cors);
  const safe = {};
  if (custom.currency === 'BRL') safe.currency = 'BRL';
  if (Number.isFinite(custom.value) && custom.value >= 0 && custom.value <= 1000000) safe.value = custom.value;
  if (Number.isSafeInteger(custom.num_items) && custom.num_items > 0 && custom.num_items <= 5000) safe.num_items = custom.num_items;
  if (custom.content_type === 'product') safe.content_type = 'product';
  if (Array.isArray(custom.content_ids)) safe.content_ids = custom.content_ids.filter(x => typeof x === 'string' && x.length <= 150).slice(0,50);
  if (typeof custom.content_name === 'string' && custom.content_name.length <= 150) safe.content_name = custom.content_name;
  const event = {event_name:body.event_name,event_time:Math.floor(Date.now()/1000),event_id:body.event_id,action_source:'website',event_source_url:source.href,user_data:data,custom_data:safe};
  try {
    const response = await fetch('https://graph.facebook.com/v22.0/' + META_PIXEL_ID + '/events', {method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer ' + token},body:JSON.stringify({data:[event]}),signal:AbortSignal.timeout(5000)});
    return response.ok ? json({ok:true},200,cors) : json({error:'Evento não aceito pela Meta.'},502,cors);
  } catch (_) { return json({error:'Evento indisponível.'},502,cors); }
}

async function venoWebhook(request, env) {
  if (request.method !== 'POST') return json({error:'Método não permitido.'},405);
  if (!env.VENOPAG_WEBHOOK_SECRET || !env.VENOPAG_CLIENT_ID || !env.PIX_REQUESTS) return json({error:'Serviço indisponível.'},503);
  const parts=Object.fromEntries((request.headers.get('X-Veno-Signature') || '').split(',').map(x=>x.trim().split('=')));
  const time=Number(parts.t), eventId=request.headers.get('X-Veno-Event-Id');
  if (request.headers.get('X-Veno-Client-Id') !== env.VENOPAG_CLIENT_ID || !eventId || eventId.length>200 || !/^\d+$/.test(parts.t || '') || !Number.isSafeInteger(time) || Math.abs(Date.now()/1000-time)>300 || !/^[a-f0-9]{64}$/i.test(parts.v1 || '')) return json({error:'Assinatura inválida.'},401);
  const raw=await request.text();
  if (new TextEncoder().encode(raw).length>16384) return json({error:'Solicitação muito grande.'},413);
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(env.VENOPAG_WEBHOOK_SECRET),{name:'HMAC',hash:'SHA-256'},false,['verify']);
  if (!await crypto.subtle.verify('HMAC',key,Uint8Array.from(parts.v1.match(/../g),x=>parseInt(x,16)),new TextEncoder().encode(parts.t+'.'+raw))) return json({error:'Assinatura inválida.'},401);
  let body; try {body=JSON.parse(raw);} catch (_) {return json({error:'JSON inválido.'},400);}
  const id=new URL(request.url).searchParams.get('requestId');
  if (!UUID.test(id || '') || body.type!=='cashin' || typeof body.request_number!=='string' || !body.request_number) return json({error:'Evento inválido.'},400);
  try {const object=env.PIX_REQUESTS.get(env.PIX_REQUESTS.idFromName(id.toLowerCase()));return await object.fetch('https://worker.internal/veno-webhook',{method:'POST',body:JSON.stringify({requestId:id.toLowerCase(),requestNumber:body.request_number,eventId})});} catch (_) {return json({error:'Serviço indisponível.'},503);}
}

async function blackcatWebhook(request, env) {
  if (request.method !== 'POST') return json({error:'Método não permitido.'},405);
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') || '')) return json({error:'Formato inválido.'},415);
  if (Number(request.headers.get('Content-Length')) > 16384) return json({error:'Solicitação muito grande.'},413);
  let body;
  try { const raw=await request.text(); if (new TextEncoder().encode(raw).length > 16384) return json({error:'Solicitação muito grande.'},413); body=JSON.parse(raw); } catch (_) { return json({error:'JSON inválido.'},400); }
  if (!body || body.event !== 'transaction.paid' || body.status !== 'PAID' || !UUID.test(body.externalReference || '') || typeof body.transactionId !== 'string' || !body.transactionId || body.transactionId.length > 200) return json({error:'Evento inválido.'},400);
  if (!env.PIX_REQUESTS || !env.BLACKCAT_API_KEY) return json({error:'Serviço indisponível.'},503);
  try {
    const object=env.PIX_REQUESTS.get(env.PIX_REQUESTS.idFromName(body.externalReference.toLowerCase()));
    return await object.fetch('https://worker.internal/webhook',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({transactionId:body.transactionId,requestId:body.externalReference.toLowerCase()})});
  } catch (_) { return json({error:'Serviço indisponível.'},503); }
}

export default {
  async fetch(request, env) {
    if (new URL(request.url).pathname === '/api/venopag/webhook') return venoWebhook(request, env);
    if (new URL(request.url).pathname === '/api/blackcat/webhook') return blackcatWebhook(request, env);
    const origin = allowedOrigin(request, env);
    if (!origin) return json({ error: 'Origem não autorizada.' }, 403);
    const cors = { 'Access-Control-Allow-Origin': origin, 'Vary': 'Origin', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
    const path = new URL(request.url).pathname;
    if (!['/api/pix', '/api/pix/status', '/api/pix/recover', '/api/meta', '/api/payment-session/status', '/api/payment-session/open', '/api/tmt/pix', '/api/tmt/status', '/api/entrega/pix', '/api/entrega/status', '/api/pet-registration'].includes(path)) return json({ error: 'Não encontrado.' }, 404, cors);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'POST') return json({ error: 'Método não permitido.' }, 405, cors);
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') || '')) return json({ error: 'Formato inválido.' }, 415, cors);
    if (Number(request.headers.get('Content-Length')) > 16384) return json({ error: 'Solicitação muito grande.' }, 413, cors);
    if (path === '/api/pet-registration') return petRegistration(request,env,cors);
    if (path.startsWith('/api/payment-session/') || path.startsWith('/api/tmt/') || path.startsWith('/api/entrega/')) return paymentSession(request,env,path,cors);
    if (path === '/api/meta') {
      try { const raw = await request.text(); if (new TextEncoder().encode(raw).length > 16384) return json({error:'Solicitação muito grande.'},413,cors); return await metaEvent(request, env, JSON.parse(raw), origin, cors); }
      catch (_) { return json({error:'Evento inválido.'},400,cors); }
    }
    const limiter = path === '/api/pix/status' ? (env.PIX_STATUS_RATE_LIMITER || env.PIX_RATE_LIMITER) : env.PIX_RATE_LIMITER;
    if (!limiter || !request.headers.get('CF-Connecting-IP')) return json({ error: 'Pagamento ainda não configurado.' }, 503, cors);
    const rate = await limiter.limit({ key: request.headers.get('CF-Connecting-IP') });
    if (!rate.success) return json({ error: 'Muitas solicitações. Tente novamente mais tarde.' }, 429, cors);
    let body, sale;
    try {
      const raw = await request.text();
      if (new TextEncoder().encode(raw).length > 16384) return json({ error: 'Solicitação muito grande.' }, 413, cors);
      body = JSON.parse(raw);
      if (path === '/api/pix') sale = saleFromInput(body);
      else if (!body || !UUID.test(body.requestId || '')) throw Error('Solicitação inválida.');
    } catch (error) { return json({ error: error instanceof SyntaxError ? 'JSON inválido.' : error.message }, 400, cors); }
    if (!env.PIX_REQUESTS || (path === '/api/pix' && (!env.VENOPAG_CLIENT_ID || !env.VENOPAG_CLIENT_SECRET || !env.VENOPAG_WEBHOOK_URL || !env.VENOPAG_WEBHOOK_SECRET))) return json({ error: 'Pagamento ainda não configurado.' }, 503, cors);
    const object = env.PIX_REQUESTS.get(env.PIX_REQUESTS.idFromName(body.requestId.toLowerCase()));
    try {
      const route = path === '/api/pix' ? 'create' : path === '/api/pix/status' ? 'status' : 'recover';
      let payload = sale || {};
      if (sale) {
        const c = body.customer || {}, a = body.address || {}, tracking = body.tracking || {};
        const user_data = await metaUserData(request, {user_data:{name:c.name,email:c.email,phone:c.phone,city:a.city,state:a.state,zip:a.cep},fbp:tracking.fbp,fbc:tracking.fbc});
        payload = {sale, meta:{user_data,source:origin + '/pagamento.html'}};
      }
      const response = await object.fetch('https://worker.internal/' + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (response.ok && route !== 'status' && env.PAYMENT_SESSIONS) {
        const data = await response.json();
        const session = await object.fetch('https://worker.internal/issue', {method:'POST',body:JSON.stringify({requestId:body.requestId.toLowerCase()})});
        if (session.status === 410) return json(data,response.status,cors); // Legacy/expired charges retain their original recovery contract.
        if (!session.ok) return json({error:'Cobrança criada; recupere a mesma tentativa.'},503,cors);
        return json({...data,...await session.json()},response.status,cors);
      }
      return new Response(response.body, { status: response.status, headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
    } catch (_) { return json({ error: 'Não foi possível confirmar a solicitação. Não tente novamente com outro identificador; entre em contato com a loja.' }, 503, cors); }
  }
};

export class PixRequest {
  constructor(state, env) { this.state = state; this.env = env; }
  async customerKey() {
    const secret=typeof this.env.TMT_CUSTOMER_KEY === 'string' ? this.env.TMT_CUSTOMER_KEY.trim() : '';
    if (typeof secret !== 'string' || !/^[0-9a-f]{64}$/i.test(secret)) throw Error('Customer encryption unavailable');
    if (!this.customerKeyPromise) this.customerKeyPromise=crypto.subtle.importKey('raw',Uint8Array.from(secret.match(/../g),x=>parseInt(x,16)),{name:'AES-GCM'},false,['encrypt','decrypt']);
    return this.customerKeyPromise;
  }
  async sealCustomer(customer, requestId, expiresAt) {
    const iv=crypto.getRandomValues(new Uint8Array(12));
    const bytes=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode('tmt:'+requestId)},await this.customerKey(),new TextEncoder().encode(JSON.stringify(customer)));
    const hex=value=>Array.from(new Uint8Array(value),x=>x.toString(16).padStart(2,'0')).join('');
    return {v:1,iv:hex(iv),data:hex(bytes),expiresAt};
  }
  async originalCustomer(saved) {
    const sealed=saved.tmtCustomer;
    if (!sealed || sealed.expiresAt<=Date.now()) return null;
    try {
      if (sealed.v!==1 || !/^[0-9a-f]{24}$/.test(sealed.iv) || !/^(?:[0-9a-f]{2})+$/.test(sealed.data)) throw Error('Invalid encrypted context');
      const bytes=hex=>Uint8Array.from(hex.match(/../g),x=>parseInt(x,16));
      const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(sealed.iv),additionalData:new TextEncoder().encode('tmt:'+saved.requestId)},await this.customerKey(),bytes(sealed.data));
      return JSON.parse(new TextDecoder().decode(plain));
    } catch (_) { console.log(JSON.stringify({event:'tmt_customer_read_failed'}));return null; }
  }
  async scheduleCustomerCleanup(expiresAt) {
    try { if (this.state.storage.setAlarm) await this.state.storage.setAlarm(expiresAt); }
    catch (_) { console.log(JSON.stringify({event:'tmt_customer_cleanup_schedule_failed'})); }
  }
  async fetch(request) {
    if (request.method !== 'POST') return json({ error: 'Não encontrado.' }, 404);
    if (new URL(request.url).pathname === '/issue') return this.issue(await request.json());
    if (new URL(request.url).pathname === '/session') return this.session(await request.json());
    if (new URL(request.url).pathname === '/fee') return this.fee(await request.json());
    if (new URL(request.url).pathname === '/status') return this.status();
    if (new URL(request.url).pathname === '/meta') {
      const saved = await this.state.storage.get('sale');
      return saved?.state === 'complete' && saved.meta ? json({user_data:saved.meta.user_data}) : json({error:'Dados indisponíveis.'},404);
    }
    if (new URL(request.url).pathname === '/veno-webhook') return this.venoWebhook(await request.json());
    if (new URL(request.url).pathname === '/webhook') return this.webhook(await request.json());
    if (new URL(request.url).pathname === '/recover') {
      const saved = await this.state.storage.get('sale');
      if (!saved || saved.state !== 'complete') return json({ error: 'Cobrança não disponível para recuperação.' }, 404);
      if (saved.createdAt && Date.now() >= saved.createdAt + SESSION_TTL) return json({error:'Link expirado.'},410);
      return json(saved.response);
    }
    if (new URL(request.url).pathname !== '/create') return json({ error: 'Não encontrado.' }, 404);
    const envelope = await request.json();
    const sale = envelope.sale || envelope;
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(sale)));
    const fingerprint = Array.from(new Uint8Array(digest), x => x.toString(16).padStart(2, '0')).join('');
    const result = await this.state.storage.transaction(async tx => {
      const saved = await tx.get('sale');
      if (saved) return saved;
      const record = { fingerprint, state: 'processing' };
      await tx.put('sale', record);
      return null;
    });
    if (result) {
      if (result.fingerprint !== fingerprint) return json({ error: 'Este identificador já foi usado para outro pedido.' }, 409);
      if (result.state === 'complete') return result.createdAt && Date.now() >= result.createdAt + SESSION_TTL ? json({error:'Link expirado.'},410) : json(result.response);
      return json({ error: 'A solicitação já foi iniciada. Não crie outra cobrança; entre em contato com a loja.' }, 409);
    }
    try {
      const webhook=new URL(this.env.VENOPAG_WEBHOOK_URL);
      if (webhook.protocol !== 'https:') throw Error('invalid webhook URL');
      webhook.searchParams.set('requestId',sale.externalRef);
      const response=await fetch(API,{method:'POST',headers:venoHeaders(this.env),body:JSON.stringify({amount:sale.amount/100,name:sale.customer.name,document:sale.customer.document.number,description:'Pedido '+sale.externalRef,webhook_url:webhook.href}),signal:AbortSignal.timeout(20000)});
      const data=await response.json();
      if (!data.ok) {
        const code=Number(response.headers.get('X-App-Error-Code') || response.status);
        if ([400,401,403,422].includes(code)) {await this.state.storage.delete('sale');return json({error:typeof data.error==='string'?data.error.slice(0,300):'Cobrança recusada.'},400);}
        throw Error('uncertain gateway error');
      }
      if (data.status!=='pending' || Math.round(data.amount*100)!==sale.amount || typeof data.request_number!=='string' || !data.request_number || typeof data.transaction_id!=='string' || !data.transaction_id || typeof data.copyPaste!=='string' || !data.copyPaste || data.copyPaste.length>4096 || typeof data.qr_img!=='string' || (data.qr_img && (!/^[A-Za-z0-9+/=]+$/.test(data.qr_img) || data.qr_img.length>500000))) throw Error('invalid response');
      const safe={transactionId:data.transaction_id,requestNumber:data.request_number,status:'PENDING',amount:sale.amount,paymentData:{copyPaste:data.copyPaste,qrCodeBase64:data.qr_img?'data:image/png;base64,'+data.qr_img:null,expiresAt:Number.isFinite(data.expire_minutes) && data.expire_minutes>0?new Date(Date.now()+data.expire_minutes*60000).toISOString():null}};
      const createdAt=Date.now();
      let tmtCustomer;
      if (envelope.purpose !== 'tmt') {
        try { tmtCustomer=await this.sealCustomer({name:sale.customer.name,email:sale.customer.email,phone:sale.customer.phone,cpf:sale.customer.document.number},sale.externalRef,createdAt+SESSION_TTL); }
        catch (_) { console.log(JSON.stringify({event:'tmt_customer_capture_failed'})); }
      }
      await this.state.storage.put('sale', { fingerprint, state: 'complete', response: safe, provider:'venopag', createdAt, requestId:sale.externalRef, meta: envelope.meta || null, purpose:envelope.purpose || 'order', parentRequestId:envelope.parentRequestId || null, ...(tmtCustomer ? {tmtCustomer} : {}) });
      if (tmtCustomer) await this.scheduleCustomerCleanup(tmtCustomer.expiresAt);
      return json(safe, 201);
    } catch (_) {
      await this.state.storage.put('sale', { fingerprint, state: 'uncertain' });
      return json({ error: 'Não foi possível confirmar a geração do PIX. Não repita a cobrança; entre em contato com a loja.' }, 502);
    }
  }
  async fee({token,kind='tmt',customer,action,source}) {
    if (!['tmt','delivery'].includes(kind)) return json({error:'Cobrança inválida.'},400);
    const checked=await this.session({token,open:false});
    if (!checked.ok) return checked;
    const parent=await checked.json();
    if (parent.status !== 'PAID') return json({error:'O pedido original ainda não possui pagamento confirmado.'},409);
    const saved=await this.state.storage.get('sale');
    if (saved.purpose === 'tmt') return json({error:'Pedido inválido.'},400);
    if (kind === 'delivery') {
      if (!saved.feeRequestId) return json({error:'TMT ainda não gerada.'},409);
      const tmt=this.env.PIX_REQUESTS.get(this.env.PIX_REQUESTS.idFromName(saved.feeRequestId));
      const verified=await tmt.fetch('https://worker.internal/status',{method:'POST',body:'{}'});
      if (!verified.ok) return verified;
      const payment=await verified.json();
      if (payment.status !== 'PAID' || payment.amount !== 990) return json({error:'TMT ainda não confirmada.'},409);
      const tmtRecord=await tmt.fetch('https://worker.internal/recover',{method:'POST',body:'{}'});
      if (!tmtRecord.ok || (await tmtRecord.json()).amount !== 990) return json({error:'TMT inválida.'},409);
    }
    let feeId=kind==='tmt' ? saved.feeRequestId : saved.deliveryRequestId;
    if (!feeId && action === 'status') return json({error:'PIX da TMT ainda não gerado.'},404);
    // Recover before requiring customer details: refreshes never recreate a charge.
    if (feeId) {
      const existing=this.env.PIX_REQUESTS.get(this.env.PIX_REQUESTS.idFromName(feeId));
      const response=await existing.fetch('https://worker.internal/' + (action === 'status' ? 'status' : 'recover'),{method:'POST',body:'{}'});
      if (response.ok) return json({...await response.json(),feeRequestId:feeId});
      if (response.status !== 404 || action === 'status') return response;
    }
    // The original, authenticated server record takes precedence over browser input.
    const original=await this.originalCustomer(saved);
    const c=original || customer || {};
    const name=text(c.name,120), email=text(c.email,254), phone=text(c.phone,20).replace(/\D/g,''), cpf=text(c.cpf,20).replace(/\D/g,'');
    if (name.split(/\s+/).length<2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !/^\d{10,11}$/.test(phone) || !cpfValid(cpf)) return json({error:'Confira nome, e-mail, telefone e CPF para gerar o PIX.',code:'CUSTOMER_REQUIRED'},400);
    // Preserve recovery for older orders which only have the browser handoff.
    if (!original) {
      try {
        const sealed=await this.sealCustomer({name,email,phone,cpf},saved.requestId,saved.createdAt+SESSION_TTL);
        await this.state.storage.transaction(async tx=>{const current=await tx.get('sale');if(!current.tmtCustomer) {current.tmtCustomer=sealed;await tx.put('sale',current);}});
        await this.scheduleCustomerCleanup(sealed.expiresAt);
      } catch (_) { console.log(JSON.stringify({event:'tmt_customer_capture_failed'})); }
    }
    feeId=await this.state.storage.transaction(async tx=>{
      const current=await tx.get('sale');
      const field=kind==='tmt'?'feeRequestId':'deliveryRequestId';
      if (!current[field]) {current[field]=crypto.randomUUID();await tx.put('sale',current);}
      return current[field];
    });
    const amount=kind==='tmt'?990:790;
    const title=kind==='tmt'?'Taxa de Manipulação e Transporte':'Taxa de Entrega';
    const sale={amount,currency:'BRL',paymentMethod:'pix',items:[{title,quantity:1,unitPrice:amount,tangible:false}],customer:{name,email,phone,document:{number:cpf,type:'cpf'}},metadata:JSON.stringify({purpose:kind,parentRequestId:saved.requestId,parentTransactionId:saved.response.transactionId}),externalRef:feeId};
    const object=this.env.PIX_REQUESTS.get(this.env.PIX_REQUESTS.idFromName(feeId));
    const response=await object.fetch('https://worker.internal/create',{method:'POST',body:JSON.stringify({sale,purpose:kind,parentRequestId:saved.requestId,meta:saved.meta ? {...saved.meta,source} : null})});
    return response.ok ? json({...await response.json(),feeRequestId:feeId},response.status) : response;
  }
  async issue({requestId}) {
    const saved = await this.state.storage.get('sale');
    if (!saved || saved.state !== 'complete') return json({error:'Pedido indisponível.'},404);
    const expiresAt = (saved.createdAt || 0) + SESSION_TTL;
    if (expiresAt <= Date.now()) return json({error:'Link expirado.'},410);
    const token = requestId + '.' + Array.from(crypto.getRandomValues(new Uint8Array(32)),x=>x.toString(16).padStart(2,'0')).join('');
    const hash = await hashToken(token);
    // Only hashes are persisted. Recovered requests receive a new capability.
    await this.state.storage.put('session:' + hash,{requestId,expiresAt});
    if (this.state.storage.setAlarm) await this.state.storage.setAlarm(expiresAt);
    await this.env.PAYMENT_SESSIONS.put('context:' + hash,JSON.stringify({requestId,expiresAt,amount:saved.response.amount}),{expiration:Math.ceil(expiresAt/1000)});
    return json({sessionToken:token,sessionExpiresAt:expiresAt});
  }
  async alarm() {
    const sessions=await this.state.storage.list({prefix:'session:'});
    for (const [key,value] of sessions) if (value.expiresAt <= Date.now()) await this.state.storage.delete(key);
    await this.state.storage.transaction(async tx=>{
      const saved=await tx.get('sale');
      if (saved && saved.tmtCustomer && saved.tmtCustomer.expiresAt<=Date.now()) {delete saved.tmtCustomer;await tx.put('sale',saved);}
    });
  }
  async mirror(saved) {
    if (!this.env.PAYMENT_SESSIONS || !saved.createdAt || Date.now() >= saved.createdAt + SESSION_TTL) return;
    const options = {expiration:Math.ceil((saved.createdAt + SESSION_TTL)/1000)};
    const status = saved.response.status;
    const key = status === 'PAID' ? 'paid:' : status === 'REFUNDED' || status === 'CANCELLED' ? 'terminal:' : null;
    const marker = 'kvMirrored' + status;
    if (key && !saved[marker]) {
      await this.env.PAYMENT_SESSIONS.put(key + saved.requestId,JSON.stringify({status,amount:saved.response.amount,paidAt:saved.paidAt || null}),options);
      await this.state.storage.transaction(async tx=>{const current=await tx.get('sale');current[marker]=true;await tx.put('sale',current);});
    }
  }
  async session({token,open}) {
    const hash = await hashToken(token);
    // KV may not yet have propagated, so authorization also checks the DO hash.
    let context;
    try { context = await this.env.PAYMENT_SESSIONS.get('context:' + hash,'json'); } catch (_) {}
    context = context || await this.state.storage.get('session:' + hash);
    if (!context) return json({error:'Link inválido.'},401);
    if (context.expiresAt <= Date.now()) return json({error:'Link expirado.'},410);
    const checked = await this.status();
    if (!checked.ok) return checked;
    const payment = await checked.json();
    let saved = await this.state.storage.get('sale');
    if (!saved || saved.requestId !== context.requestId) return json({error:'Pedido inválido.'},401);
    try { await this.mirror(saved); } catch (_) { console.log(JSON.stringify({event:'payment_kv_write_failed'})); }
    if (open && payment.status !== 'PAID') return json({error:'Pagamento não confirmado.',status:payment.status},409);
    let tmtExpiresAt = saved.tmtExpiresAt || null;
    if (open) {
      tmtExpiresAt = await this.state.storage.transaction(async tx => {
        const current = await tx.get('sale');
        if (current.response.status !== 'PAID') return null;
        if (!current.tmtExpiresAt) { current.tmtExpiresAt = Date.now() + 600000; await tx.put('sale',current); console.log(JSON.stringify({event:'payment_first_open',confirmationToOpenMs:current.paidAt ? Date.now()-current.paidAt : null})); }
        return current.tmtExpiresAt;
      });
      if (!tmtExpiresAt) return json({error:'Pagamento não confirmado.'},409);
      if (!saved.kvOpenedMirrored) try {
        await this.env.PAYMENT_SESSIONS.put('opened:' + context.requestId,JSON.stringify({tmtExpiresAt}),{expiration:Math.ceil(context.expiresAt/1000)});
        await this.state.storage.transaction(async tx=>{const current=await tx.get('sale');current.kvOpenedMirrored=true;await tx.put('sale',current);});
      } catch (_) {}
    }
    return json({orderReference:'EV-' + context.requestId.slice(0,8).toUpperCase(),status:payment.status,amount:payment.amount,expiresAt:context.expiresAt,pollAfterMs:6000,serverNow:Date.now(),tmtExpiresAt});
  }
  async venoWebhook(input) {
    const saved=await this.state.storage.get('sale');
    if (!saved || saved.provider!=='venopag' || saved.response.requestNumber!==input.requestNumber) return json({error:'Transação desconhecida.'},404);
    const result=await this.venoReconcile(saved);
    if (!result.ok) return result;
    const data=await result.json();
    if (data.status!=='PAID') return json({ok:true});
    const current=await this.state.storage.get('sale');
    if (current.metaPurchaseSent) return json({ok:true});
    const token=await metaToken(this.env);
    if (!token || !current.meta || !hasMetaCustomerData(current.meta.user_data)) return json({ok:true});
    const send=await this.state.storage.transaction(async tx=>{const r=await tx.get('sale');if(r.metaPurchaseSent || r.metaSendingUntil>Date.now())return false;r.metaSendingUntil=Date.now()+10000;await tx.put('sale',r);return true;});
    if (!send) return json({error:'Rastreamento em processamento.'},503);
    try {
      const event={event_name:'Purchase',event_time:Math.floor(Date.now()/1000),event_id:input.requestId,action_source:'website',event_source_url:current.meta.source,user_data:current.meta.user_data,custom_data:{currency:'BRL',value:current.response.amount/100}};
      const sent=await fetch('https://graph.facebook.com/v22.0/'+META_PIXEL_ID+'/events',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},body:JSON.stringify({data:[event]}),signal:AbortSignal.timeout(3500)});
      if (!sent.ok) throw Error('Meta unavailable');
      await this.state.storage.transaction(async tx=>{const r=await tx.get('sale');r.metaPurchaseSent=true;r.metaSendingUntil=0;await tx.put('sale',r);});return json({ok:true});
    } catch (_) {await this.state.storage.transaction(async tx=>{const r=await tx.get('sale');r.metaSendingUntil=0;await tx.put('sale',r);});return json({error:'Envio à Meta indisponível.'},503);}
  }
  async venoReconcile(saved) {
    try {
      const url=new URL('https://venopagments.com/api/consult-transaction');url.searchParams.set('request_number',saved.response.requestNumber);
      const response=await fetch(url.href,{headers:venoHeaders(this.env),signal:AbortSignal.timeout(15000)});const data=await response.json();
      if (!data.ok || data.request_number!==saved.response.requestNumber || data.transaction_id!==saved.response.transactionId || Math.round(data.amount*100)!==saved.response.amount || typeof data.status!=='string') throw Error('invalid response');
      const current=await this.state.storage.transaction(async tx=>{const r=await tx.get('sale');r.response.status=venoStatus(data.status);r.venoStatus=data.status;r.statusCheckedAt=Date.now();if(r.response.status==='PAID')r.paidAt ||= Date.now();await tx.put('sale',r);return r;});
      try {await this.mirror(current);} catch (_) {return json({error:'Persistência indisponível.'},503);}
      return json({status:current.response.status,amount:current.response.amount});
    } catch (_) {return json({error:'Não foi possível consultar o pagamento.'},503);}
  }
  async webhook(input) {
    const saved=await this.state.storage.get('sale');
    if (!saved || saved.state !== 'complete' || saved.response.transactionId !== input.transactionId) return json({error:'Transação desconhecida.'},404);
    if (saved.metaPurchaseSent) { try { await this.mirror(saved); return json({ok:true}); } catch (_) { return json({error:'Persistência indisponível.'},503); } }
    try {
      const check=await fetch('https://api.blackcatoficial.com/api/sales/' + encodeURIComponent(input.transactionId) + '/status',{headers:{'X-API-Key':this.env.BLACKCAT_API_KEY},signal:AbortSignal.timeout(3500)});
      const body=await check.json(), data=body && body.data;
      if (!check.ok || !body.success || !data || data.transactionId !== input.transactionId || data.amount !== saved.response.amount || String(data.paymentMethod).toLowerCase() !== 'pix') return json({error:'Pagamento não verificado.'},503);
      if (data.status !== 'PAID') return json({error:'Pagamento ainda não confirmado.'},409);
      const confirmed = await this.state.storage.transaction(async tx => {
        const current = await tx.get('sale');
        if (!['REFUNDED','CANCELLED'].includes(current.response.status)) { current.response.status='PAID'; current.paidAt ||= Date.now(); }
        await tx.put('sale',current); return current;
      });
      await this.mirror(confirmed);
      if (confirmed.response.status !== 'PAID') return json({ok:true});
      const token = await metaToken(this.env);
      if (!token || !saved.meta || !hasMetaCustomerData(saved.meta.user_data)) return json({ok:true});
      const send = await this.state.storage.transaction(async tx => {
        const current=await tx.get('sale');
        if (current.metaPurchaseSent || current.metaSendingUntil > Date.now()) return false;
        current.metaSendingUntil=Date.now()+10000;await tx.put('sale',current);return true;
      });
      if (!send) {
        const current=await this.state.storage.get('sale');
        return current.metaPurchaseSent ? json({ok:true}) : json({error:'Rastreamento em processamento.'},503,{'Retry-After':'10'});
      }
      const event={event_name:'Purchase',event_time:Math.floor(Date.now()/1000),event_id:input.requestId,action_source:'website',event_source_url:saved.meta.source,user_data:saved.meta.user_data,custom_data:{currency:'BRL',value:data.amount/100}};
      const sent=await fetch('https://graph.facebook.com/v22.0/' + META_PIXEL_ID + '/events',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},body:JSON.stringify({data:[event]}),signal:AbortSignal.timeout(3500)});
      if (!sent.ok) {
        await this.state.storage.transaction(async tx=>{const current=await tx.get('sale');current.metaSendingUntil=0;await tx.put('sale',current);});
        return json({error:'Envio à Meta indisponível.'},503);
      }
      await this.state.storage.transaction(async tx => { const current=await tx.get('sale'); current.metaPurchaseSent=true; await tx.put('sale',current); });
      return json({ok:true});
    } catch (_) { return json({error:'Verificação indisponível.'},503); }
  }
  async status() {
    const saved = await this.state.storage.get('sale');
    if (!saved || saved.state !== 'complete') return json({ error: 'Cobrança não disponível para consulta.' }, 404);
    if (saved.createdAt && Date.now() >= saved.createdAt + SESSION_TTL) return json({error:'Link expirado.'},410);
    if (saved.statusCheckedAt && Date.now() - saved.statusCheckedAt < 15000) return json({ status: saved.response.status, amount: saved.response.amount });
    if (saved.provider === 'venopag') return this.venoReconcile(saved);
    // Reservar o intervalo antes da chamada para limitar consultas simultâneas.
    const reserved = await this.state.storage.transaction(async tx => {
      const current = await tx.get('sale');
      if (current.statusCheckedAt && Date.now() - current.statusCheckedAt < 15000) return false;
      await tx.put('sale', { ...current, statusCheckedAt: Date.now() });
      return true;
    });
    if (!reserved) return json({ status: saved.response.status, amount: saved.response.amount });
    try {
      const response = await fetch('https://api.blackcatoficial.com/api/sales/' + encodeURIComponent(saved.response.transactionId) + '/status', { headers: { 'X-API-Key': this.env.BLACKCAT_API_KEY }, signal: AbortSignal.timeout(15000) });
      const body = await response.json();
      const data = body && body.data;
      if (!response.ok || !body.success || !data || data.transactionId !== saved.response.transactionId || data.amount !== saved.response.amount || String(data.paymentMethod).toLowerCase() !== 'pix' || !['PENDING', 'PAID', 'CANCELLED', 'REFUNDED'].includes(data.status)) throw Error('invalid response');
      const current = await this.state.storage.transaction(async tx => {
        const current = await tx.get('sale');
        if (!(current.response.status === 'PAID' && ['PENDING','CANCELLED'].includes(data.status)) && !(current.response.status === 'CANCELLED' && data.status === 'PENDING') && current.response.status !== 'REFUNDED') current.response.status = data.status;
        if (current.response.status === 'PAID') current.paidAt ||= Date.now();
        await tx.put('sale', current); return current;
      });
      try { await this.mirror(current); } catch (_) { console.log(JSON.stringify({event:'payment_kv_write_failed'})); }
      return json({ status: current.response.status, amount: data.amount });
    } catch (_) {
      const current=await this.state.storage.get('sale');
      if (current && ['PAID','REFUNDED','CANCELLED'].includes(current.response.status)) return json({status:current.response.status,amount:current.response.amount});
      return json({ error: 'Não foi possível consultar o pagamento. Tente novamente mais tarde.' }, 503);
    }
  }
}
