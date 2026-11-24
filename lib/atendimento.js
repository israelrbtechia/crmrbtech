import Anthropic from "@anthropic-ai/sdk";
import { ambiente } from "./ambiente.js";
import * as banco from "./banco.js";
import { enviarTexto, enviarAudio } from "./zapi.js";
import { vozLigada, gerarFala, paraDataURL, transcreverLink } from "./voz.js";
import {
  criarNucleo, mesclar, soCumprimento, partesBR, migrarConfig, semTagsDeVoz, telefoneCompleto, CONFIG_PADRAO, ESTILO_PADRAO, partesDoTexto, MARCA_AUDIO, mesmoNumero, chaveNumero, soDigitos, uid, agoraISO,
} from "../nucleo/negocio.js";

/**
 * Atendimento no servidor, 24 horas: recebe o WhatsApp, roda a IA (o mesmo núcleo do navegador)
 * e responde conforme o modo (à noite, sozinha; de dia, o modo do botão /modo).
 */
const GERAIS = ["config", "catalogo", "contatos", "aprovacoes", "compromissos", "estilo", "donoZap", "log", "uso", "seq", "siteDados", "inspecoes"];
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
    inspecoes: lido.get("inspecoes") || [],
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
    // Antes de mandar a resposta: se o cliente voltou a digitar, espera ele terminar.
    esperarCliente: async (contatoId) => {
      const c = S.contatos.find((x) => x.id === contatoId);
      if (c) await esperarClienteParar(c.zap || c.telefone, 45000);
    },
    // Mensagens do cliente que chegaram (pelo webhook) enquanto a IA escrevia: entram aqui e na
    // "base", para a junção saber que elas vieram da nuvem e só a marca "lida pela IA" é daqui.
    buscarNovas: async (contatoId) => {
      const k = `conv:${contatoId}`;
      const remoto = (await banco.ler([k])).get(k);
      const local = S.conv[contatoId];
      if (!remoto || !local) return;
      const tem = new Set(local.mensagens.map((m) => m.id));
      const chegaram = (remoto.mensagens || []).filter((m) => !tem.has(m.id) && m.de === "cliente");
      if (!chegaram.length) return;
      local.mensagens.push(...clona(chegaram));
      local.mensagens.sort((x, y) => String(x.em).localeCompare(String(y.em)));
      const b = base.get(k);
      if (b) { b.mensagens = [...(b.mensagens || []), ...clona(chegaram)]; }
    },
  });
  S.contatos.forEach((c) => N.completarContato(c));
  // A "base" é o estado já arrumado: assim só o que mudar de verdade conta como alteração.
  const base = new Map([...GERAIS.map((k) => [k, clona(S[k])]), ...convIds.filter((id) => S.conv[id]).map((id) => [`conv:${id}`, clona(S.conv[id])])]);
  // Regras da loja que mudaram desde a última vez (ex.: carregadores): entram nas instruções salvas.
  if (migrarConfig(S.config)) sujos.add("config");
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
  const dono = telefoneCompleto(E.S.config.dono.whatsapp);
  const fila = E.paraDono.splice(0);
  if (!dono) return; // sem o WhatsApp do dono: as aprovações ficam só no CRM
  for (const texto of fila) await enviarTexto(dono, texto, 1).catch((e) => console.error("aviso ao dono:", e.message));
}
const telefoneDe = (c) => c.zap || c.telefone;
/** Nunca interromper: espera o cliente parar de digitar (ou gravar áudio), até maxMs. */
async function esperarClienteParar(telefone, maxMs = 60000) {
  if (!telefone) return 0;
  const inicio = Date.now();
  while (Date.now() - inicio < maxMs && (await banco.clienteDigitando(telefone).catch(() => false))) await pausa(2000);
  return Date.now() - inicio;
}

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
        E.N.adicionarMensagem(c.id, "ia", semTagsDeVoz(fala), { ...extra, tipo: "audio", audio, zapId: r.id });
        continue;
      } catch (e) {
        E.N.evento(c.id, `⚠️ Não consegui mandar o áudio (${e.message}): foi como texto.`, { erro: true });
      }
    }
    const escrito = semTagsDeVoz(fala); // as marcações de emoção nunca vão escritas
    if (!escrito) continue;
    const r = await enviarTexto(telefoneDe(c), escrito, Math.min(8, 1 + Math.round(escrito.length / 40)));
    E.N.adicionarMensagem(c.id, "ia", escrito, { ...extra, zapId: r.id });
  }
}

// ---------------------------------------------------------------- atende uma conversa
/**
 * Roda a IA nesta conversa e responde conforme o modo.
 * rascunho: só sugere. forcar: atende mesmo em "só eu" (pedido do dono no CRM). followup: é um follow-up.
 */
export async function processarContato(contatoId, { rascunho = false, forcar = false, followup = false, enviar = false } = {}) {
  // Uma conversa por vez: se já tem alguém atendendo, espera um pouco.
  let travou = false;
  for (let i = 0; i < 20 && !(travou = await banco.travar(contatoId)); i++) await pausa(3000);
  if (!travou) return { ocupado: true };
  let E;
  try {
    E = await carregar([contatoId]);
    const c = E.N.contato(contatoId);
    if (!c) return { erro: "Contato não encontrado." };
    // enviar: ordem do dono pelo WhatsApp, vai na hora em qualquer modo.
    const modo = rascunho ? "sugerir" : enviar ? "auto" : E.N.modoEfetivo(c);
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
/**
 * Mensagem do dono (do WhatsApp pessoal dele): texto ou áudio (transcrito). O assistente do dono
 * responde aprovações e decisões e executa ordens no CRM. Devolve o que fazer depois.
 */
async function mensagemDoDono(E, aviso) {
  let texto = aviso.texto || "";
  if (aviso.tipo === "audio") {
    try { texto = ambiente().ELEVENLABS_API_KEY ? await transcreverLink(aviso.audioUrl, aviso.audioTipo) : ""; } catch (e) { console.error("transcrição do dono:", e.message); texto = ""; }
    if (!texto) {
      E.N.mensagemAoDono("Não consegui ouvir o seu áudio. Manda por escrito? (Para eu entender áudio, a voz da ElevenLabs precisa estar configurada.)");
      return null;
    }
  }
  if (!texto.trim()) return null;
  const recentes = [...E.S.contatos].sort((a, b) => String(b.atualizadoEm).localeCompare(String(a.atualizadoEm))).slice(0, 30).map((c) => c.id);
  await carregarConversas(E, [...new Set([...E.S.aprovacoes.filter((a) => a.status === "pendente").map((a) => a.contatoId), ...recentes])]);
  E.S.donoZap.push({ id: uid("z"), de: "dono", texto: aviso.tipo === "audio" ? `🎤 ${texto}` : texto, em: agoraISO() });
  E.sujos.add("donoZap");
  let r;
  try { r = await E.N.assistenteDono(texto); } catch (e) {
    console.error("assistente do dono:", e);
    const motivo = /401|authentication/i.test(e.message) ? "a chave da Anthropic foi recusada" : /429|rate/i.test(e.message) ? "a IA está sobrecarregada" : /credit|billing|402/i.test(e.message) ? "acabaram os créditos da Anthropic" : "deu um erro na IA";
    r = { resposta: `Não consegui fazer agora (${motivo}). Tenta de novo em instantes?`, seguir: [], acionar: [], enviar: [] };
  }
  if (r.resposta) E.N.mensagemAoDono(r.resposta);
  return r;
}

/** O dono ditou uma mensagem palavra por palavra: vai para o cliente e fica na conversa como dele. */
async function enviarDitado(contatoId, texto) {
  const E = await carregar([contatoId]);
  const c = E.N.contato(contatoId);
  if (!c || !telefoneDe(c)) return;
  const r = await enviarTexto(telefoneDe(c), texto, Math.min(6, 1 + Math.round(texto.length / 50)));
  E.N.adicionarMensagem(c.id, "dono", texto, { zapId: r.id });
  await salvar(E);
}

export async function receberAviso(aviso, { esperaMs, soRegistrar = false } = {}) {
  const chaveTel = `tel:${chaveNumero(aviso.telefone) || aviso.lid}`;
  let travou = false;
  for (let i = 0; i < 10 && !(travou = await banco.travar(chaveTel, 30)); i++) await pausa(1000);
  let E;
  let r = {};
  try {
    E = await carregar([]);
    r = await registrarAviso(E, aviso, { soRegistrar });
    if (r.saudar) {
      // Primeira conversa (ou dias sem falar): o menu sai quando o cliente parar de digitar.
      E.N.conversa(r.contatoId).saudacaoPendente = true;
      E.sujos.add(`conv:${r.contatoId}`);
    }
  } finally {
    if (E) {
      await avisarDono(E);
      await salvar(E).catch((e) => console.error("salvar:", e.message));
    }
    if (travou) await banco.soltar(chaveTel).catch(() => {});
  }
  if (r.dono) {
    for (const { contatoId, texto } of r.dono.enviar || []) await enviarDitado(contatoId, texto).catch((e) => console.error("ditado:", e.message));
    for (const id of r.dono.seguir || []) await processarContato(id, { forcar: true });
    for (const id of r.dono.acionar || []) await processarContato(id, { forcar: true, enviar: true });
    return;
  }
  if (!r.mensagemId) return;
  try { return await responderCliente(E, aviso, r, esperaMs); } finally { await etiquetarSePreciso(r.contatoId); }
}

/** Etiqueta de contexto (compra, fornecedor...) depois de atender, sem atrasar a resposta. */
async function etiquetarSePreciso(contatoId) {
  if (!ambiente().ANTHROPIC_API_KEY) return;
  if (!(await banco.travar(`etiqueta:${contatoId}`, 120).catch(() => false))) return;
  try {
    const E = await carregar([contatoId]);
    if (!E.N.precisaEtiqueta(E.N.contato(contatoId))) return;
    if (await E.N.etiquetarContatos([contatoId])) await salvar(E);
  } catch (e) { console.error("etiqueta:", e.message); } finally { await banco.soltar(`etiqueta:${contatoId}`).catch(() => {}); }
}

async function responderCliente(E, aviso, r, esperaMs) {
  // Espera o cliente terminar de digitar: se chegar outra mensagem, quem responde é a rodada dela.
  await pausa(esperaMs ?? Math.max(5, Number(E.S.config.ia.espera) || 0) * 1000);
  await esperarClienteParar(aviso.telefone); // "digitando..." ou "gravando áudio...": nunca interromper
  const conv = (await banco.ler([`conv:${r.contatoId}`])).get(`conv:${r.contatoId}`);
  const ultima = (conv?.mensagens || []).filter((m) => m.de === "cliente").at(-1);
  if (ultima && ultima.id !== r.mensagemId) return;
  if (conv?.saudacaoPendente && (await enviarSaudacao(r.contatoId))) {
    // Só cumprimentos ("oi", "bom dia"): o menu já respondeu, a IA espera o cliente escolher.
    const novas = (conv.mensagens || []).filter((m) => m.de === "cliente" && !m.naIA && !m.historico);
    if (novas.length && novas.every((m) => m.tipo !== "audio" && soCumprimento(m.texto))) return;
  }
  return processarContato(r.contatoId);
}

/** Manda o menu de boas-vindas que ficou esperando o cliente parar de digitar. */
async function enviarSaudacao(contatoId) {
  const E = await carregar([contatoId]);
  const conv = E.N.conversa(contatoId);
  if (!conv.saudacaoPendente) return false;
  conv.saudacaoPendente = false;
  E.sujos.add(`conv:${contatoId}`);
  try {
    await entregar(E, E.N.contato(contatoId), E.N.textoSaudacao(), { saudacao: true });
    E.N.anotarSaudacao(contatoId);
    return true;
  } catch (e) {
    console.error("saudação:", e.message);
    return false;
  } finally {
    await salvar(E).catch((e) => console.error("salvar:", e.message));
  }
}

/** Registra o aviso no CRM. Devolve o que fazer depois: { dono } (mensagem do dono) ou { contatoId, mensagemId }. */
async function registrarAviso(E, aviso, { soRegistrar = false } = {}) {
  {
    const dono = E.S.config.dono.whatsapp;
    // Só informação (sem IA, sem menu, sem pausa): mensagem antiga, histórico sincronizado, ou que
    // chegou antes da hora em que a IA foi ligada.
    const corte = E.S.config.atendimento?.ativoDesde;
    const info = soRegistrar || Boolean(corte && aviso.em < corte);
    if (aviso.deMim) {
      // Eco do que o próprio servidor mandou (a IA, um aviso ao dono, uma mensagem do CRM): ignora.
      if (await banco.foiSaida(aviso.telefone, aviso.tipo === "audio" ? "[áudio]" : aviso.texto).catch(() => false)) return {};
      // Do número da loja para o WhatsApp pessoal do dono: não é conversa com cliente.
      if (dono && mesmoNumero(aviso.telefone, dono)) return {};
    }
    const ehDono = (!aviso.deMim && dono && mesmoNumero(aviso.telefone, dono)) || (aviso.deMim && aviso.conectado && mesmoNumero(aviso.telefone, aviso.conectado));
    if (ehDono) return info ? {} : { dono: await mensagemDoDono(E, aviso) }; // "sim" antigo nunca aprova nada
    let c = E.S.contatos.find((x) => (x.zap && x.zap === aviso.telefone) || mesmoNumero(x.telefone, aviso.telefone) || (aviso.lid && x.lid === aviso.lid));
    const criado = !c;
    if (!c) {
      c = E.N.novoContato({ nome: aviso.deMim ? "" : aviso.nome, telefone: /@/.test(aviso.telefone) ? "" : aviso.telefone, zap: aviso.telefone, lid: aviso.lid, origem: info ? "whatsapp-historico" : "whatsapp" });
    } else {
      if (!c.zap) { c.zap = aviso.telefone; E.sujos.add("contatos"); }
      if (aviso.lid && !c.lid) { c.lid = aviso.lid; E.sujos.add("contatos"); }
    }
    await carregarConversas(E, [c.id]);
    const conv = E.N.conversa(c.id);
    if (aviso.id && conv.mensagens.some((m) => m.zapId === aviso.id)) return {}; // aviso repetido

    if (info) {
      // Só registro: a mensagem entra na conversa com a hora original, sem resposta e sem contar como não lida.
      const de = aviso.deMim ? "dono" : "cliente";
      const texto = aviso.texto || (aviso.tipo === "audio" ? "[áudio]" : "");
      const antes = c.naoLidas || 0;
      E.N.adicionarMensagem(c.id, de, texto, { zapId: aviso.id, em: aviso.em, historico: true, ...(aviso.tipo === "audio" ? { tipo: "audio", audio: aviso.audioUrl } : {}) });
      c.naoLidas = antes;
      if (!c.nome && !aviso.deMim && aviso.nome) c.nome = aviso.nome;
      E.sujos.add("contatos");
      return {};
    }

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
    if (!aviso.deMim) E.N.detectarAnuncio(c.id, texto, aviso.anuncio);
    const saudar = E.N.precisaSaudacao(c.id);
    const mensagemId = E.N.adicionarMensagem(c.id, "cliente", texto, extra).id;
    if (criado && !E.N.iaPodeAtender(c) && !c.avisoRegra) {
      // Cliente novo fora da regra (ex.: não veio de anúncio): a IA não responde, o dono é avisado.
      c.avisoRegra = true;
      c.precisaDono = "Cliente novo fora da regra da IA: responda você ou libere a IA";
      E.sujos.add("contatos");
      const nome = E.N.nomeCli(c);
      // Nome sem letras (".", só emoji): o dono libera pelo final do telefone.
      const fim = soDigitos(c.telefone || c.zap).slice(-4);
      const comoLiberar = /\p{L}{2}/u.test(c.nome || "") ? c.nome : fim ? `final ${fim}` : "esse cliente";
      E.N.mensagemAoDono(`📥 *Cliente novo:* ${nome}${c.telefone ? ` (+${c.telefone})` : ""}\n"${String(texto).slice(0, 200)}"\n\nNão veio de anúncio, então a IA não respondeu. Para a IA atender, me responda: *libera ${comoLiberar}*. Ou responda você pelo celular.`);
    }
    return { contatoId: c.id, mensagemId, saudar, soCumprimento: aviso.tipo === "texto" && soCumprimento(texto) };
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
  const inspecao = await inspecaoAutomatica().catch((e) => ({ erro: e.message }));
  const etiquetas = await etiquetarAtrasadas().catch((e) => ({ erro: e.message }));
  return { candidatos: candidatos.length, devidos: devidos.length, feitos, inspecao, etiquetas };
}

/** Conversas sem etiqueta (ex.: as que vieram do histórico): até 24 por rodada da rotina. */
export async function etiquetarAtrasadas({ limite = 24 } = {}) {
  if (!ambiente().ANTHROPIC_API_KEY) return null;
  if (!(await banco.travar("etiquetas", 240).catch(() => false))) return null;
  try {
    const E = await carregar([]);
    const ids = [...E.S.contatos].filter((c) => !c.teste && !c.categoriaManual && !c.categoria).sort((a, b) => String(b.atualizadoEm).localeCompare(String(a.atualizadoEm))).slice(0, limite * 2).map((c) => c.id);
    await carregarConversas(E, ids);
    const faltam = ids.filter((id) => E.N.precisaEtiqueta(E.N.contato(id))).slice(0, limite);
    if (!faltam.length) return { feitas: 0 };
    const feitas = await E.N.etiquetarContatos(faltam);
    await salvar(E);
    return { feitas };
  } finally { await banco.soltar("etiquetas").catch(() => {}); }
}

/**
 * Inspetor de vendas automático (Cérebro da IA > Inspetor): uma vez por dia, em horário comercial,
 * se teve conversa nova desde a última inspeção. O resumo vai para o WhatsApp do dono.
 */
export async function inspecaoAutomatica({ agora = new Date() } = {}) {
  const E = await carregar([]);
  const cfg = E.S.config.inspetor || {};
  if (!cfg.auto) return null;
  if (cfg.ultimaEm && agora - new Date(cfg.ultimaEm) < 20 * 3600e3) return null;
  const h = partesBR(agora).hora;
  if (h < 9 || h >= 21) return null;
  if (!(await banco.travar("inspetor", 600))) return null;
  try {
    const recentes = [...E.S.contatos].filter((c) => !c.teste).sort((a, b) => String(b.atualizadoEm).localeCompare(String(a.atualizadoEm))).slice(0, 15);
    await carregarConversas(E, recentes.map((c) => c.id));
    const lista = E.N.conversasParaInspecionar(Number(cfg.conversas) || 3);
    const nova = lista.some((c) => (E.S.conv[c.id]?.mensagens || []).some((m) => m.de === "cliente" && (!cfg.ultimaEm || m.em > cfg.ultimaEm)));
    if (!lista.length || !nova) return { nada: true };
    const insp = await E.N.inspecionar();
    E.N.mensagemAoDono(E.N.resumoInspecao(insp));
    return { id: insp.id, nota: insp.nota, melhorias: insp.melhorias.length };
  } finally {
    await avisarDono(E);
    await salvar(E).catch((e) => console.error("salvar:", e.message));
    await banco.soltar("inspetor").catch(() => {});
  }
}

/** A partir de agora a IA responde: o que chegou antes vira só registro no CRM. */
export async function marcarInicioAtendimento() {
  const E = await carregar([]);
  E.S.config.atendimento.ativoDesde = agoraISO();
  E.sujos.add("config");
  await salvar(E);
  return E.S.config.atendimento.ativoDesde;
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
  return enviarTexto(telefoneDe(c), semTagsDeVoz(String(texto).replace(MARCA_AUDIO, "")), Math.min(6, 1 + Math.round(String(texto).length / 50)));
}
