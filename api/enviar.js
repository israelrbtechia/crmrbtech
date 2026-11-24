import { usuarioDoCrm } from "../lib/auth.js";
import { enviarDoCrm } from "../lib/atendimento.js";

/** O dono respondeu pelo CRM (ou aprovou uma sugestão): vai para o WhatsApp do cliente. */
export async function POST(request) {
  const acesso = await usuarioDoCrm(request);
  if (!acesso.ok) return Response.json({ erro: acesso.mensagem }, { status: acesso.status });
  const { contatoId, texto, audio } = await request.json().catch(() => ({}));
  if (!contatoId) return Response.json({ erro: "Falta o contato." }, { status: 400 });
  if (audio && !/^data:audio\/[a-z0-9.+-]+;base64,/i.test(audio)) return Response.json({ erro: "Áudio inválido." }, { status: 400 });
  try {
    return Response.json(await enviarDoCrm(String(contatoId), { texto, audio }));
  } catch (e) {
    return Response.json({ erro: e.message }, { status: 502 });
  }
}
