import { ambiente, entrarNoSupabase } from "../lib/ambiente.js";

/**
 * Confere a configuração da Vercel e do Supabase sem mostrar nenhuma senha ou chave:
 * só diz o que está faltando ou errado.
 */
export async function GET() {
  const env = ambiente();
  const itens = [];
  const item = (ok, nome, detalhe) => itens.push({ ok, nome, detalhe });

  for (const n of ["CRM_USUARIO", "CRM_SENHA", "SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_EMAIL", "SUPABASE_SENHA", "ANTHROPIC_API_KEY"]) {
    item(Boolean(env[n]), n, env[n] ? "cadastrada" : "falta cadastrar na Vercel (e fazer Redeploy)");
  }
  const brutoUrl = String(process.env.SUPABASE_URL || "").trim();
  if (env.SUPABASE_URL) {
    const formato = /^https:\/\/[a-z0-9-]+\.supabase\.(co|in)$/i.test(env.SUPABASE_URL);
    item(formato, "Formato da SUPABASE_URL", formato
      ? (brutoUrl.replace(/\/+$/, "").toLowerCase() === env.SUPABASE_URL ? `ok (${env.SUPABASE_URL})` : `corrigido automaticamente para ${env.SUPABASE_URL}`)
      : `"${env.SUPABASE_URL}" não parece a Project URL (formato https://xxxx.supabase.co).`);
  }
  if (env.SUPABASE_PUBLISHABLE_KEY) {
    const k = env.SUPABASE_PUBLISHABLE_KEY;
    const formato = k.startsWith("sb_publishable_") || (k.split(".").length === 3 && k.startsWith("eyJ"));
    item(formato && !k.startsWith("sb_secret_"), "Formato da SUPABASE_PUBLISHABLE_KEY", k.startsWith("sb_secret_") ? "essa é a chave SECRETA: use a publishable (sb_publishable_…) ou a anon public." : formato ? "ok" : "não parece uma chave publishable (sb_publishable_…) nem anon public (eyJ…).");
  }
  if (env.ANTHROPIC_API_KEY) item(env.ANTHROPIC_API_KEY.startsWith("sk-ant-"), "Formato da ANTHROPIC_API_KEY", env.ANTHROPIC_API_KEY.startsWith("sk-ant-") ? "ok" : "não começa com sk-ant-");

  if (env.SUPABASE_URL && env.SUPABASE_PUBLISHABLE_KEY && env.SUPABASE_EMAIL && env.SUPABASE_SENHA) {
    const s = await entrarNoSupabase(env);
    item(s.ok, "Entrar no Supabase com SUPABASE_EMAIL e SUPABASE_SENHA", s.ok ? "ok" : s.erro);
    if (s.ok) {
      const r = await fetch(`${env.SUPABASE_URL}/rest/v1/crm_dados?select=chave&limit=1`, { headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${s.sessao.access_token}` } }).catch(() => null);
      const d = r && !r.ok ? await r.json().catch(() => ({})) : {};
      const semTabela = r && (r.status === 404 || /crm_dados|schema cache|does not exist/i.test(String(d.message || "")));
      item(Boolean(r?.ok), "Tabela crm_dados no Supabase", r?.ok ? "ok" : semTabela ? "não existe: rode o supabase/crm.sql no SQL Editor desse projeto" : `erro ${r?.status ?? "de conexão"}${d.message ? `: ${d.message}` : ""}`);
    }
  }
  if (env.ELEVENLABS_API_KEY || env.ELEVENLABS_VOICE_ID) {
    item(Boolean(env.ELEVENLABS_API_KEY && env.ELEVENLABS_VOICE_ID), "Voz (ElevenLabs)", env.ELEVENLABS_API_KEY && env.ELEVENLABS_VOICE_ID ? "cadastrada" : "falta ELEVENLABS_API_KEY ou ELEVENLABS_VOICE_ID");
  }
  return Response.json({ itens, tudoOk: itens.every((i) => i.ok) }, { headers: { "cache-control": "no-store" } });
}
