import { ambiente, entrarNoSupabase } from "./ambiente.js";
import { mesclarChave } from "../nucleo/negocio.js";

/**
 * O servidor lê e grava os dados do CRM no Supabase como o usuário técnico
 * (SUPABASE_EMAIL), o mesmo dono das linhas que o navegador usa (RLS).
 */
let sessao = null;
export async function sessaoTecnica() {
  if (sessao && sessao.ate > Date.now() + 60_000) return sessao;
  const s = await entrarNoSupabase(ambiente());
  if (!s.ok) throw new Error(s.erro);
  let userId = s.sessao.user?.id;
  if (!userId) {
    try { userId = JSON.parse(Buffer.from(s.sessao.access_token.split(".")[1], "base64url").toString()).sub; } catch { /* sem id */ }
  }
  sessao = { token: s.sessao.access_token, ate: Date.now() + (Number(s.sessao.expires_in) || 3600) * 1000, userId };
  return sessao;
}

async function rest(caminho, opcoes = {}) {
  const env = ambiente();
  const s = await sessaoTecnica();
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/${caminho}`, {
    ...opcoes,
    headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${s.token}`, "content-type": "application/json", ...(opcoes.headers || {}) },
  });
  if (!r.ok) throw new Error(`Supabase (${r.status}): ${(await r.text()).slice(0, 200)}`);
  return r;
}
const lista = (chaves) => `(${chaves.map((k) => `"${String(k).replace(/"/g, "")}"`).join(",")})`;

/** Lê várias "gavetas" de uma vez. Devolve um Map chave -> valor. */
export async function ler(chaves) {
  const mapa = new Map();
  for (let i = 0; i < chaves.length; i += 50) {
    const lote = chaves.slice(i, i + 50);
    const r = await rest(`crm_dados?select=chave,valor&chave=in.${encodeURIComponent(lista(lote))}`);
    for (const l of await r.json()) if (l.valor !== null) mapa.set(l.chave, l.valor);
  }
  return mapa;
}

/**
 * Grava as gavetas alteradas juntando com o que mudou na nuvem enquanto o servidor trabalhava
 * (o dono pode estar mexendo no CRM ao mesmo tempo). `base` é o que foi lido no começo.
 */
export async function gravar(valores, base = new Map()) {
  const chaves = [...valores.keys()];
  if (!chaves.length) return;
  const agora = await ler(chaves);
  const s = await sessaoTecnica();
  const linhas = chaves.map((k) => ({
    user_id: s.userId,
    chave: k,
    valor: agora.has(k) ? mesclarChave(k, base.get(k), valores.get(k), agora.get(k)) : valores.get(k),
    dispositivo: "servidor",
  }));
  await rest("crm_dados?on_conflict=user_id,chave", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(linhas) });
}

/** Trava simples (uma conversa atendida por vez). Devolve true se conseguiu. */
export async function travar(nome, segundos = 150) {
  const s = await sessaoTecnica();
  const chave = `_trava:${nome}`;
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    const r = await rest("crm_dados?on_conflict=user_id,chave", {
      method: "POST",
      headers: { Prefer: "resolution=ignore-duplicates,return=representation" },
      body: JSON.stringify([{ user_id: s.userId, chave, valor: { em: new Date().toISOString() }, dispositivo: "servidor" }]),
    });
    if ((await r.json()).length) return true;
    const atual = await ler([chave]);
    const em = Date.parse(atual.get(chave)?.em || 0);
    if (Date.now() - em < segundos * 1000) return false;
    await soltar(nome); // trava esquecida (o servidor caiu no meio): libera e tenta de novo
  }
  return false;
}
export async function soltar(nome) {
  await rest(`crm_dados?chave=eq.${encodeURIComponent(`_trava:${nome}`)}`, { method: "DELETE" });
}

/**
 * Lembra por 15 minutos o que o servidor mandou pelo WhatsApp, para não confundir o
 * "eco" da própria mensagem (que volta no webhook como "enviada por mim") com o dono
 * respondendo pelo celular.
 */
const chaveSaida = async (telefone, texto) => {
  const { createHash } = await import("node:crypto");
  const tel = String(telefone || "").replace(/\D/g, "").slice(-8);
  const t = String(texto || "").replace(/\s+/g, " ").trim().toLowerCase();
  return `_saida:${createHash("sha1").update(`${tel}|${t}`).digest("hex").slice(0, 24)}`;
};
export async function marcarSaida(telefone, texto) {
  const s = await sessaoTecnica();
  const chave = await chaveSaida(telefone, texto);
  await rest("crm_dados?on_conflict=user_id,chave", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify([{ user_id: s.userId, chave, valor: { em: new Date().toISOString() }, dispositivo: "servidor" }]),
  });
  const limite = new Date(Date.now() - 30 * 60e3).toISOString();
  rest(`crm_dados?chave=like._saida:*&atualizado_em=lt.${encodeURIComponent(limite)}`, { method: "DELETE" }).catch(() => {});
}
export async function foiSaida(telefone, texto) {
  const chave = await chaveSaida(telefone, texto);
  const v = (await ler([chave])).get(chave);
  return Boolean(v && Date.now() - Date.parse(v.em) < 15 * 60e3);
}
