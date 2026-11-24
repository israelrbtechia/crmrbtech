import { usuarioDoCrm } from "../lib/auth.js";
import { ambiente } from "../lib/ambiente.js";

/**
 * Áudio do cliente -> texto (ElevenLabs Speech to Text), para a IA entender.
 * O corpo da requisição é o próprio arquivo de áudio.
 */
const erro = (status, mensagem) => Response.json({ erro: mensagem }, { status, headers: { "cache-control": "no-store" } });
const EXTENSOES = { "audio/webm": "webm", "audio/ogg": "ogg", "audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/x-m4a": "m4a", "audio/wav": "wav", "audio/aac": "aac" };

export async function POST(request) {
  const env = ambiente();
  const chave = env.ELEVENLABS_API_KEY;
  if (!chave) return erro(500, "Falta ELEVENLABS_API_KEY na Vercel.");

  const acesso = await usuarioDoCrm(request);
  if (!acesso.ok) return erro(acesso.status, acesso.mensagem);

  const tipo = (request.headers.get("content-type") || "audio/webm").split(";")[0].trim();
  const dados = await request.arrayBuffer();
  if (dados.byteLength < 500) return erro(400, "Áudio vazio.");
  if (dados.byteLength > 4 * 1024 * 1024) return erro(413, "Áudio grande demais (máximo 4 MB).");

  const form = new FormData();
  form.append("model_id", env.ELEVENLABS_STT_MODEL || "scribe_v2");
  form.append("language_code", "pt");
  form.append("file", new Blob([dados], { type: tipo }), `audio.${EXTENSOES[tipo] || "webm"}`);

  const r = await fetch("https://api.elevenlabs.io/v1/speech-to-text", { method: "POST", headers: { "xi-api-key": chave }, body: form });
  if (!r.ok) {
    const detalhe = (await r.text()).slice(0, 300);
    if (r.status === 401) return erro(500, "A ElevenLabs recusou a chave (ELEVENLABS_API_KEY).");
    return erro(502, `ElevenLabs (${r.status}): ${detalhe}`);
  }
  const d = await r.json();
  return Response.json({ texto: String(d.text || "").trim(), idioma: d.language_code || "" }, { headers: { "cache-control": "no-store" } });
}
