import { usuarioDoCrm } from "../lib/auth.js";
import { lerModo, trocarModo } from "../lib/atendimento.js";
import { MODOS_GERAIS } from "../nucleo/negocio.js";

/** Botão de modo (/modo): quem responde durante o dia. À noite a IA responde sozinha. */
export async function GET(request) {
  const acesso = await usuarioDoCrm(request);
  if (!acesso.ok) return Response.json({ erro: acesso.mensagem }, { status: acesso.status });
  return Response.json(await lerModo(), { headers: { "cache-control": "no-store" } });
}
export async function POST(request) {
  const acesso = await usuarioDoCrm(request);
  if (!acesso.ok) return Response.json({ erro: acesso.mensagem }, { status: acesso.status });
  const { modoDia } = await request.json().catch(() => ({}));
  if (!MODOS_GERAIS[modoDia]) return Response.json({ erro: "Modo inválido." }, { status: 400 });
  return Response.json(await trocarModo(modoDia));
}
