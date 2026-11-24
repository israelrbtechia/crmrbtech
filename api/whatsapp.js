import { waitUntil } from "@vercel/functions";
import { ambiente } from "../lib/ambiente.js";
import { lerAviso, mensagemAntiga } from "../lib/zapi.js";
import { receberAviso } from "../lib/atendimento.js";

/**
 * Avisos da Z-API ("ao receber" e "enviadas por mim"). Cadastre na Z-API o endereço
 * https://SEU-SITE/api/whatsapp?chave=ZAPI_WEBHOOK_SEGREDO
 * Responde na hora e atende em segundo plano (a Z-API não espera a IA pensar).
 */
const segredoCerto = (request) => {
  const segredo = ambiente().ZAPI_WEBHOOK_SEGREDO;
  return Boolean(segredo) && new URL(request.url).searchParams.get("chave") === segredo;
};

export async function POST(request) {
  if (!segredoCerto(request)) return Response.json({ erro: "chave inválida" }, { status: 401 });
  const corpo = await request.json().catch(() => null);
  const aviso = lerAviso(corpo);
  if (!aviso) return Response.json({ ok: true, ignorado: true });
  // Antiga (mais de 30 min) ou histórico sincronizado: entra no CRM só como informação, sem resposta.
  const soRegistrar = aviso.historico || mensagemAntiga(aviso);
  waitUntil(receberAviso(aviso, { soRegistrar }).catch((e) => console.error("whatsapp:", e)));
  if (soRegistrar) return Response.json({ ok: true, soRegistro: true });
  return Response.json({ ok: true });
}

/** Para conferir no navegador se o endereço está certo. */
export function GET(request) {
  const certo = segredoCerto(request);
  const corpo = certo ? { ok: true, mensagem: "Endereço certo: cadastre este link na Z-API." } : { ok: false, mensagem: "Chave errada ou ZAPI_WEBHOOK_SEGREDO não cadastrada." };
  return new Response(JSON.stringify(corpo, null, 2), { status: certo ? 200 : 401, headers: { "content-type": "application/json; charset=utf-8" } });
}
