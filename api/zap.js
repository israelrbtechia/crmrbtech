import { usuarioDoCrm } from "../lib/auth.js";
import { ligarWebhook, statusZap, webhookStatus, ehOmni } from "../lib/zapi.js";

/** Estado do WhatsApp (GET) e cadastro automático do webhook no Omni Z-API (POST). Só logado. */
export async function GET(request) {
  const acesso = await usuarioDoCrm(request);
  if (!acesso.ok) return Response.json({ erro: acesso.mensagem }, { status: acesso.status });
  const base = new URL(request.url).origin;
  const [zap, webhook] = await Promise.all([statusZap(), ehOmni() ? webhookStatus(base) : null]);
  return Response.json({ zap, webhook }, { headers: { "cache-control": "no-store" } });
}
export async function POST(request) {
  const acesso = await usuarioDoCrm(request);
  if (!acesso.ok) return Response.json({ erro: acesso.mensagem }, { status: acesso.status });
  try {
    const base = new URL(request.url).origin;
    await ligarWebhook(base);
    return Response.json({ ok: true, webhook: await webhookStatus(base) });
  } catch (e) {
    return Response.json({ erro: e.message }, { status: 400 });
  }
}
