import { ambiente } from "../lib/ambiente.js";
import { usuarioDoCrm } from "../lib/auth.js";
import { rotina } from "../lib/atendimento.js";

/**
 * Follow-ups e leads perdidos. Chamada pela agenda da Vercel (uma vez por dia, com CRON_SECRET),
 * pelo CRM aberto (a cada poucos minutos) ou por um agendador externo com ?chave=ZAPI_WEBHOOK_SEGREDO.
 */
async function autorizado(request) {
  const env = ambiente();
  const cron = process.env.CRON_SECRET?.trim();
  if (cron && request.headers.get("authorization") === `Bearer ${cron}`) return true;
  if (env.ZAPI_WEBHOOK_SEGREDO && new URL(request.url).searchParams.get("chave") === env.ZAPI_WEBHOOK_SEGREDO) return true;
  return (await usuarioDoCrm(request)).ok;
}
export async function GET(request) {
  if (!(await autorizado(request))) return Response.json({ erro: "não autorizado" }, { status: 401 });
  try {
    return Response.json(await rotina({ limite: 3 }));
  } catch (e) {
    console.error(e);
    return Response.json({ erro: e.message }, { status: 500 });
  }
}
export const POST = GET;
