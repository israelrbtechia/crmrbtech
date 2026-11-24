import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Login do CRM com usuário e senha das variáveis CRM_USUARIO e CRM_SENHA.
 * Se baterem, o servidor entra no Supabase com SUPABASE_EMAIL e SUPABASE_SENHA
 * (o usuário criado em Authentication > Users) e devolve a sessão ao navegador:
 * é ela que libera os dados (RLS) e a IA (/api/anthropic).
 */
const tentativas = new Map(); // ip -> { falhas, bloqueadoAte } (por instância do servidor)
const MAX_FALHAS = 5;
const BLOQUEIO_MS = 15 * 60 * 1000;

const hash = (s) => createHash("sha256").update(String(s), "utf8").digest();
const iguais = (a, b) => timingSafeEqual(hash(a), hash(b));
const resposta = (status, corpo) => Response.json(corpo, { status, headers: { "cache-control": "no-store" } });
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

export async function POST(request) {
  const env = {
    CRM_USUARIO: process.env.CRM_USUARIO?.trim(),
    CRM_SENHA: process.env.CRM_SENHA,
    SUPABASE_URL: process.env.SUPABASE_URL?.trim().replace(/\/+$/, ""),
    SUPABASE_PUBLISHABLE_KEY: process.env.SUPABASE_PUBLISHABLE_KEY?.trim(),
    SUPABASE_EMAIL: process.env.SUPABASE_EMAIL?.trim(),
    SUPABASE_SENHA: process.env.SUPABASE_SENHA,
  };
  const faltando = Object.entries(env).filter(([, v]) => !v).map(([k]) => k);
  if (faltando.length) return resposta(500, { erro: `Faltam variáveis de ambiente na Vercel: ${faltando.join(", ")}.` });

  const ip = (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "desconhecido";
  const t = tentativas.get(ip) || { falhas: 0, bloqueadoAte: 0 };
  if (t.bloqueadoAte > Date.now()) {
    return resposta(429, { erro: `Muitas tentativas erradas. Tente de novo em ${Math.ceil((t.bloqueadoAte - Date.now()) / 60000)} min.` });
  }

  let corpo;
  try { corpo = await request.json(); } catch { corpo = {}; }
  const certo = iguais(String(corpo.usuario || "").trim().toLowerCase(), env.CRM_USUARIO.toLowerCase()) & iguais(String(corpo.senha || ""), env.CRM_SENHA);
  if (!certo) {
    t.falhas += 1;
    if (t.falhas >= MAX_FALHAS) { t.falhas = 0; t.bloqueadoAte = Date.now() + BLOQUEIO_MS; }
    tentativas.set(ip, t);
    if (tentativas.size > 5000) tentativas.clear();
    await pausa(1000); // atrasa quem tenta adivinhar
    return resposta(401, { erro: "Usuário ou senha incorretos." });
  }
  tentativas.delete(ip);

  const r = await fetch(`${env.SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, "content-type": "application/json" },
    body: JSON.stringify({ email: env.SUPABASE_EMAIL, password: env.SUPABASE_SENHA }),
  });
  if (!r.ok) {
    return resposta(500, { erro: "O usuário do Supabase (SUPABASE_EMAIL e SUPABASE_SENHA) não conseguiu entrar. Confira em Supabase > Authentication > Users." });
  }
  const s = await r.json();
  return resposta(200, { access_token: s.access_token, refresh_token: s.refresh_token, expires_in: s.expires_in, expires_at: s.expires_at, token_type: s.token_type });
}
