import { waitUntil } from "@vercel/functions";
import { ambiente } from "../lib/ambiente.js";
import { lerAviso } from "../lib/zapi.js";
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
  waitUntil(receberAviso(aviso).catch((e) => console.error("whatsapp:", e)));
  return Response.json({ ok: true });
}

/** Para conferir no navegador se o endereço está certo. */
export function GET(request) {
  return Response.json(segredoCerto(request) ? { ok: true, mensagem: "Endereço certo: cadastre este link na Z-API." } : { ok: false, mensagem: "Chave errada ou ZAPI_WEBHOOK_SEGREDO não cadastrada." }, { status: segredoCerto(request) ? 200 : 401 });
}
