import { usuarioDoCrm } from "../lib/auth.js";
import { transcrever } from "../lib/voz.js";

/** Áudio do cliente -> texto (ElevenLabs Speech to Text). O corpo é o próprio arquivo de áudio. */
export async function POST(request) {
  const acesso = await usuarioDoCrm(request);
  if (!acesso.ok) return Response.json({ erro: acesso.mensagem }, { status: acesso.status });
  const dados = await request.arrayBuffer();
  if (dados.byteLength < 500) return Response.json({ erro: "Áudio vazio." }, { status: 400 });
  if (dados.byteLength > 4 * 1024 * 1024) return Response.json({ erro: "Áudio grande demais (máximo 4 MB)." }, { status: 413 });
  try {
    const texto = await transcrever(dados, request.headers.get("content-type") || "audio/webm");
    return Response.json({ texto }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return Response.json({ erro: e.message }, { status: /Falta|recusou/.test(e.message) ? 500 : 502 });
  }
}
