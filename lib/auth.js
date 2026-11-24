/**
 * Confere se quem chamou está logado no CRM (Supabase Auth).
 * O navegador manda o token da sessão no cabeçalho x-crm-sessao.
 */
import { ambiente } from "./ambiente.js";

const cache = new Map(); // token -> { ate, usuario }: evita perguntar ao Supabase a cada chamada da IA

export async function usuarioDoCrm(request) {
  const env = ambiente();
  const url = env.SUPABASE_URL;
  const chave = env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !chave) {
    return { ok: false, status: 500, mensagem: "SUPABASE_URL e SUPABASE_PUBLISHABLE_KEY não estão configuradas na Vercel." };
  }
  const token = request.headers.get("x-crm-sessao");
  if (!token) return { ok: false, status: 401, mensagem: "Entre no CRM com seu e-mail e senha." };

  let usuario = cache.get(token)?.ate > Date.now() ? cache.get(token).usuario : null;
  if (!usuario) {
    const r = await fetch(`${url}/auth/v1/user`, { headers: { apikey: chave, Authorization: `Bearer ${token}` } });
    if (!r.ok) return { ok: false, status: 401, mensagem: "Sua sessão expirou. Entre de novo no CRM." };
    usuario = await r.json();
    if (cache.size > 500) cache.clear();
    cache.set(token, { ate: Date.now() + 60_000, usuario });
  }

  const permitidos = (env.CRM_EMAILS || "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  if (permitidos.length && !permitidos.includes(String(usuario.email || "").toLowerCase())) {
    return { ok: false, status: 403, mensagem: "Este usuário não tem acesso ao CRM." };
  }
  return { ok: true, usuario };
}
