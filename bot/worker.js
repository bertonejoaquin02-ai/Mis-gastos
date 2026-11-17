// Bot de WhatsApp para "Mis gastos" (Cloudflare Worker).
// Recibe mensajes de texto o audio por WhatsApp, entiende el gasto con Groq
// y lo deja en un buzón (KV "BUZON") hasta que la app lo trae.
//
// Necesita (Settings > Variables and Secrets del Worker):
//   WHATSAPP_TOKEN    token de acceso de Meta (secreto)
//   PHONE_NUMBER_ID   id del número del bot (lo da Meta)
//   VERIFY_TOKEN      una palabra que inventás, igual a la que ponés en Meta
//   GROQ_API_KEY      clave de Groq (secreto)
//   APP_KEY           clave que inventás para que solo tu app lea el buzón (secreto)
//   NUMEROS_PERMITIDOS  tus números, separados por coma, ej: 5491122334455
// Para Telegram: TELEGRAM_TOKEN (lo da BotFather). WhatsApp pasa a ser opcional.
// Opcionales: APP_SECRET (de Meta, para verificar firmas), GROQ_MODEL, GRAPH_VERSION.
// Binding KV: BUZON

const GRAPH = env => `https://graph.facebook.com/${env.GRAPH_VERSION || 'v24.0'}`;
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type, x-clave', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json', ...CORS } });
// Telegram solo acepta letras, números, _ y - en la palabra secreta
const tgSecreto = env => String(env.APP_KEY).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 256);
const DEFAULT_CATS = ['Hogar', 'Alimentación', 'Transporte', 'Salud', 'Salidas', 'Suscripciones', 'Otros'];

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });

    // 1) Meta verifica la dirección del webhook
    if (url.pathname === '/webhook' && req.method === 'GET') {
      if (url.searchParams.get('hub.mode') === 'subscribe' && url.searchParams.get('hub.verify_token') === env.VERIFY_TOKEN)
        return new Response(url.searchParams.get('hub.challenge'));
      return new Response('no', { status: 403 });
    }

    // 2) Llega un mensaje de WhatsApp
    if (url.pathname === '/webhook' && req.method === 'POST') {
      const raw = await req.text();
      if (env.APP_SECRET && !(await firmaOk(raw, req.headers.get('x-hub-signature-256'), env.APP_SECRET)))
        return new Response('firma', { status: 401 });
      let body; try { body = JSON.parse(raw); } catch { return new Response('ok'); }
      ctx.waitUntil(procesar(body, env).catch(e => console.error('procesar', e)));
      return new Response('ok'); // responder rápido para que Meta no reintente
    }

    // 3) La app pide los gastos nuevos (y confirma los que ya guardó)
    if (url.pathname === '/sync' && req.method === 'POST') {
      if (!env.APP_KEY || req.headers.get('x-clave') !== env.APP_KEY) return json({ error: 'clave' }, 401);
      let b = {}; try { b = await req.json(); } catch {}
      if (Array.isArray(b.categorias) && b.categorias.length)
        await env.BUZON.put('categorias', JSON.stringify(b.categorias.map(String).slice(0, 50)));
      for (const id of (b.confirmados || []).slice(0, 200)) await env.BUZON.delete('g:' + String(id));
      const list = await env.BUZON.list({ prefix: 'g:' });
      const confirmados = new Set((b.confirmados || []).map(String));
      const gastos = [];
      for (const k of list.keys) {
        const id = k.name.slice(2);
        if (confirmados.has(id)) continue;
        const v = await env.BUZON.get(k.name, 'json');
        if (v) gastos.push({ id, ...v });
      }
      return json({ gastos });
    }

    // 4) Telegram: mensajes que llegan
    if (url.pathname === '/telegram' && req.method === 'POST') {
      if (!env.APP_KEY || req.headers.get('x-telegram-bot-api-secret-token') !== tgSecreto(env)) return new Response('no', { status: 403 });
      let upd; try { upd = await req.json(); } catch { return new Response('ok'); }
      ctx.waitUntil(telegram(upd, env).catch(e => console.error('telegram', e)));
      return new Response('ok');
    }

    // 5) Telegram: conectar el bot (se abre una vez desde el navegador)
    if (url.pathname === '/telegram/conectar') {
      if (!env.APP_KEY || url.searchParams.get('clave') !== env.APP_KEY) return new Response('Clave incorrecta. Abrí: ' + url.origin + '/telegram/conectar?clave=TU_APP_KEY', { status: 401 });
      if (!env.TELEGRAM_TOKEN) return new Response('Falta la variable TELEGRAM_TOKEN en Cloudflare.', { status: 400 });
      const r = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/setWebhook`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: url.origin + '/telegram', secret_token: tgSecreto(env), allowed_updates: ['message', 'edited_message'] })
      }).then(r => r.json());
      return new Response(r.ok ? '✔ Telegram conectado. Ahora abrí tu bot en Telegram y mandale la clave (APP_KEY).' : 'Telegram dijo: ' + JSON.stringify(r), { headers: { 'content-type': 'text/plain; charset=utf-8' } });
    }

    if (url.pathname === '/') return new Response('Bot de Mis gastos funcionando ✔', { headers: { 'content-type': 'text/plain; charset=utf-8' } });
    return new Response('no encontrado', { status: 404 });
  }
};

async function procesar(body, env) {
  for (const entry of body.entry || []) for (const ch of entry.changes || []) {
    const v = ch.value || {};
    // Estado de los mensajes que manda el bot (enviado, entregado, falló y por qué)
    for (const st of v.statuses || []) {
      if (st.status === 'failed') console.error('whatsapp no entregó a', st.recipient_id, JSON.stringify(st.errors || []));
      else console.log('whatsapp estado', st.status, 'a', st.recipient_id);
    }
    for (const msg of v.messages || []) {
      const from = msg.from;
      const permitidos = String(env.NUMEROS_PERMITIDOS || '').split(',').map(s => s.replace(/\D/g, '')).filter(Boolean);
      if (!permitidos.some(p => mismoNumero(p, from))) { console.log('número no permitido', from); continue; }
      // Meta a veces manda el mismo mensaje dos veces
      if (await env.BUZON.get('visto:' + msg.id)) continue;
      await env.BUZON.put('visto:' + msg.id, '1', { expirationTtl: 86400 });

      try {
        let texto = '';
        if (msg.type === 'text') texto = msg.text?.body || '';
        else if (msg.type === 'audio') texto = await transcribir(msg.audio.id, env);
        else { await responder(env, from, 'Mandame un texto o un audio, por ejemplo: "gasté 15 mil en el súper".'); continue; }

        await atender(texto, env, r => responder(env, from, r));
      } catch (e) {
        console.error(e);
        await responder(env, from, 'Uy, no pude procesar eso. Probá de nuevo en un rato.').catch(() => {});
      }
    }
  }
}

// Lo común a WhatsApp y Telegram: entiende el texto, lo guarda en el buzón y arma la respuesta.
async function atender(texto, env, contestar) {
  const t = texto.trim().toLowerCase();
  if (['ayuda', 'hola', 'help', '?', '/start', '/ayuda'].includes(t)) return contestar(AYUDA);
  if (['borrar', 'deshacer', 'borrar último', 'borrar ultimo', '/borrar'].includes(t)) return contestar(await borrarUltimo(env));
  const cats = (await env.BUZON.get('categorias', 'json')) || DEFAULT_CATS;
  const gastos = await entender(texto, cats, env);
  if (!gastos.length) return contestar(`No encontré un gasto en "${texto}". Probá con algo como: "gasté 15 mil en el súper".`);
  const lineas = [];
  for (const g of gastos) {
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    await env.BUZON.put('g:' + id, JSON.stringify({ ...g, texto, creado: new Date().toISOString() }));
    await env.BUZON.put('ultimo', id);
    lineas.push(`• ${g.concepto}: ${pesos(g.importe)} (${g.categoria}, ${fecha(g.fecha)})`);
  }
  return contestar(`✅ Anotado:\n${lineas.join('\n')}\n\nAparece en la app la próxima vez que la abras. Si me equivoqué, escribí "borrar".`);
}

// ---------- Telegram ----------
// Seguridad: Telegram manda la palabra secreta (APP_KEY) en un encabezado, y solo
// atiende a quien se presentó una vez mandando la APP_KEY al bot.
async function telegram(upd, env) {
  const msg = upd.message || upd.edited_message;
  if (!msg?.chat) return;
  const chat = msg.chat.id, user = msg.from?.id;
  const contestar = body => tgSend(env, chat, body);
  if (await env.BUZON.get('tgvisto:' + upd.update_id)) return;
  await env.BUZON.put('tgvisto:' + upd.update_id, '1', { expirationTtl: 86400 });

  const permitido = await env.BUZON.get('tg:' + user);
  if (!permitido) {
    const txt = String(msg.text || '').replace(/^\/start\s*/, '').trim();
    if (txt && txt === env.APP_KEY) { await env.BUZON.put('tg:' + user, '1'); return contestar('🔓 Listo, ya te conozco.\n\n' + AYUDA); }
    return contestar('Hola 👋 Para usar este bot, mandame primero la clave del bot (la APP_KEY).');
  }
  try {
    let texto = msg.text || '';
    const audio = msg.voice || msg.audio;
    if (audio) texto = await tgTranscribir(audio.file_id, env);
    if (!texto) return contestar('Mandame un texto o un audio, por ejemplo: "gasté 15 mil en el súper".');
    await atender(texto, env, contestar);
  } catch (e) {
    console.error(e);
    await contestar('Uy, no pude procesar eso. Probá de nuevo en un rato.').catch(() => {});
  }
}

async function tgSend(env, chat_id, text) {
  const r = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/sendMessage`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat_id, text })
  });
  if (!r.ok) console.error('telegram send', r.status, await r.text());
}

async function tgTranscribir(fileId, env) {
  const info = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/getFile?file_id=${encodeURIComponent(fileId)}`).then(r => r.json());
  if (!info.ok) throw new Error('telegram getFile: ' + JSON.stringify(info));
  const audio = await fetch(`https://api.telegram.org/file/bot${env.TELEGRAM_TOKEN}/${info.result.file_path}`);
  if (!audio.ok) throw new Error('no bajó el audio de telegram ' + audio.status);
  return groqTranscribir(await audio.arrayBuffer(), 'audio/ogg', env);
}

const AYUDA = 'Hola 👋 Mandame tus gastos por texto o audio, por ejemplo:\n• "gasté 15 mil en el súper"\n• "nafta 30000"\n• "ayer pagué la luz 42.500"\nPodés poner varios en un mensaje. Escribí "borrar" para deshacer el último.';

async function borrarUltimo(env) {
  const id = await env.BUZON.get('ultimo');
  if (!id) return 'No tengo nada para borrar.';
  const g = await env.BUZON.get('g:' + id, 'json');
  await env.BUZON.delete('ultimo');
  if (!g) return 'Ese gasto ya está en la app. Borralo desde ahí.';
  await env.BUZON.delete('g:' + id);
  return `🗑️ Borré "${g.concepto}" de ${pesos(g.importe)}.`;
}

async function transcribir(mediaId, env) {
  const info = await fetch(`${GRAPH(env)}/${mediaId}`, { headers: { Authorization: `Bearer ${env.WHATSAPP_TOKEN}` } }).then(r => r.json());
  if (!info.url) throw new Error('sin url de audio: ' + JSON.stringify(info));
  const audio = await fetch(info.url, { headers: { Authorization: `Bearer ${env.WHATSAPP_TOKEN}` } });
  if (!audio.ok) throw new Error('no bajó el audio ' + audio.status);
  return groqTranscribir(await audio.arrayBuffer(), info.mime_type?.split(';')[0] || 'audio/ogg', env);
}

async function groqTranscribir(buf, mime, env) {
  const fd = new FormData();
  fd.append('file', new File([buf], 'audio.ogg', { type: mime }));
  fd.append('model', 'whisper-large-v3-turbo');
  fd.append('language', 'es');
  const r = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${env.GROQ_API_KEY}` }, body: fd });
  const d = await r.json();
  if (!r.ok) throw new Error('groq audio: ' + JSON.stringify(d));
  return d.text || '';
}

async function entender(texto, cats, env) {
  const hoy = hoyAR();
  const prompt = `Sos un asistente que anota gastos personales en Argentina (pesos argentinos). Hoy es ${hoy} (${diaSemana(hoy)}).
Del mensaje del usuario, extraé cada gasto. Respondé SOLO un JSON así: {"gastos":[{"concepto":"...","importe":12345.5,"categoria":"...","fecha":"AAAA-MM-DD"}]}
Reglas:
- importe: número en pesos. "15 mil" = 15000, "1,5 palos"/"un palo y medio" = 1500000, "2 lucas" = 2000, "15.000" = 15000, "1.500,50" = 1500.5.
- categoria: elegí exactamente una de esta lista: ${cats.join(', ')}. Si ninguna encaja, usá la que más se parezca a "Otros" (o la última).
- concepto: corto y claro, con mayúscula inicial (ej: "Supermercado", "Nafta", "Luz").
- fecha: hoy salvo que diga otra cosa ("ayer", "el lunes", "el 3").
- Si no hay ningún gasto con importe, devolvé {"gastos":[]}.`;
  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.GROQ_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: env.GROQ_MODEL || 'llama-3.3-70b-versatile', temperature: 0, response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: prompt }, { role: 'user', content: texto }] })
  });
  const d = await r.json();
  if (!r.ok) throw new Error('groq chat: ' + JSON.stringify(d));
  let out; try { out = JSON.parse(d.choices[0].message.content); } catch { return []; }
  return (out.gastos || []).map(g => ({
    concepto: String(g.concepto || 'Gasto').slice(0, 100),
    importe: Math.round(Number(g.importe) * 100) / 100,
    categoria: cats.includes(g.categoria) ? g.categoria : (cats.find(c => /otro/i.test(c)) || cats[cats.length - 1]),
    fecha: /^\d{4}-\d{2}-\d{2}$/.test(g.fecha || '') ? g.fecha : hoy
  })).filter(g => g.importe > 0);
}

async function responder(env, to, body) {
  // Argentina: WhatsApp avisa desde 549..., pero para responder hay que usar 54... sin el 9.
  const dest = to.startsWith('549') ? '54' + to.slice(3) : to;
  const r = await fetch(`${GRAPH(env)}/${env.PHONE_NUMBER_ID}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.WHATSAPP_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to: dest, type: 'text', text: { body } })
  });
  const txt = await r.text();
  if (!r.ok) console.error('whatsapp send', r.status, txt);
  else console.log('whatsapp enviado a', dest, txt);
}

// Compara números ignorando el 9 de celulares argentinos (549... vs 54...)
const norm = n => String(n).replace(/\D/g, '').replace(/^549/, '54');
const mismoNumero = (a, b) => norm(a) === norm(b);

async function firmaOk(raw, header, secret) {
  if (!header) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(raw));
  const hex = [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
  return header === 'sha256=' + hex;
}

function hoyAR() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
const diaSemana = s => new Date(s + 'T12:00:00Z').toLocaleDateString('es-AR', { weekday: 'long', timeZone: 'UTC' });
const pesos = n => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(n);
const fecha = s => { const [y, m, d] = s.split('-'); return `${d}/${m}`; };
