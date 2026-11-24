import { usuarioDoCrm } from "../lib/auth.js";
import { ambiente } from "../lib/ambiente.js";

/**
 * Texto -> áudio com a voz clonada do dono (ElevenLabs).
 * Variáveis: ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID e, opcional, ELEVENLABS_MODEL.
 */
const erro = (status, mensagem) => Response.json({ erro: mensagem }, { status, headers: { "cache-control": "no-store" } });

export async function POST(request) {
  const env = ambiente();
  const chave = env.ELEVENLABS_API_KEY;
  const voz = env.ELEVENLABS_VOICE_ID;
  if (!chave || !voz) return erro(500, "Faltam ELEVENLABS_API_KEY e ELEVENLABS_VOICE_ID na Vercel.");

  const acesso = await usuarioDoCrm(request);
  if (!acesso.ok) return erro(acesso.status, acesso.mensagem);

  const { texto } = await request.json().catch(() => ({}));
  const fala = String(texto || "").trim();
  if (!fala) return erro(400, "Sem texto para falar.");
  if (fala.length > 1500) return erro(400, "Texto longo demais para um áudio (máximo 1500 letras).");

  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voz)}?output_format=mp3_44100_64`, {
    method: "POST",
    headers: { "xi-api-key": chave, "content-type": "application/json", accept: "audio/mpeg" },
    body: JSON.stringify({
      text: fala,
      model_id: env.ELEVENLABS_MODEL || "eleven_multilingual_v2",
      voice_settings: { stability: 0.45, similarity_boost: 0.85, style: 0.15, use_speaker_boost: true },
    }),
  });
  if (!r.ok) {
    const detalhe = (await r.text()).slice(0, 300);
    if (r.status === 401) return erro(500, "A ElevenLabs recusou a chave (ELEVENLABS_API_KEY).");
    if (r.status === 404) return erro(500, "A ElevenLabs não achou a voz (ELEVENLABS_VOICE_ID).");
    return erro(502, `ElevenLabs (${r.status}): ${detalhe}`);
  }
  return new Response(r.body, { headers: { "content-type": "audio/mpeg", "cache-control": "no-store" } });
}
