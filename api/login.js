import { createHash, timingSafeEqual } from "node:crypto";
import { ambiente, entrarNoSupabase } from "../lib/ambiente.js";

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
const NECESSARIAS = ["CRM_USUARIO", "CRM_SENHA", "SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_EMAIL", "SUPABASE_SENHA"];

export async function POST(request) {
  const env = ambiente();
  const faltando = NECESSARIAS.filter((n) => !env[n]);
  if (faltando.length) return resposta(500, { erro: `Faltam variáveis de ambiente na Vercel: ${faltando.join(", ")}. Depois de cadastrar, faça Redeploy.` });

  const ip = (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "desconhecido";
  const t = tentativas.get(ip) || { falhas: 0, bloqueadoAte: 0 };
  if (t.bloqueadoAte > Date.now()) {
    return resposta(429, { erro: `Muitas tentativas erradas. Tente de novo em ${Math.ceil((t.bloqueadoAte - Date.now()) / 60000)} min.` });
  }

  let corpo;
  try { corpo = await request.json(); } catch { corpo = {}; }
  const usuarioCerto = iguais(String(corpo.usuario || "").trim().toLowerCase(), env.CRM_USUARIO.toLowerCase());
  const senhaCerta = iguais(String(corpo.senha || "").trim(), env.CRM_SENHA);
  if (!(usuarioCerto && senhaCerta)) {
    t.falhas += 1;
    if (t.falhas >= MAX_FALHAS) { t.falhas = 0; t.bloqueadoAte = Date.now() + BLOQUEIO_MS; }
    tentativas.set(ip, t);
    if (tentativas.size > 5000) tentativas.clear();
    await pausa(1000); // atrasa quem tenta adivinhar
    return resposta(401, { erro: "Usuário ou senha incorretos." });
  }
  tentativas.delete(ip);

  const s = await entrarNoSupabase(env);
  if (!s.ok) return resposta(500, { erro: s.erro });
  const { access_token, refresh_token, expires_in, expires_at, token_type } = s.sessao;
  return resposta(200, { access_token, refresh_token, expires_in, expires_at, token_type });
}
