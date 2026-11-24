/**
 * O que o CRM já recebe pronto da Vercel (variáveis de ambiente).
 * Só valores públicos: a chave da Anthropic e as senhas nunca saem do servidor.
 */
const NECESSARIAS = ["ANTHROPIC_API_KEY", "SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_EMAIL", "SUPABASE_SENHA", "CRM_USUARIO", "CRM_SENHA"];

export function GET() {
  const tem = (n) => Boolean(process.env[n]?.trim());
  const supabaseUrl = process.env.SUPABASE_URL?.trim() || "";
  const supabaseChave = process.env.SUPABASE_PUBLISHABLE_KEY?.trim() || "";
  const login = ["CRM_USUARIO", "CRM_SENHA", "SUPABASE_EMAIL", "SUPABASE_SENHA"].every(tem) && Boolean(supabaseUrl && supabaseChave);
  return Response.json(
    {
      login,
      // A IA pelo servidor só funciona com login.
      ia: tem("ANTHROPIC_API_KEY") && login,
      supabaseUrl: login ? supabaseUrl : "",
      supabaseChave: login ? supabaseChave : "",
      googleClientId: process.env.GOOGLE_CLIENT_ID?.trim() || "",
      faltando: NECESSARIAS.filter((n) => !tem(n)),
    },
    { headers: { "cache-control": "no-store" } },
  );
}
