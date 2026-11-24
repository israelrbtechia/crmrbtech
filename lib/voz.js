import { ambiente } from "./ambiente.js";

/** Voz clonada do dono (ElevenLabs): texto -> mp3, e áudio -> texto. */
export const vozLigada = () => { const e = ambiente(); return Boolean(e.ELEVENLABS_API_KEY && e.ELEVENLABS_VOICE_ID); };

const COM_TAGS = new Set(["eleven_v4", "eleven_v3"]);
const tirarTags = (t) => String(t).replace(/\[(?!ÁUDIO\]|AUDIO\])[a-z][a-z ]{1,30}\]\s?/gi, "").replace(/[ \t]{2,}/g, " ").trim();

async function falar(env, fala, modelo) {
  const comTags = COM_TAGS.has(modelo);
  return fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(env.ELEVENLABS_VOICE_ID)}?output_format=mp3_44100_64`, {
    method: "POST",
    headers: { "xi-api-key": env.ELEVENLABS_API_KEY, "content-type": "application/json", accept: "audio/mpeg" },
    body: JSON.stringify({
      text: comTags ? fala : tirarTags(fala),
      model_id: modelo,
      // v4/v3: a emoção vem das marcações ([excited], [laughs]...); só aproxima bem da voz clonada.
      // Modelos antigos: menos estabilidade e mais estilo = mais expressivo.
      voice_settings: comTags ? { similarity_boost: 0.9 } : { stability: 0.35, similarity_boost: 0.9, style: 0.35, use_speaker_boost: true },
    }),
  });
}

/**
 * Texto -> mp3 com a voz clonada do dono. Usa o eleven_v4 (o mais expressivo, entende
 * [excited], [laughs], [warmly]...); se a conta não tiver acesso, cai para o multilingual v2.
 */
export async function gerarFala(texto) {
  const env = ambiente();
  if (!env.ELEVENLABS_API_KEY || !env.ELEVENLABS_VOICE_ID) throw new Error("Faltam ELEVENLABS_API_KEY e ELEVENLABS_VOICE_ID na Vercel.");
  const fala = String(texto || "").trim();
  if (!tirarTags(fala)) throw new Error("Sem texto para falar.");
  if (fala.length > 1500) throw new Error("Texto longo demais para um áudio (máximo 1500 letras).");
  const modelo = env.ELEVENLABS_MODEL || "eleven_v4";
  let r = await falar(env, fala, modelo);
  if (!r.ok && [400, 403, 422].includes(r.status) && modelo !== "eleven_multilingual_v2") {
    console.error(`voz: ${modelo} recusado (${r.status}): ${(await r.text()).slice(0, 200)}; usando eleven_multilingual_v2`);
    r = await falar(env, fala, "eleven_multilingual_v2");
  }
  if (!r.ok) {
    const detalhe = (await r.text()).slice(0, 300);
    if (r.status === 401) throw new Error("A ElevenLabs recusou a chave (ELEVENLABS_API_KEY).");
    if (r.status === 404) throw new Error("A ElevenLabs não achou a voz (ELEVENLABS_VOICE_ID).");
    throw new Error(`ElevenLabs (${r.status}): ${detalhe}`);
  }
  return Buffer.from(await r.arrayBuffer());
}
export const paraDataURL = (buffer, tipo = "audio/mpeg") => `data:${tipo};base64,${Buffer.from(buffer).toString("base64")}`;

const EXTENSOES = { "audio/webm": "webm", "audio/ogg": "ogg", "audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/x-m4a": "m4a", "audio/wav": "wav", "audio/aac": "aac" };
export async function transcrever(dados, tipo = "audio/ogg") {
  const env = ambiente();
  if (!env.ELEVENLABS_API_KEY) throw new Error("Falta ELEVENLABS_API_KEY na Vercel.");
  const t = String(tipo || "audio/ogg").split(";")[0].trim();
  const form = new FormData();
  form.append("model_id", env.ELEVENLABS_STT_MODEL || "scribe_v2");
  form.append("language_code", "pt");
  form.append("file", new Blob([dados], { type: t }), `audio.${EXTENSOES[t] || "ogg"}`);
  const r = await fetch("https://api.elevenlabs.io/v1/speech-to-text", { method: "POST", headers: { "xi-api-key": env.ELEVENLABS_API_KEY }, body: form });
  if (!r.ok) {
    if (r.status === 401) throw new Error("A ElevenLabs recusou a chave (ELEVENLABS_API_KEY).");
    throw new Error(`ElevenLabs (${r.status}): ${(await r.text()).slice(0, 300)}`);
  }
  const d = await r.json();
  return String(d.text || "").trim();
}
/** Baixa o áudio que o WhatsApp guardou (link da Z-API) e transcreve. */
export async function transcreverLink(url, tipo) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`não consegui baixar o áudio (${r.status})`);
  const dados = await r.arrayBuffer();
  if (dados.byteLength > 4 * 1024 * 1024) throw new Error("áudio grande demais");
  return transcrever(dados, tipo || r.headers.get("content-type") || "audio/ogg");
}
