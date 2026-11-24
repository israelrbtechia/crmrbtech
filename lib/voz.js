import { ambiente } from "./ambiente.js";

/** Voz clonada do dono (ElevenLabs): texto -> mp3, e áudio -> texto. */
export const vozLigada = () => { const e = ambiente(); return Boolean(e.ELEVENLABS_API_KEY && e.ELEVENLABS_VOICE_ID); };

export async function gerarFala(texto) {
  const env = ambiente();
  if (!env.ELEVENLABS_API_KEY || !env.ELEVENLABS_VOICE_ID) throw new Error("Faltam ELEVENLABS_API_KEY e ELEVENLABS_VOICE_ID na Vercel.");
  const fala = String(texto || "").trim();
  if (!fala) throw new Error("Sem texto para falar.");
  if (fala.length > 1500) throw new Error("Texto longo demais para um áudio (máximo 1500 letras).");
  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(env.ELEVENLABS_VOICE_ID)}?output_format=mp3_44100_64`, {
    method: "POST",
    headers: { "xi-api-key": env.ELEVENLABS_API_KEY, "content-type": "application/json", accept: "audio/mpeg" },
    body: JSON.stringify({
      text: fala,
      model_id: env.ELEVENLABS_MODEL || "eleven_multilingual_v2",
      voice_settings: { stability: 0.45, similarity_boost: 0.85, style: 0.15, use_speaker_boost: true },
    }),
  });
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
