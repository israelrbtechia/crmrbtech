/**
 * Lê as variáveis de ambiente da Vercel já limpas: tira espaços, quebras de linha
 * e aspas coladas junto, e corrige o endereço do Supabase quando colaram o link
 * do painel ou um caminho a mais (/rest/v1, /auth/v1).
 */
const limpar = (v) => String(v ?? "").trim().replace(/^["'`]+|["'`]+$/g, "").trim();

export function urlSupabase(bruto) {
  let u = limpar(bruto);
  if (!u) return "";
  // Link do painel: https://supabase.com/dashboard/project/<ref>/...
  const painel = u.match(/supabase\.com\/dashboard\/project\/([a-z0-9]{10,})/i);
  if (painel) return `https://${painel[1].toLowerCase()}.supabase.co`;
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  try {
    const url = new URL(u);
    return `${url.protocol}//${url.host}`.toLowerCase(); // sem /rest/v1, /auth/v1, barra no fim...
  } catch {
    return u;
  }
}

export function ambiente() {
  const e = (n) => limpar(process.env[n]);
  return {
    CRM_USUARIO: e("CRM_USUARIO"),
    CRM_SENHA: e("CRM_SENHA"),
    SUPABASE_URL: urlSupabase(process.env.SUPABASE_URL),
    SUPABASE_PUBLISHABLE_KEY: e("SUPABASE_PUBLISHABLE_KEY"),
    SUPABASE_EMAIL: e("SUPABASE_EMAIL"),
    SUPABASE_SENHA: e("SUPABASE_SENHA"),
    ANTHROPIC_API_KEY: e("ANTHROPIC_API_KEY"),
    GOOGLE_CLIENT_ID: e("GOOGLE_CLIENT_ID"),
    ELEVENLABS_API_KEY: e("ELEVENLABS_API_KEY"),
    ELEVENLABS_VOICE_ID: e("ELEVENLABS_VOICE_ID"),
    ELEVENLABS_MODEL: e("ELEVENLABS_MODEL"),
    ELEVENLABS_STT_MODEL: e("ELEVENLABS_STT_MODEL"),
    CRM_EMAILS: e("CRM_EMAILS"),
  };
}

/** Entra no Supabase com o usuário técnico do CRM e explica o erro em português. */
export async function entrarNoSupabase(env) {
  let r;
  try {
    r = await fetch(`${env.SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, "content-type": "application/json" },
      body: JSON.stringify({ email: env.SUPABASE_EMAIL, password: env.SUPABASE_SENHA }),
    });
  } catch {
    return { ok: false, erro: `Não encontrei o Supabase no endereço ${env.SUPABASE_URL}. Confira SUPABASE_URL: é a Project URL, no formato https://xxxx.supabase.co.` };
  }
  if (r.ok) return { ok: true, sessao: await r.json() };
  const d = await r.json().catch(() => ({}));
  const msg = String(d.msg || d.error_description || d.message || d.error || "");
  if (r.status === 404) return { ok: false, erro: `Não encontrei o Supabase no endereço ${env.SUPABASE_URL}. Confira SUPABASE_URL: é a Project URL, no formato https://xxxx.supabase.co.` };
  if (r.status === 401 || /api key|apikey|invalid.*key/i.test(msg)) return { ok: false, erro: "O Supabase recusou a chave SUPABASE_PUBLISHABLE_KEY. Copie de novo a chave publishable (ou anon public) do mesmo projeto da SUPABASE_URL." };
  if (/not confirmed/i.test(msg)) return { ok: false, erro: "O usuário do Supabase (SUPABASE_EMAIL) não está confirmado. Em Authentication > Users, confirme o usuário ou crie de novo com Auto Confirm User." };
  if (r.status === 400 || /invalid login|invalid_credentials|invalid grant/i.test(msg) || d.error_code === "invalid_credentials") return { ok: false, erro: "O Supabase recusou SUPABASE_EMAIL ou SUPABASE_SENHA. Confira o e-mail e a senha do usuário em Authentication > Users (pode redefinir a senha lá)." };
  return { ok: false, erro: `O Supabase respondeu ${r.status}${msg ? `: ${msg}` : ""}.` };
}
