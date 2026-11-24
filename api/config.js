/**
 * O que o CRM já recebe pronto da Vercel (variáveis de ambiente).
 * Só valores públicos: a chave da Anthropic nunca sai do servidor.
 */
export function GET() {
  const supabaseUrl = process.env.SUPABASE_URL?.trim() || "";
  const supabaseChave = process.env.SUPABASE_PUBLISHABLE_KEY?.trim() || "";
  return Response.json(
    {
      // A IA pelo servidor só funciona com login, então precisa do Supabase também.
      ia: Boolean(process.env.ANTHROPIC_API_KEY?.trim() && supabaseUrl && supabaseChave),
      supabaseUrl,
      supabaseChave,
      googleClientId: process.env.GOOGLE_CLIENT_ID?.trim() || "",
    },
    { headers: { "cache-control": "no-store" } },
  );
}
