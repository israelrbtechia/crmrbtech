import { usuarioDoCrm } from "../lib/auth.js";
import { processarContato } from "../lib/atendimento.js";

/** O CRM pede para a IA atender uma conversa do WhatsApp (depois de uma aprovação ou "pedir sugestão"). */
export async function POST(request) {
  const acesso = await usuarioDoCrm(request);
  if (!acesso.ok) return Response.json({ erro: acesso.mensagem }, { status: acesso.status });
  const { contatoId, rascunho } = await request.json().catch(() => ({}));
  if (!contatoId) return Response.json({ erro: "Falta o contato." }, { status: 400 });
  try {
    const r = await processarContato(String(contatoId), { rascunho: Boolean(rascunho), forcar: true });
    if (r.erro) return Response.json(r, { status: 502 });
    return Response.json(r);
  } catch (e) {
    console.error(e);
    return Response.json({ erro: e.message }, { status: 500 });
  }
}
