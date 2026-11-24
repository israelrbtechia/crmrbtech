import { usuarioDoCrm } from "../lib/auth.js";
import { gerarFala } from "../lib/voz.js";

/** Texto -> áudio com a voz clonada do dono (ElevenLabs). */
export async function POST(request) {
  const acesso = await usuarioDoCrm(request);
  if (!acesso.ok) return Response.json({ erro: acesso.mensagem }, { status: acesso.status });
  const { texto } = await request.json().catch(() => ({}));
  try {
    const mp3 = await gerarFala(texto);
    return new Response(mp3, { headers: { "content-type": "audio/mpeg", "cache-control": "no-store" } });
  } catch (e) {
    const status = /Sem texto|longo demais/.test(e.message) ? 400 : /Faltam|recusou a chave|não achou a voz/.test(e.message) ? 500 : 502;
    return Response.json({ erro: e.message }, { status });
  }
}
