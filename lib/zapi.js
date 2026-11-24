import { ambiente } from "./ambiente.js";
import { marcarSaida } from "./banco.js";

/**
 * WhatsApp pela Z-API (conecta o número que já está no celular, lendo um QR Code).
 *
 * Funciona com as duas Z-API:
 * - Omni Z-API (app.omni.z-api.io): ZAPI_INSTANCIA = "ID do canal" e ZAPI_SECRET = Secret Key
 *   (menu Segurança). O token do canal é buscado sozinho; o webhook pode ser cadastrado
 *   pelo CRM (Configurações > WhatsApp).
 * - Z-API clássica (z-api.io): ZAPI_INSTANCIA, ZAPI_TOKEN e, se ativou, ZAPI_CLIENT_TOKEN.
 */
const OMNI_API = "https://api.omni.z-api.io";
const OMNI_ZAPI = "https://zapi.omni.z-api.io/channels";
const CLASSICA = "https://api.z-api.io/instances";

export const ehOmni = () => Boolean(ambiente().ZAPI_SECRET);
export const zapLigado = () => { const e = ambiente(); return Boolean(e.ZAPI_INSTANCIA && (e.ZAPI_TOKEN || e.ZAPI_SECRET)); };

const explicar = (status, d) => {
  const msg = String(d?.message || d?.error || "").trim();
  if (status === 403 && /ENTERPRISE/i.test(msg)) return "a conta do Omni não deixa a Secret Key ler o canal (só contas Enterprise): cadastre ZAPI_TOKEN (o \"Token\" do canal) na Vercel";
  if (status === 401 || /authorization invalid/i.test(msg)) return "a ZAPI_SECRET foi recusada: copie a Secret Key em Segurança no painel do Omni (não é a Public Key nem o token do canal)";
  if (status === 404 || /not found/i.test(msg)) return "canal não encontrado: confira a ZAPI_INSTANCIA (o \"ID do canal\")";
  if (/CHANNEL_DISCONNECTED|disconnected|failed to send/i.test(`${d?.subCode || ""} ${msg}`)) return "o WhatsApp está desconectado: leia o QR Code de novo no painel";
  if (/not enabled for this workspace/i.test(msg)) return "o WhatsApp Web não está liberado nesse workspace do Omni (fale com o suporte deles)";
  return `erro ${status}${msg ? `: ${msg}` : ""}`;
};

/** Chamada na API nativa do Omni (canais e webhooks). */
async function omni(caminho, { method = "GET", corpo } = {}) {
  const e = ambiente();
  const r = await fetch(`${OMNI_API}${caminho}`, {
    method,
    headers: { Authorization: `Bearer ${e.ZAPI_SECRET}`, ...(corpo ? { "content-type": "application/json" } : {}) },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const d = r.status === 204 ? {} : await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(explicar(r.status, d));
  return d;
}

let canalGuardado = null;
/** Dados do canal no Omni (token, se está conectado, número). Guarda por 5 minutos. */
async function canal({ novo = false } = {}) {
  if (!novo && canalGuardado && Date.now() - canalGuardado.em < 5 * 60e3) return canalGuardado.dados;
  const dados = await omni(`/v1/channels/${encodeURIComponent(ambiente().ZAPI_INSTANCIA)}`);
  canalGuardado = { em: Date.now(), dados };
  return dados;
}

async function chamar(rota, corpo) {
  const e = ambiente();
  if (!zapLigado()) throw new Error("Faltam ZAPI_INSTANCIA e ZAPI_SECRET (ou ZAPI_TOKEN) na Vercel.");
  let url, headers;
  if (ehOmni()) {
    let token = e.ZAPI_TOKEN;
    if (!token) {
      try { token = (await canal()).token; } catch { throw new Error("Falta ZAPI_TOKEN na Vercel: copie o \"Token\" do canal no painel do Omni."); }
    }
    if (!token) throw new Error("O Omni não informou o token do canal: cadastre ZAPI_TOKEN na Vercel.");
    url = `${OMNI_ZAPI}/${encodeURIComponent(e.ZAPI_INSTANCIA)}/token/${encodeURIComponent(token)}/${rota}`;
    headers = { Authorization: `Bearer ${e.ZAPI_SECRET}` };
  } else {
    url = `${CLASSICA}/${encodeURIComponent(e.ZAPI_INSTANCIA)}/token/${encodeURIComponent(e.ZAPI_TOKEN)}/${rota}`;
    headers = e.ZAPI_CLIENT_TOKEN ? { "Client-Token": e.ZAPI_CLIENT_TOKEN } : {};
  }
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(corpo) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || (d.error && !d.messageId && !d.id)) throw new Error(`Z-API: ${explicar(r.status, d)}`);
  return { id: d.messageId || d.id || "", zaapId: d.zaapId || "" };
}

/** Lembra o que saiu daqui (para não confundir o eco com o dono no celular) e envia. */
async function enviar(rota, telefone, marca, corpo) {
  await marcarSaida(telefone, marca).catch((e) => console.error("marcar saída:", e.message));
  return chamar(rota, corpo);
}
/** "Digitando..." por alguns segundos antes de mandar, como gente. */
export const enviarTexto = (telefone, texto, segundosDigitando = 2) =>
  enviar("send-text", telefone, texto, { phone: telefone, message: texto, delayTyping: Math.min(15, Math.max(1, segundosDigitando)) });
export const enviarAudio = (telefone, audioDataURL, segundosGravando = 2) =>
  enviar("send-audio", telefone, "[áudio]", { phone: telefone, audio: audioDataURL, waveform: true, delayTyping: Math.min(15, Math.max(1, segundosGravando)) });

/** Diz se o WhatsApp está conectado (para o diagnóstico). */
export async function statusZap() {
  const e = ambiente();
  if (ehOmni()) {
    let c;
    try { c = await canal({ novo: true }); } catch (err) {
      if (!/Enterprise/i.test(err.message)) return { ok: false, detalhe: err.message };
      // Conta sem Enterprise: não dá para ler o canal; confere pela rota de status da compatibilidade Z-API.
      if (!e.ZAPI_TOKEN) return { ok: false, detalhe: "falta ZAPI_TOKEN na Vercel: copie o \"Token\" do canal no painel do Omni (a sua conta não deixa o CRM buscar sozinho)" };
      const r = await fetch(`${OMNI_ZAPI}/${encodeURIComponent(e.ZAPI_INSTANCIA)}/token/${encodeURIComponent(e.ZAPI_TOKEN)}/status`, { headers: { Authorization: `Bearer ${e.ZAPI_SECRET}` } }).catch(() => null);
      const d = r ? await r.json().catch(() => ({})) : {};
      if (r?.ok && "connected" in d) return d.connected ? { ok: true, detalhe: "conectado" } : { ok: false, detalhe: "desconectado: leia o QR Code de novo no painel do Omni" };
      return { ok: true, detalhe: "credenciais cadastradas (a sua conta do Omni não deixa conferir a conexão por aqui: veja \"Conectado\" no painel)" };
    }
    try {
      const partes = [];
      if (c.type && c.type !== "Z_API_WHATSAPP" && c.type !== "META_WHATSAPP") return { ok: false, detalhe: `esse canal é ${c.type}, não WhatsApp` };
      const conectado = c.whatsappConnected !== false && c.phoneConnected !== false;
      partes.push(conectado ? `conectado${c.phoneNumberConnected ? ` (+${c.phoneNumberConnected})` : ""}` : "desconectado: leia o QR Code de novo no painel do Omni");
      if (c.paymentStatus === "TRIAL" && c.due) partes.push(`teste grátis até ${new Date(c.due).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}`);
      if (/CANCEL|PENDING/.test(c.paymentStatus || "")) partes.push(`assinatura: ${c.paymentStatus}`);
      return { ok: conectado, detalhe: partes.join(" · ") };
    } catch (err) { return { ok: false, detalhe: err.message }; }
  }
  const r = await fetch(`${CLASSICA}/${encodeURIComponent(e.ZAPI_INSTANCIA)}/token/${encodeURIComponent(e.ZAPI_TOKEN)}/status`, {
    headers: e.ZAPI_CLIENT_TOKEN ? { "Client-Token": e.ZAPI_CLIENT_TOKEN } : {},
  }).catch(() => null);
  if (!r) return { ok: false, detalhe: "sem resposta da Z-API" };
  const d = await r.json().catch(() => ({}));
  if (!r.ok || (d.error && !("connected" in d))) {
    const msg = String(d.error || d.message || "");
    const dica = /client-token/i.test(msg) ? " (a conta tem token de segurança: cadastre ZAPI_CLIENT_TOKEN)"
      : r.status === 404 || /instance|not found/i.test(msg) ? " (confira ZAPI_INSTANCIA e ZAPI_TOKEN)" : "";
    return { ok: false, detalhe: `erro ${r.status}${msg ? `: ${msg}` : ""}${dica}` };
  }
  if (!d.connected) return { ok: false, detalhe: `instância desconectada${d.error ? ` (${d.error})` : ""}: leia o QR Code de novo na Z-API` };
  return { ok: true, detalhe: d.smartphoneConnected === false ? "conectada (o celular parece sem internet agora)" : "conectada" };
}

/** Webhooks do canal que apontam para este CRM. */
const doCrm = (w, base) => String(w.url || "").startsWith(`${base}/api/whatsapp`);

/** Confere se o Omni já manda as mensagens para este CRM. */
export async function webhookStatus(base) {
  if (!ehOmni()) return null;
  try {
    const lista = await omni(`/v1/channels/${encodeURIComponent(ambiente().ZAPI_INSTANCIA)}/webhooks`);
    const w = (Array.isArray(lista) ? lista : []).find((x) => doCrm(x, base));
    if (!w) return { ok: false, detalhe: "o Omni ainda não manda as mensagens para o CRM: em Configurações > WhatsApp, toque em \"Ligar mensagens no CRM\"" };
    const segredo = ambiente().ZAPI_WEBHOOK_SEGREDO;
    if (!segredo || new URL(w.url).searchParams.get("chave") !== segredo) return { ok: false, detalhe: "o endereço cadastrado no Omni está com a chave antiga: toque de novo em \"Ligar mensagens no CRM\"" };
    if (w.enabled === false || w.active === false) return { ok: false, detalhe: "o webhook do CRM está desligado no Omni" };
    return { ok: true, detalhe: `ligado (formato ${w.payloadFormat || "padrão"})` };
  } catch (err) { return { ok: false, detalhe: err.message }; }
}

/**
 * Cadastra no Omni o endereço deste CRM para receber as mensagens (no formato da Z-API).
 * Troca o que já estava cadastrado para este mesmo site. Só para o Omni.
 */
export async function ligarWebhook(base) {
  const e = ambiente();
  if (!ehOmni()) throw new Error("Cadastro automático só no Omni Z-API (com ZAPI_SECRET). Na Z-API clássica, cadastre o endereço no painel.");
  if (!e.ZAPI_WEBHOOK_SEGREDO) throw new Error("Falta ZAPI_WEBHOOK_SEGREDO na Vercel.");
  const caminho = `/v1/channels/${encodeURIComponent(e.ZAPI_INSTANCIA)}/webhooks`;
  const lista = await omni(caminho);
  for (const w of (Array.isArray(lista) ? lista : []).filter((x) => doCrm(x, base))) {
    await omni(`${caminho}/${encodeURIComponent(w.id)}`, { method: "DELETE" });
  }
  const url = `${base}/api/whatsapp?chave=${encodeURIComponent(e.ZAPI_WEBHOOK_SEGREDO)}`;
  await omni(caminho, { method: "POST", corpo: { url, description: "CRMY: mensagens para a IA", events: ["MESSAGE_RECEIVED"], payloadFormat: "Z_API" } });
  return { ok: true };
}

/**
 * Lê o aviso "mensagem recebida". Aceita o formato da Z-API e o formato padrão do Omni.
 * Devolve null para o que não interessa (grupo, canal, status, lista de transmissão,
 * reação, mensagens que o próprio CRM mandou).
 */
export function lerAviso(c) {
  if (c && c.message && typeof c.message === "object" && !c.type) return lerOmni(c.message);
  if (!c || c.type !== "ReceivedCallback") return null;
  if (c.isGroup || c.isNewsletter || c.broadcast || c.isStatusReply || c.participantPhone) return null;
  if (c.fromApi) return null; // saiu do próprio CRM pela API
  const telefone = String(c.phone || "").trim();
  if (!telefone || /-group$|@g\.us$|@newsletter$|@broadcast$/.test(telefone)) return null;
  let tipo = "texto", texto = "", audioUrl = "", audioTipo = "";
  if (c.text?.message) texto = String(c.text.message);
  else if (c.audio?.audioUrl) { tipo = "audio"; audioUrl = c.audio.audioUrl; audioTipo = c.audio.mimeType || "audio/ogg"; }
  else if (c.image) texto = `[imagem]${c.image.caption ? ` ${c.image.caption}` : ""}`;
  else if (c.video) texto = `[vídeo]${c.video.caption ? ` ${c.video.caption}` : ""}`;
  else if (c.document) texto = `[documento: ${c.document.fileName || c.document.title || "arquivo"}]`;
  else if (c.location) texto = `[localização: ${c.location.address || `${c.location.latitude}, ${c.location.longitude}`}]`;
  else if (c.sticker) texto = "[figurinha]";
  else if (c.contact) texto = `[contato: ${c.contact.displayName || ""}]`;
  else if (c.buttonsResponseMessage?.message) texto = c.buttonsResponseMessage.message;
  else if (c.listResponseMessage?.message) texto = c.listResponseMessage.message;
  else return null;
  return {
    id: c.messageId || "",
    telefone,
    lid: c.chatLid || c.senderLid || "",
    conectado: String(c.connectedPhone || ""),
    deMim: Boolean(c.fromMe),
    nome: c.senderName || c.chatName || "",
    em: c.momment ? new Date(Number(c.momment)).toISOString() : new Date().toISOString(),
    tipo, texto, audioUrl, audioTipo,
  };
}

/** Formato padrão do Omni: { message: { metadata, sender, recipient, contents, attachments } }. */
function lerOmni(m) {
  const md = m.metadata || {};
  const itens = [...(m.contents || []), ...(m.attachments || [])];
  if (!itens.length || md.from_api) return null;
  if (itens.some((i) => /Callback$/.test(i.type || "") || i["@class"] === ".StateItem")) return null; // status de entrega
  if (itens.some((i) => i.internal_information?.group_id)) return null; // grupo
  const deMim = Boolean(md.from_me);
  const telefone = String((deMim ? m.recipient?.identifier : m.sender?.identifier) || "").trim();
  if (!telefone || /-group$|@g\.us$|@newsletter$|@broadcast$/.test(telefone)) return null;
  const achar = (t) => itens.find((i) => i.type === t);
  let tipo = "texto", texto = "", audioUrl = "", audioTipo = "";
  const t = achar("TEXT"), a = achar("AUDIO");
  if (t?.message) texto = String(t.message);
  else if (a?.url) { tipo = "audio"; audioUrl = a.url; audioTipo = a.mime_type || a.mimeType || "audio/ogg"; }
  else if (achar("REACTION")) return null;
  else if (achar("IMAGE")) texto = `[imagem]${achar("IMAGE").caption ? ` ${achar("IMAGE").caption}` : ""}`;
  else if (achar("VIDEO")) texto = `[vídeo]${achar("VIDEO").caption ? ` ${achar("VIDEO").caption}` : ""}`;
  else if (achar("DOCUMENT")) texto = `[documento: ${achar("DOCUMENT").file_name || achar("DOCUMENT").fileName || "arquivo"}]`;
  else if (achar("STICKER")) texto = "[figurinha]";
  else if (achar("LOCATION")) texto = "[localização]";
  else if (achar("CONTACT")) texto = "[contato]";
  else {
    const qualquer = itens.find((i) => typeof i.message === "string" && i.message.trim());
    if (!qualquer) return null;
    texto = qualquer.message;
  }
  const ehSistema = /^BARLING/i.test(String(m.sender?.identifier || ""));
  if (ehSistema && !deMim) return null;
  return {
    id: m._id || "",
    telefone,
    lid: "",
    conectado: "",
    deMim,
    nome: deMim ? "" : (m.sender?.name || ""),
    em: new Date(Number(md.moment || m.created) || Date.now()).toISOString(),
    tipo, texto, audioUrl, audioTipo,
  };
}
