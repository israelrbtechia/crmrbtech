import Anthropic from "@anthropic-ai/sdk";
import { ambiente } from "./ambiente.js";
import * as banco from "./banco.js";
import { enviarTexto, enviarAudio } from "./zapi.js";
import { vozLigada, gerarFala, paraDataURL, transcreverLink } from "./voz.js";
import {
  criarNucleo, mesclar, CONFIG_PADRAO, ESTILO_PADRAO, partesDoTexto, MARCA_AUDIO, mesmoNumero, chaveNumero, soDigitos, uid, agoraISO,
} from "../nucleo/negocio.js";

/**
 * Atendimento no servidor, 24 horas: recebe o WhatsApp, roda a IA (o mesmo núcleo do navegador)
 * e responde conforme o modo (à noite, sozinha; de dia, o modo do botão /modo).
 */
const GERAIS = ["config", "catalogo", "contatos", "aprovacoes", "compromissos", "estilo", "donoZap", "log", "uso", "seq", "siteDados"];
const clona = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
const textoParaFala = (t) => String(t).replace(MARCA_AUDIO, "").replace(/\*([^*\n]+)\*/g, "$1").replace(/(^|\s)_([^_\n]+)_/g, "$1$2").replace(/~([^~\n]+)~/g, "$1").replace(/[\p{Extended_Pictographic}️‍]/gu, "").replace(/[ \t]{2,}/g, " ").trim();

// ---------------------------------------------------------------- estado lido do Supabase
async function carregar(convIds = []) {
  const lido = await banco.ler([...GERAIS, ...convIds.map((id) => `conv:${id}`)]);
  const S = {
    config: mesclar(CONFIG_PADRAO, lido.get("config")),
    catalogo: lido.get("catalogo") || [],
    contatos: lido.get("contatos") || [],
    aprovacoes: lido.get("aprovacoes") || [],
    compromissos: lido.get("compromissos") || [],
    estilo: mesclar(ESTILO_PADRAO, lido.get("estilo")),
    donoZap: lido.get("donoZap") || [],
    log: lido.get("log") || [],
    uso: lido.get("uso") || {},
    seq: lido.get("seq") || { aprov: 0 },
    siteDados: lido.get("siteDados") || null,
    conv: {},
  };
  for (const id of convIds) if (lido.has(`conv:${id}`)) S.conv[id] = lido.get(`conv:${id}`);
  const sujos = new Set();
  const paraDono = [];
  const env = ambiente();
  const cliente = env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 2 }) : null;
  const N = criarNucleo(S, {
    salvar: (...k) => k.forEach((x) => sujos.add(x)),
    chamarClaude: (params) => {
      if (!cliente) throw new Error("Falta ANTHROPIC_API_KEY na Vercel.");
      return cliente.beta.messages.create(params);
    },
    vozLigada,
    aoMensagemDono: (texto) => paraDono.push(texto),
  });
  S.contatos.forEach((c) => N.completarContato(c));
  // A "base" é o estado já arrumado: assim só o que mudar de verdade conta como alteração.
  const base = new Map([...GERAIS.map((k) => [k, clona(S[k])]), ...convIds.filter((id) => S.conv[id]).map((id) => [`conv:${id}`, clona(S.conv[id])])]);
  return { S, N, base, sujos, paraDono };
}
async function carregarConversas(E, ids) {
  const faltam = ids.filter((id) => !E.S.conv[id]);
  if (!faltam.length) return;
  const lido = await banco.ler(faltam.map((id) => `conv:${id}`));
  for (const id of faltam) {
    const v = lido.get(`conv:${id}`);
    if (v) { E.S.conv[id] = v; E.base.set(`conv:${id}`, clona(v)); }
  }
}
async function salvar(E) {
  const valores = new Map();
  for (const k of E.sujos) valores.set(k, k.startsWith("conv:") ? E.S.conv[k.slice(5)] : E.S[k]);
  E.sujos.clear();
  await banco.gravar(valores, E.base);
}
async function avisarDono(E) {
  const dono = soDigitos(E.S.config.dono.whatsapp);
  const fila = E.paraDono.splice(0);
  if (!dono) return; // sem o WhatsApp do dono: as aprovações ficam só no CRM
  for (const texto of fila) await enviarTexto(dono, texto, 1).catch((e) => console.error("aviso ao dono:", e.message));
}
const telefoneDe = (c) => c.zap || c.telefone;

// ---------------------------------------------------------------- envia a resposta da IA
async function entregar(E, c, texto, extra = {}) {
  for (const [i, parte] of partesDoTexto(texto).entries()) {
    if (i) await pausa(800);
    const fala = parte.replace(MARCA_AUDIO, "").trim();
    if (!fala) continue;
    if (MARCA_AUDIO.test(parte) && vozLigada()) {
      try {
        const audio = paraDataURL(await gerarFala(textoParaFala(fala)));
        const r = await enviarAudio(telefoneDe(c), audio, 3);
        E.N.adicionarMensagem(c.id, "ia", fala, { ...extra, tipo: "audio", audio, zapId: r.id });
        continue;
      } catch (e) {
        E.N.evento(c.id, `⚠️ Não consegui mandar o áudio (${e.message}): foi como texto.`, { erro: true });
      }
    }
    const r = await enviarTexto(telefoneDe(c), fala, Math.min(8, 1 + Math.round(fala.length / 40)));
    E.N.adicionarMensagem(c.id, "ia", fala, { ...extra, zapId: r.id });
  }
}

// ---------------------------------------------------------------- atende uma conversa
/**
 * Roda a IA nesta conversa e responde conforme o modo.
 * rascunho: só sugere. forcar: atende mesmo em "só eu" (pedido do dono no CRM). followup: é um follow-up.
 */
export async function processarContato(contatoId, { rascunho = false, forcar = false, followup = false } = {}) {
  // Uma conversa por vez: se já tem alguém atendendo, espera um pouco.
  let travou = false;
  for (let i = 0; i < 20 && !(travou = await banco.travar(contatoId)); i++) await pausa(3000);
  if (!travou) return { ocupado: true };
  let E;
  try {
    E = await carregar([contatoId]);
    const c = E.N.contato(contatoId);
    if (!c) return { erro: "Contato não encontrado." };
    const modo = rascunho ? "sugerir" : E.N.modoEfetivo(c);
    if (modo === "manual" && !forcar) return { modo, nada: true };
    let fu = null;
    if (followup) {
      const est = E.N.estadoFollowup(c);
      if (est.situacao !== "devido") return { modo, nada: true };
      fu = E.N.prepararFollowup(c, est);
    }
    const extra = fu ? { followup: fu.n } : {};
    try {
      const { texto } = await E.N.executarAgente(contatoId, { extra });
      if (texto) {
        if (modo === "auto") await entregar(E, c, texto, extra);
        else E.N.guardarRascunho(contatoId, texto, extra);
      }
      if (fu) E.N.registrar(`Follow-up ${fu.n}/${fu.total} para ${E.N.nomeCli(c)}${modo === "auto" ? " enviado" : " sugerido"}.`);
      return { modo, texto };
    } catch (e) {
      fu?.desfazer();
      return { modo, erro: e.message };
    }
  } finally {
    if (E) {
      await avisarDono(E);
      await salvar(E).catch((e) => console.error("salvar:", e.message));
    }
    await banco.soltar(contatoId).catch(() => {});
  }
}

// ---------------------------------------------------------------- mensagem que chegou no WhatsApp
function guardarPar(E, contatoId, resposta) {
  const msgs = E.N.conversa(contatoId).mensagens;
  const antes = [];
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m.de === "evento") continue;
    if (m.de === "cliente") antes.unshift(m.texto);
    else if (antes.length) break;
  }
  E.S.estilo.pares.push({ cliente: antes.join("\n"), resposta, origem: "whatsapp", em: agoraISO() });
  E.S.estilo.pares = E.S.estilo.pares.slice(-4000);
  E.sujos.add("estilo");
}

/** Mensagem do dono (do celular dele ou da conversa consigo mesmo): resposta às aprovações. */
async function mensagemDoDono(E, aviso) {
  if (aviso.tipo !== "texto" || !aviso.texto.trim()) return null;
  await carregarConversas(E, E.S.aprovacoes.filter((a) => a.status === "pendente").map((a) => a.contatoId));
  E.S.donoZap.push({ id: uid("z"), de: "dono", texto: aviso.texto, em: agoraISO() });
  E.sujos.add("donoZap");
  const r = E.N.donoResponde(aviso.texto);
  E.N.mensagemAoDono(r.resposta);
  return r.aprovacao?.contatoId || null;
}

export async function receberAviso(aviso, { esperaMs } = {}) {
  const chaveTel = `tel:${chaveNumero(aviso.telefone) || aviso.lid}`;
  let travou = false;
  for (let i = 0; i < 10 && !(travou = await banco.travar(chaveTel, 30)); i++) await pausa(1000);
  let E;
  let r = {};
  try {
    E = await carregar([]);
    r = await registrarAviso(E, aviso);
  } finally {
    if (E) {
      await avisarDono(E);
      await salvar(E).catch((e) => console.error("salvar:", e.message));
    }
    if (travou) await banco.soltar(chaveTel).catch(() => {});
  }
  if (r.seguirAprovacao) return processarContato(r.seguirAprovacao, { forcar: true });
  if (!r.mensagemId) return;
  // Espera o cliente terminar de digitar: se chegar outra mensagem, quem responde é a rodada dela.
  await pausa(esperaMs ?? Math.max(5, Number(E.S.config.ia.espera) || 0) * 1000);
  const conv = (await banco.ler([`conv:${r.contatoId}`])).get(`conv:${r.contatoId}`);
  const ultima = (conv?.mensagens || []).filter((m) => m.de === "cliente").at(-1);
  if (ultima && ultima.id !== r.mensagemId) return;
  return processarContato(r.contatoId);
}

/** Registra o aviso no CRM. Devolve o que fazer depois: { seguirAprovacao } ou { contatoId, mensagemId }. */
async function registrarAviso(E, aviso) {
  {
    const dono = E.S.config.dono.whatsapp;
    const ehDono = (!aviso.deMim && dono && mesmoNumero(aviso.telefone, dono)) || (aviso.deMim && aviso.conectado && mesmoNumero(aviso.telefone, aviso.conectado));
    if (ehDono) return { seguirAprovacao: await mensagemDoDono(E, aviso) };
    let c = E.S.contatos.find((x) => (x.zap && x.zap === aviso.telefone) || mesmoNumero(x.telefone, aviso.telefone) || (aviso.lid && x.lid === aviso.lid));
    if (!c) {
      c = E.N.novoContato({ nome: aviso.deMim ? "" : aviso.nome, telefone: /@/.test(aviso.telefone) ? "" : aviso.telefone, zap: aviso.telefone, lid: aviso.lid, origem: "whatsapp" });
    } else {
      if (!c.zap) { c.zap = aviso.telefone; E.sujos.add("contatos"); }
      if (aviso.lid && !c.lid) { c.lid = aviso.lid; E.sujos.add("contatos"); }
    }
    await carregarConversas(E, [c.id]);
    const conv = E.N.conversa(c.id);
    if (aviso.id && conv.mensagens.some((m) => m.zapId === aviso.id)) return {}; // aviso repetido

    if (aviso.deMim) {
      // O dono respondeu pelo celular: entra na conversa, a IA aprende e fica quieta aqui por algumas horas.
      const texto = aviso.texto || "[áudio]";
      E.N.adicionarMensagem(c.id, "dono", texto, { zapId: aviso.id, ...(aviso.tipo === "audio" ? { tipo: "audio", audio: aviso.audioUrl } : {}) });
      if (conv.rascunho) {
        conv.notas.push("O dono ignorou a sua última sugestão: ela NÃO foi enviada ao cliente.");
        conv.rascunho = ""; conv.rascunhoOriginal = ""; conv.rascunhoFollowup = 0;
      }
      conv.notas.push(`O dono respondeu pessoalmente ao cliente pelo celular: "${texto}"`);
      conv.notas = conv.notas.slice(-30);
      if (aviso.tipo === "texto") guardarPar(E, c.id, texto);
      const horas = Number(E.S.config.atendimento.pausaAoAssumirHoras) || 3;
      c.pausadoAte = new Date(Date.now() + horas * 3600e3).toISOString();
      c.precisaDono = "";
      E.sujos.add("contatos");
      return {};
    }

    let texto = aviso.texto;
    const extra = { zapId: aviso.id };
    if (aviso.tipo === "audio") {
      extra.tipo = "audio";
      extra.audio = aviso.audioUrl;
      try { texto = ambiente().ELEVENLABS_API_KEY ? await transcreverLink(aviso.audioUrl, aviso.audioTipo) : ""; } catch (e) { console.error("transcrição:", e.message); }
      if (!texto) texto = "(áudio que não consegui transcrever: peça para o cliente escrever, com jeito)";
    }
    if (!c.nome && aviso.nome) c.nome = aviso.nome;
    return { contatoId: c.id, mensagemId: E.N.adicionarMensagem(c.id, "cliente", texto, extra).id };
  }
}

// ---------------------------------------------------------------- rotina: follow-ups e perdidos
export async function rotina({ limite = 3 } = {}) {
  const E = await carregar([]);
  const f = E.S.config.followup;
  const candidatos = E.S.contatos
    .filter((c) => !c.teste && (c.zap || c.telefone) && f.ativo && f.estagios.includes(c.estagio) && !c.fu?.pausado)
    .sort((a, b) => String(a.atualizadoEm).localeCompare(String(b.atualizadoEm)))
    .slice(0, 40);
  await carregarConversas(E, candidatos.map((c) => c.id));
  const agora = new Date();
  const devidos = [];
  for (const c of candidatos) {
    const e = E.N.estadoFollowup(c, agora);
    if (e.situacao === "esgotado" && e.perderEm && e.perderEm <= agora && c.estagio !== "perdido") E.N.marcarPerdido(c, e);
    else if (e.situacao === "devido" && E.N.modoEfetivo(c, agora) !== "manual") devidos.push(c.id);
  }
  await salvar(E);
  const feitos = [];
  for (const id of devidos.slice(0, limite)) feitos.push({ id, ...(await processarContato(id, { followup: true })) });
  return { candidatos: candidatos.length, devidos: devidos.length, feitos };
}

/** Modo de atendimento (botão /modo). */
export async function lerModo() {
  const E = await carregar([]);
  const a = E.S.config.atendimento;
  return { modoDia: a.modoDia, noturno: E.N.noturno(), agora: E.N.modoEfetivo(null), noiteAtiva: a.noiteAtiva, noiteInicio: a.noiteInicio, noiteFim: a.noiteFim };
}
export async function trocarModo(modoDia) {
  const E = await carregar([]);
  E.S.config.atendimento.modoDia = modoDia;
  E.sujos.add("config");
  await salvar(E);
  return lerModo();
}

/** O dono mandou uma mensagem pelo CRM: vai para o WhatsApp do cliente. */
export async function enviarDoCrm(contatoId, { texto = "", audio = null } = {}) {
  const contatos = (await banco.ler(["contatos"])).get("contatos") || [];
  const c = contatos.find((x) => x.id === contatoId);
  if (!c || !telefoneDe(c)) throw new Error("Este cliente não tem WhatsApp.");
  if (audio) return enviarAudio(telefoneDe(c), audio, 2);
  if (!String(texto).trim()) throw new Error("Mensagem vazia.");
  return enviarTexto(telefoneDe(c), String(texto).replace(MARCA_AUDIO, ""), Math.min(6, 1 + Math.round(String(texto).length / 50)));
}
