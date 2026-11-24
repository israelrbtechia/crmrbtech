import { ambiente } from "./ambiente.js";

/**
 * WhatsApp pela Z-API (conecta o número que já está no celular, lendo um QR Code).
 * Variáveis: ZAPI_INSTANCIA, ZAPI_TOKEN e, se ativou o token de segurança, ZAPI_CLIENT_TOKEN.
 */
export const zapLigado = () => { const e = ambiente(); return Boolean(e.ZAPI_INSTANCIA && e.ZAPI_TOKEN); };

async function chamar(rota, corpo) {
  const e = ambiente();
  if (!e.ZAPI_INSTANCIA || !e.ZAPI_TOKEN) throw new Error("Faltam ZAPI_INSTANCIA e ZAPI_TOKEN na Vercel.");
  const r = await fetch(`https://api.z-api.io/instances/${encodeURIComponent(e.ZAPI_INSTANCIA)}/token/${encodeURIComponent(e.ZAPI_TOKEN)}/${rota}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(e.ZAPI_CLIENT_TOKEN ? { "Client-Token": e.ZAPI_CLIENT_TOKEN } : {}) },
    body: JSON.stringify(corpo),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.error) throw new Error(`Z-API (${r.status}): ${d.error || d.message || "erro"}`);
  return { id: d.messageId || d.id || "", zaapId: d.zaapId || "" };
}
/** Pergunta à Z-API se a instância está conectada ao WhatsApp. */
export async function statusZap() {
  const e = ambiente();
  const r = await fetch(`https://api.z-api.io/instances/${encodeURIComponent(e.ZAPI_INSTANCIA)}/token/${encodeURIComponent(e.ZAPI_TOKEN)}/status`, {
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
/** "Digitando..." por alguns segundos antes de mandar, como gente. */
export const enviarTexto = (telefone, texto, segundosDigitando = 2) =>
  chamar("send-text", { phone: telefone, message: texto, delayTyping: Math.min(15, Math.max(1, segundosDigitando)) });
export const enviarAudio = (telefone, audioDataURL, segundosGravando = 2) =>
  chamar("send-audio", { phone: telefone, audio: audioDataURL, waveform: true, delayTyping: Math.min(15, Math.max(1, segundosGravando)) });

/**
 * Lê o aviso "mensagem recebida" da Z-API. Devolve null para o que não interessa
 * (grupo, canal, status, lista de transmissão, mensagens que o próprio CRM mandou).
 */
export function lerAviso(c) {
  if (!c || c.type !== "ReceivedCallback") return null;
  if (c.isGroup || c.isNewsletter || c.broadcast || c.isStatusReply) return null;
  if (c.fromApi) return null; // saiu do próprio CRM pela API
  const telefone = String(c.phone || "").trim();
  if (!telefone) return null;
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
  else if (c.reaction) return null;
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
