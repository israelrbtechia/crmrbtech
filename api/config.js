/**
 * O que o CRM já recebe pronto da Vercel (variáveis de ambiente).
 * Só valores públicos: a chave da Anthropic e as senhas nunca saem do servidor.
 */
import { ambiente } from "../lib/ambiente.js";

const NECESSARIAS = ["ANTHROPIC_API_KEY", "SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_EMAIL", "SUPABASE_SENHA", "CRM_USUARIO", "CRM_SENHA"];

export function GET() {
  const env = ambiente();
  const tem = (n) => Boolean(env[n]);
  const supabaseUrl = env.SUPABASE_URL;
  const supabaseChave = env.SUPABASE_PUBLISHABLE_KEY;
  const login = ["CRM_USUARIO", "CRM_SENHA", "SUPABASE_EMAIL", "SUPABASE_SENHA"].every(tem) && Boolean(supabaseUrl && supabaseChave);
  return Response.json(
    {
      login,
      // A IA pelo servidor só funciona com login.
      ia: tem("ANTHROPIC_API_KEY") && login,
      supabaseUrl: login ? supabaseUrl : "",
      supabaseChave: login ? supabaseChave : "",
      googleClientId: env.GOOGLE_CLIENT_ID,
      // Voz clonada (ElevenLabs): só com login, como a IA.
      voz: tem("ELEVENLABS_API_KEY") && tem("ELEVENLABS_VOICE_ID") && login,
      faltando: NECESSARIAS.filter((n) => !tem(n)),
    },
    { headers: { "cache-control": "no-store" } },
  );
}
