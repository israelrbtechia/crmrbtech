import Anthropic from "@anthropic-ai/sdk";
import { usuarioDoCrm } from "../lib/auth.js";

/**
 * Intermediário entre o CRM e a Anthropic. O navegador manda o pedido da IA
 * (o mesmo formato da API de mensagens) com o login do Supabase; aqui a
 * chave ANTHROPIC_API_KEY, guardada na Vercel, é usada para chamar a API.
 * Quem não está logado no CRM não consegue usar a chave.
 */
const erro = (status, tipo, mensagem) => Response.json({ type: "error", error: { type: tipo, message: mensagem } }, { status });

export async function POST(request) {
  const chave = process.env.ANTHROPIC_API_KEY?.trim();
  if (!chave) return erro(500, "api_error", "ANTHROPIC_API_KEY não está configurada na Vercel.");

  const acesso = await usuarioDoCrm(request);
  if (!acesso.ok) return erro(acesso.status, acesso.status === 403 ? "permission_error" : "authentication_error", acesso.mensagem);

  let params;
  try {
    params = await request.json();
  } catch {
    return erro(400, "invalid_request_error", "Pedido inválido.");
  }
  if (!params || typeof params !== "object" || typeof params.model !== "string" || !params.model.startsWith("claude-")) {
    return erro(400, "invalid_request_error", "Pedido inválido: falta o modelo.");
  }
  if (params.stream) return erro(400, "invalid_request_error", "O CRM não usa streaming por este caminho.");

  const betas = (request.headers.get("anthropic-beta") || "").split(",").map((b) => b.trim()).filter(Boolean);
  const client = new Anthropic({ apiKey: chave, maxRetries: 2 });
  try {
    const resposta = await client.beta.messages.create({ ...params, ...(betas.length ? { betas } : {}) });
    return Response.json(resposta);
  } catch (e) {
    if (e instanceof Anthropic.APIError) {
      return Response.json(e.error ?? { type: "error", error: { type: "api_error", message: e.message } }, { status: e.status ?? 502 });
    }
    console.error(e);
    return erro(502, "api_error", "Não consegui falar com a Anthropic. Tente de novo.");
  }
}
