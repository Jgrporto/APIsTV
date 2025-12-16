import wweb from "whatsapp-web.js";
import qrcode from "qrcode-terminal";
import axios from "axios";
import Tesseract from "tesseract.js";
import express from "express";
import { criarUsuarioGerenciaAppComM3u } from "./gerenciaApp.js";

const { Client, LocalAuth } = wweb;

const DEVICE_PHONE = "5524999162165";
const KEYWORD_ASSIST = "ASSIST PLUS";
const KEYWORD_LAZER = "LAZER PLAY";
const KEYWORD_FUN = "FUN PLAY";
const KEYWORD_PLAYSIM = "PLAYSIM";
const COMMANDS = {
  ASSIST: "#ASSIST",
  LAZER: "#LAZER",
  IBO: "#IBO",
  FUN: "#FUN",
  PLAYSIM: "#PLAYSIM"
};
const INSTRUCAO_TRIGGER = "VOCE VAI BAIXAR O APLICATIVO, INSTALAR E ABRIR";
const INSTRUCAO_TRIGGER_2 = "ASSIM QUE ABRIR ME MANDA UM PRINT DO APLICATIVO ABERTO";
const LAZER_INSTRUCAO_TRIGGER = "CHEGANDO NESSA TELA VOCE ME AVISA AQUI";
const LAZER_INSTRUCAO_TRIGGER_PLAYLIST = "ASSIM QUE BAIXAR, CLICA NA OPCAO PLAYLIST E ME MANDA UMA FOTO";
const MSG_INSTRUCAO_CELULAR =
  "Voce vai baixar o aplicativo, instalar e abrir.\n\nAssim que abrir me manda um print do aplicativo aberto";
const MSG_PEDIR_PRINT =
  "Preciso do print do app aberto para liberar o teste. Pode me enviar a imagem da tela aberta, por favor?";
const MSG_TESTE_ATIVO = "Aguarde um momento que um atendente vai falar com voce.";
const MSG_TESTE_IBO_OK = "Seu teste foi gerado! Fecha o app e abre novamente.";


function normalizeInstrucao(str) {
  return (str || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
}

function isInstrucaoMensagem(texto) {
  const norm = normalizeInstrucao(texto);
  return norm.includes(INSTRUCAO_TRIGGER) || norm.includes(INSTRUCAO_TRIGGER_2);
}

function isInstrucaoLazer(texto) {
  const norm = normalizeInstrucao(texto);
  return (
    norm.includes(LAZER_INSTRUCAO_TRIGGER) ||
    norm.includes(LAZER_INSTRUCAO_TRIGGER_PLAYLIST)
  );
}
const aguardandoMac = new Set();
const fluxoCelular = new Map(); // { stage: 'aguardando_prova', confirming: bool, mac?: string, printReminderSent?: bool }
const fluxoLazer = new Map(); // phone -> { stage: 'aguardando_foto' | 'aguardando_playlist_click' }
let latestQr = "";
const app = express();
const QR_PORT = process.env.PORT || 3000;
const SELF_PING_URL = process.env.SELF_PING_URL || "";
const IDLE_LOG_MS = Number(process.env.IDLE_LOG_MS || 300000); // 5 min
const FOLLOWUP_MS = Number(process.env.FOLLOWUP_MS || 4 * 60 * 60 * 1000); // 4h padrao
const followupTimers = new Map(); // chatId -> timeoutId

let lastActivity = Date.now();
const touchActivity = () => {
  lastActivity = Date.now();
};

function logFluxoIdentificado(tipo, phone, nome) {
  const safeTipo = (tipo || "N/A").toUpperCase();
  console.log(`FLUXO IDENTIFICADO (${safeTipo}) AGUARDANDO INSTRUÇÕES DO CLIENTE - ${phone} (${nome || "Cliente"})`);
}
function resolveNome(contact, chat, phone) {
  return (
    contact?.verifiedName ||
    contact?.pushname ||
    contact?.name ||
    contact?.shortName ||
    chat?.name ||
    contact?.businessProfile?.tag ||
    ""
  );
}

function resolvePhone(contact, msg, chat) {
  const chatId = chat?.id?._serialized || "";
  const chatUser = chat?.id?.user || "";

  // Quando a mensagem foi enviada por nós (fromMe), queremos o telefone do chat/cliente, não o nosso.
  if (msg?.fromMe) {
    const target =
      msg?.to || // destinatário direto
      chatId || // id completo do chat
      chatUser || // apenas o número do chat, quando disponível
      contact?.number || "";
    return cleanPhone(target);
  }

  const raw =
    contact?.number ||
    chatUser ||
    chatId ||
    msg?.from ||
    msg?.to ||
    "";
  return cleanPhone(raw);
}

function resolveAppName(appEscolhido = "") {
  const app = (appEscolhido || "").trim();
  if (!app) return "com.whatsapp";
  const lower = app.toLowerCase();
  if (lower.includes("assist")) return "assist";
  if (lower.includes("lazer")) return "lazer play";
  if (lower.includes("fun")) return "fun play";
  if (lower.includes("playsim")) return "playsim";
  if (lower.includes("ibo")) return "ibo revenda";
  if (lower.includes("celular")) return "celular";
  return lower;
}

const APP_PROFILES = {
  ASSIST: { keyword: KEYWORD_ASSIST, appName: "assist", display: "🟡 ASSIST PLUS", code: "centertv" },
  LAZER: { keyword: KEYWORD_LAZER, appName: "lazer play", display: "🟡 LAZER PLAY", code: "br99" },
  // FUN usa o mesmo bloco/credencial do LAZER, apenas troca o título exibido
  FUN: { keyword: KEYWORD_LAZER, appName: "lazer play", display: "🟡 FUN PLAY", code: "br99" },
  // PLAYSIM busca o bloco do ASSIST, mas exibe título PLAYSIM
  PLAYSIM: { keyword: KEYWORD_ASSIST, appName: "playsim", display: "🟡 PLAYSIM", code: "centertv" }
};

function nomeSeguro(nome) {
  return (nome || "").trim();
}

function ensureChatId(raw) {
  if (!raw) return null;
  if (raw.includes("@")) return raw;
  const digits = cleanPhone(raw);
  return digits ? `${digits}@c.us` : null;
}

function scheduleFollowup(chatId, nome) {
  const targetId = ensureChatId(chatId);
  if (!targetId || !client) return;

  if (followupTimers.has(targetId)) {
    clearTimeout(followupTimers.get(targetId));
  }

  const fireAt = new Date(Date.now() + FOLLOWUP_MS).toISOString();
  console.log(`[Followup] Agendado para ${targetId} em ${fireAt} (delay ${FOLLOWUP_MS} ms)`);

  const timer = setTimeout(async () => {
    try {
      await client.sendMessage(
        targetId,
        `Seu teste terminou. ${nome ? `${nome}, ` : ""}como foi o teste?`
      );
    } catch (err) {
      console.error("[Followup] Falha ao enviar followup:", err.message);
    } finally {
      followupTimers.delete(targetId);
    }
  }, FOLLOWUP_MS);

  followupTimers.set(targetId, timer);
}

async function gerarTesteSeguro(cliente, nome = "Cliente", appEscolhido = "", mac) {
  try {
    return await gerarTeste(cliente, nome, appEscolhido, mac);
  } catch (err) {
    console.error("[Teste] Falha ao gerar teste:", err.message);
    return null;
  }
}

function cleanPhone(raw) {
  return (raw || "").replace(/[^\d]/g, "");
}

function extrairM3u(texto) {
  if (!texto) return null;

  const linhas = texto
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const urlFromLine = (line) => {
    const m = line.match(/https?:\/\/[^\s]+/i);
    return m ? m[0] : null;
  };

  const preferidas = linhas.filter((l) => /HLS|M3U/i.test(l));
  for (const l of preferidas) {
    const url = urlFromLine(l);
    if (url) return url;
  }

  const mPlus = texto.match(/https?:\/\/[^\s]+m3u_plus[^\s]*/i);
  if (mPlus) return mPlus[0];

  const qualquer = texto.match(/https?:\/\/[^\s]+/i);
  return qualquer ? qualquer[0] : null;
}

function filtrarBloco(texto, keyword) {
  if (!texto) return "";
  const linhas = texto.split(/\r?\n/);
  const keywordUpper = keyword.toUpperCase();
  const headerRegex = /^[ðŸŸ¢ðŸŸ¡ðŸŸ£ðŸŸ ðŸ”´]/;

  let capturando = false;
  const resultado = [];

  for (const linha of linhas) {
    const lineClean = linha.trim();

    if (lineClean.toUpperCase().includes(keywordUpper)) {
      capturando = true;
      resultado.push(lineClean);
      continue;
    }

    if (capturando && headerRegex.test(lineClean) && !lineClean.toUpperCase().includes(keywordUpper)) {
      break;
    }

    if (capturando) resultado.push(lineClean);
  }

  return resultado.join("\n").trim();
}

function extrairUsuarioDoM3u(m3uUrl) {
  if (!m3uUrl) return null;

  try {
    const asUrl = new URL(m3uUrl);
    const paramUser = asUrl.searchParams.get("username");
    if (paramUser) return paramUser;
  } catch (err) {
    // segue para regex fallback
  }

  const paramMatch = m3uUrl.match(/username=([^&]+)/i);
  if (paramMatch) return decodeURIComponent(paramMatch[1]);

  const pathMatch = m3uUrl.match(/\/([A-Za-z0-9._-]{3,})\/[A-Za-z0-9._-]{3,}\/?$/);
  return pathMatch ? pathMatch[1] : null;
}

function extrairMacDeTexto(texto) {
  if (!texto) return null;

  const cleaned = (texto || "")
    .replace(/\bMAC\b\s*[:=\-]?\s*/gi, " ")
    .replace(/[O]/g, "0")
    .replace(/[Il]/g, "1");

  const macRegex = /(?<![0-9A-Fa-f])(?:[0-9A-Fa-f]{2}[\s:\-._]){5}[0-9A-Fa-f]{2}/g;
  const contiguousRegex = /[0-9A-Fa-f]{12,14}/g;

  const candidates = [];

  const pushCandidate = (raw) => {
    if (!raw) return;
    let mac = raw.replace(/[^0-9A-F]/gi, "").toUpperCase();
    if (mac.length < 12) return;
    if (mac.length > 12) mac = mac.slice(0, 12); // tolera lixo apos o MAC (ex.: "....AD 150")
    candidates.push(mac.match(/.{2}/g).join(":"));
  };

  const matches = cleaned.match(macRegex);
  if (matches?.length) matches.forEach(pushCandidate);

  const contiguous = cleaned.match(contiguousRegex);
  if (contiguous?.length) contiguous.forEach(pushCandidate);

  if (!candidates.length) return null;

  // Escolhe o MAC mais provavel: proximidade de "MAC" e comprimento exato 17 com separadores
  const textoUpper = cleaned.toUpperCase();
  const macIndex = textoUpper.indexOf("MAC");

  const score = (mac) => {
    const macWithColons = mac;
    const pos = textoUpper.indexOf(macWithColons);
    const hasExactLen = macWithColons.length === 17;
    let s = 0;
    if (hasExactLen) s += 3;
    if (pos >= 0 && macIndex >= 0) s += Math.max(0, 5 - Math.abs(pos - macIndex) / 5);
    if (pos >= 0) s += 1;
    return s;
  };

  candidates.sort((a, b) => score(b) - score(a));
  return candidates[0] || null;
}

async function lerTextoDaImagem(msg) {
  if (!msg.hasMedia) return { ok: false, texto: "" };

  const media = await msg.downloadMedia();
  if (!media?.data) return { ok: false, texto: "" };

  const buffer = Buffer.from(media.data, "base64");
  const ocr = await Tesseract.recognize(buffer, "eng").catch((err) => {
    console.error("Falha no OCR:", err.message);
    return null;
  });

  const texto = ocr?.data?.text || "";
  return { ok: !!texto.trim(), texto };
}

async function lerMacDaImagem(msg) {
  if (!msg.hasMedia) return { ok: false, reason: "Mensagem nao possui midia" };

  const media = await msg.downloadMedia();
  if (!media?.data) return { ok: false, reason: "Falha ao baixar a midia" };

  const buffer = Buffer.from(media.data, "base64");
  const ocr = await Tesseract.recognize(buffer, "eng").catch((err) => {
    console.error("Falha no OCR:", err.message);
    return null;
  });

  const texto = ocr?.data?.text || "";
  let mac = extrairMacDeTexto(texto);
  let reason = "";
  let textoFallback = "";

  // Fallback: reforca whitelist para tentar evitar ruidos aleatorios
  if (!mac) {
    const ocrFallback = await Tesseract.recognize(buffer, "eng", {
      tessedit_char_whitelist: "0123456789ABCDEFabcdef:",
      preserve_interword_spaces: "1",
      tessedit_pageseg_mode: "6"
    }).catch((err) => {
      console.error("Falha no OCR fallback:", err.message);
      return null;
    });
    textoFallback = ocrFallback?.data?.text || "";
    mac = extrairMacDeTexto(textoFallback || texto);

    if (!mac) {
      const base = (textoFallback || texto || "").trim();
      const hasText = !!base;
      reason = hasText ? "Nenhum padrao de MAC encontrado no texto extraido" : "OCR vazio (sem texto legivel)";
    }
  }

  return { ok: !!mac, mac, rawText: texto, rawTextFallback: textoFallback, reason };
}

function montarMensagemTeste(appEscolhido, nome, phone, mac) {
  const appName = resolveAppName(appEscolhido);
  const appLine = mac && appName === "ibo revenda" ? `${appName.toUpperCase()} - MAC ${mac}` : appName.toUpperCase();
  const nomeLinha = (nome || "").trim();
  const linhas = [
    "Gerado com ChatBot",
    `App: ${appLine || "N/A"}`,
    ...(nomeLinha ? [`NOME: ${nomeLinha}`] : []),
    `WHATSAPP: ${phone || ""}`,
    "User-Agent: +TVBot"
  ];

  return linhas.join("\n");
}

async function gerarTeste(cliente, nome = "Cliente", appEscolhido = "", mac) {
  const phoneClean = cleanPhone(cliente);
  const nomeFinal = nomeSeguro(nome);
  const appName = resolveAppName(appEscolhido);
  const payload = {
    appName,
    messageDateTime: Math.floor(Date.now() / 1000),
    devicePhone: DEVICE_PHONE,
    deviceName: "Emex Device",
    senderName: nomeFinal,
    senderMessage: montarMensagemTeste(appName, nomeFinal, phoneClean, mac),
    senderPhone: phoneClean,
    userAgent: "+TVBot",
    // Campos extras para o painel: nome e whatsapp do cliente
    customerName: nomeFinal,
    customerWhatsapp: phoneClean
  };

  const res = await axios.post(
    "https://painel.newbr.top/api/chatbot/ywDmJeJWpR/o231qzL4qz",
    payload,
    {
      headers: { "Content-Type": "application/json" },
      auth: { username: "vendaiptv", password: "suporte+TV1" }
    }
  );

  return res.data.reply;
}

function detectouLimite(texto) {
  if (!texto) return false;
  const normalizado = texto.normalize("NFD").toLowerCase();
  return normalizado.includes("ja solicitou");
}

function extrairCredenciais(bloco) {
  if (!bloco) return {};
  const lines = bloco.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let codigo, usuario, senha;

  for (const line of lines) {
    const cleanLine = line.replace(/[*_]/g, "");
    if (!codigo) {
      const mCod = cleanLine.match(/cod(?:igo)?[:=\-]?\s*([^\s]+)/i);
      if (mCod) codigo = mCod[1];
    }
    if (!usuario) {
      const mUser = cleanLine.match(/(?:usuario|usuário|user|login)[:=\-]?\s*(.+)/i);
      if (mUser) usuario = mUser[1].trim();
    }
    if (!senha) {
      const mPass = cleanLine.match(/(?:senha|password|pass)[:=\-]?\s*(.+)/i);
      if (mPass) senha = mPass[1].trim();
    }
  }
  return { codigo, usuario, senha };
}

async function responderComTeste(msg, phone, nome, profile, mac) {
  const { keyword, appName, display, code: defaultCode } = profile;
  const reply = await gerarTesteSeguro(phone, nome, appName, mac);
  if (!reply) {
    await msg.reply("So um momento! Vou chamar um dos atendentes.");
    return;
  }

  if (detectouLimite(reply)) {
    await msg.reply(MSG_TESTE_ATIVO);
    return;
  }

  let filtrado = filtrarBloco(reply, keyword);

  if (!filtrado) {
    await msg.reply(`Nao encontrei conteudo para ${keyword}.`);
    return;
  }

  // Remove palavras-chave e comandos antes de enviar ao cliente
  const keywordRegex = new RegExp(keyword, "gi");
  const comandosRegex = new RegExp(
    `${COMMANDS.LAZER}|${COMMANDS.ASSIST}|${COMMANDS.FUN}|${COMMANDS.PLAYSIM}`,
    "gi"
  );
  filtrado = filtrado.replace(keywordRegex, "").replace(comandosRegex, "").trim();

  const cred = extrairCredenciais(filtrado);
  const codigoFinal = cred.codigo || defaultCode;

  if (cred.usuario || cred.senha || codigoFinal) {
    const partes = [display, ""];
    if (codigoFinal) partes.push(`✅   Cod: ${codigoFinal}`);
    if (cred.usuario) partes.push(`✅  *Usuário:* ${cred.usuario}`);
    if (cred.senha) partes.push(`✅  *Senha:* ${cred.senha}`);
    await msg.reply(partes.join("\n"));
  } else {
    await msg.reply(filtrado);
  }

  console.log(`[${appName}] Teste enviado para ${phone}`);
  scheduleFollowup(msg.from, nome);
}

async function iniciarTesteIbo(mac, msg, phone, nome) {
  const macSanitized = (mac || "").trim();
  if (!macSanitized) {
    await msg.reply("MAC nao identificado. Envie a imagem com o MAC visivel, por favor.");
    return;
  }

  const reply = await gerarTesteSeguro(phone, nome, "IBO REVENDA", macSanitized);
  if (!reply) {
    await msg.reply("So um momento! Vou chamar um dos atendentes.");
    return;
  }
  if (detectouLimite(reply)) {
    fluxoCelular.delete(phone);
    await msg.reply(MSG_TESTE_ATIVO);
    return;
  }

  const m3u = extrairM3u(reply);
  if (!m3u) {
    await msg.reply("Nao consegui extrair o link M3U do teste.");
    return;
  }

  const username = extrairUsuarioDoM3u(m3u) || nome || phone;
  const serverName = `TVAUTO ${username || "Cliente"}`;
  const observacoes = `Teste Gerado via Chatbot\nMAC: ${macSanitized}`;

  try {
    await criarUsuarioGerenciaAppComM3u(m3u, {
      mac: macSanitized,
      serverName,
      app: "IBO",
      nome,
      whatsapp: phone,
      observacoes,
      minimalFields: true
    });
  } catch (err) {
    console.error("[IBO] Falha ao cadastrar no GerenciaApp:", err.message);
    await msg.reply("Falha ao salvar no GerenciaApp, tente novamente mais tarde.");
    return;
  }

  await msg.reply(MSG_TESTE_IBO_OK);
  if (msg?.from) {
    scheduleFollowup(msg.from, nome);
  }
}

async function handleIboImagem(msg, phone, nome) {
  const leitura = await lerMacDaImagem(msg);

  if (!leitura.ok || !leitura.mac) {
    if (leitura.reason) {
      console.log(`[IBO] OCR nao encontrou MAC (${phone} - ${nome}). Motivo: ${leitura.reason}`);
    }
    aguardandoMac.add(phone);
    logFluxoIdentificado("IBO - MAC", phone, nome);
    await msg.reply("Nao consegui ler o MAC. Envie outra foto com os dados bem visiveis ou responda com #IBO + o MAC digitado (ex.: #IBO 00:11:22:33:44:55).");
    return;
  }

  aguardandoMac.delete(phone);
  console.log(`[IBO] MAC detectado (${phone} - ${nome}): ${leitura.mac}`);
  await iniciarTesteIbo(leitura.mac, msg, phone, nome);
}

async function handleIboMensagemMarcada(msg, phone, nome) {
  if (!msg.hasQuotedMsg) {
    console.log(`[IBO] Mensagem ${msg.id?._serialized || ""} sem quotedMsg para ${phone}`);
    return false;
  }

  const quoted = await msg.getQuotedMessage().catch((err) => {
    console.log("[IBO] Falha ao obter quotedMsg:", err?.message);
    return null;
  });
  if (!quoted) return false;

  if (!quoted.hasMedia) {
    console.log(`[IBO] QuotedMsg sem media para ${phone}`);
    await msg.reply("A mensagem marcada nao tem imagem. Encaminhe a imagem com o MAC ou envie novamente marcando a foto.");
    return true;
  }

  const leitura = await lerMacDaImagem(quoted);
  if (!leitura.ok || !leitura.mac) {
    console.log(`[IBO] OCR falhou em quotedMsg para ${phone}`);
    if (leitura.reason) {
      console.log(`[IBO] Motivo: ${leitura.reason}`);
    }
    await msg.reply("Nao consegui ler o MAC na mensagem marcada. Envie outra foto com os dados bem visiveis.");
    return true;
  }

  aguardandoMac.delete(phone);
  console.log(`[IBO] MAC detectado de mensagem marcada (${phone} - ${nome}): ${leitura.mac}`);
  await iniciarTesteIbo(leitura.mac, msg, phone, nome);
  return true;
}

function textoSim(textoLower) {
  return ["sim", "s", "yes", "yep", "isso", "pode", "ok", "okay"].some((k) => {
    const re = new RegExp(`\\b${k}\\b`, "i");
    return re.test(textoLower);
  });
}

function textoNao(textoLower) {
  return ["nao", "nÃ£o", "n", "no", "negativo"].some((k) => {
    const re = new RegExp(`\\b${k}\\b`, "i");
    return re.test(textoLower);
  });
}

function textoConfirmacaoLazer(textoLower) {
  const termos = ["consegui", "baixei", "abri", "abri agora", "abri o app", "abri o aplicativo", "sim"];
  return termos.some((k) => {
    const re = new RegExp(`\\b${k}\\b`, "i");
    return re.test(textoLower);
  });
}

async function concluirFluxoCelular(msg, phone, nome, macFromMedia) {
  const estado = fluxoCelular.get(phone) || {};
  const mac = macFromMedia || estado.mac;

  if (!mac) {
    fluxoCelular.set(phone, {
      ...estado,
      mac: null,
      stage: "aguardando_prova",
      confirming: false,
      printReminderSent: true
    });
    await msg.reply("Preciso de uma foto com o MAC visivel para liberar. Envie a imagem do app aberto, por favor.");
    return;
  }

  const reply = await gerarTesteSeguro(phone, nome, "CELULAR");
  if (!reply) {
    await msg.reply("So um momento! Vou chamar um dos atendentes.");
    return;
  }
  if (detectouLimite(reply)) {
    fluxoCelular.delete(phone);
    await msg.reply(MSG_TESTE_ATIVO);
    return;
  }

  const m3u = extrairM3u(reply);
  if (!m3u) {
    console.log("[CELULAR] Nao foi possivel extrair M3U do teste para cadastro.");
    await msg.reply("Seu teste foi gerado! Fecha o app e abre novamente.");
    scheduleFollowup(msg.from, nome);
    return;
  }

  const username = extrairUsuarioDoM3u(m3u) || nome || phone;
  const serverName = `TVAUTO ${username || "Cliente"}`;
  const observacoes = `Teste Gerado via Chatbot\nMAC: ${mac}`;

  try {
    await criarUsuarioGerenciaAppComM3u(m3u, {
      mac,
      serverName,
      app: "IBO REVENDA",
      nome,
      whatsapp: phone,
      observacoes,
      minimalFields: true
    });
    console.log(`[CELULAR] Cadastro GerenciaApp OK para ${phone} (${serverName})`);
  } catch (err) {
    console.error('[CELULAR] Falha ao cadastrar no GerenciaApp:', err.message);
  } finally {
    fluxoCelular.delete(phone);
  }

  await msg.reply("Seu teste foi gerado! Fecha o app e abre novamente.");
  scheduleFollowup(msg.from, nome);
}

async function handleFluxoCelular(msg, phone, nome, textoLower) {
  const estado = fluxoCelular.get(phone);

  if (!estado) return false;

  if (estado?.confirming) {
    if (textoSim(textoLower)) {
      fluxoCelular.set(phone, { ...estado, confirming: false });
      if (estado.stage === "aguardando_prova") {
        await msg.reply(MSG_PEDIR_PRINT);
      }
      return true;
    }
    if (textoNao(textoLower)) {
      fluxoCelular.delete(phone);
      await msg.reply("Um atendente vai responder em instantes. Obrigado!");
      return true;
    }
    return false;
  }

  if (estado.stage === "aguardando_prova") {
    if (!estado.printReminderSent) {
      fluxoCelular.set(phone, { ...estado, printReminderSent: true });
      await msg.reply(MSG_PEDIR_PRINT);
    }
    return true;
  }

  return false;
}

async function handleFluxoLazerImagem(msg, phone, nome) {
  const leitura = await lerTextoDaImagem(msg);
  if (!leitura.ok) {
    await msg.reply("Nao consegui ler a imagem. Envie uma foto mais nitida da tela da TV, por favor.");
    return true;
  }

  const textoUpper = (leitura.texto || "").toUpperCase();
  const hasPlaylist = textoUpper.includes("PLAYLIST");
  const hasLista = textoUpper.includes("LISTA");
  const hasCodigo = textoUpper.includes("CODIGO") || textoUpper.includes("CODE");

  if ((hasPlaylist || hasLista) && !hasCodigo) {
    fluxoLazer.set(phone, { stage: "aguardando_playlist_click" });
    await msg.reply("Aperta na opcao Playlist/Lista e me envia a tela seguinte para liberar o teste.");
    return true;
  }

  if ((hasPlaylist || hasLista) && hasCodigo) {
    fluxoLazer.delete(phone);
    await msg.reply("Gerando o teste. Use o codigo enviado para preencher no app.");
    await responderComTeste(msg, phone, nome, APP_PROFILES.LAZER);
    return true;
  }

  if (hasCodigo) {
    fluxoLazer.delete(phone);
    await responderComTeste(msg, phone, nome, APP_PROFILES.LAZER);
    return true;
  }

  await msg.reply("Preciso da tela do app (menu ou tela de adicionar lista). Envie uma foto nA-tida, por favor.");
  return true;
}

async function handleFluxoLazerMensagem(msg, phone, textoLower) {
  const estado = fluxoLazer.get(phone);
  if (!estado) return false;

  if (estado.stage === "aguardando_playlist_click") {
    await msg.reply("Clica na opcao Playlist e me envia a tela seguinte, por favor.");
    return true;
  }

  if (textoConfirmacaoLazer(textoLower)) {
    await msg.reply("Beleza! Me envia uma foto da tela da TV para seguirmos o fluxo.");
  } else {
    await msg.reply("So um momento que ja te respondo, por favor.");
  }

  return true;
}

async function iniciarFluxoLazer(msg, phone) {
  fluxoLazer.set(phone, { stage: "aguardando_foto" });
  logFluxoIdentificado("LAZER", phone, (msg && resolveNome(await msg.getContact().catch(() => null), await msg.getChat().catch(() => null), phone)) || phone);
  if (msg) {
    await msg.reply("Vamos seguir. Envie uma foto da tela da TV do app para continuar.");
  }
}

async function processMessage(msg) {
  const contact = await msg.getContact().catch(() => null);
  const chat = await msg.getChat().catch(() => null);
  const phone = resolvePhone(contact, msg, chat);
  const nome = resolveNome(contact, chat, phone);
  const texto = (msg.body || "").trim();
  const textoLower = texto.toLowerCase();

  console.log(`[MSG] ${phone} (${nome}): ${texto}`);

  const estadoLazer = fluxoLazer.get(phone);

  if (msg.hasMedia) {
    const comandoMidiaIbo = texto.toUpperCase().includes(COMMANDS.IBO);

    if (estadoLazer) {
      await handleFluxoLazerImagem(msg, phone, nome);
      return;
    }

    if (aguardandoMac.has(phone) || comandoMidiaIbo) {
      await handleIboImagem(msg, phone, nome);
      return;
    }

    const estadoCelular = fluxoCelular.get(phone);
    if (estadoCelular?.stage === "aguardando_prova") {
      const leitura = await lerMacDaImagem(msg);
      if (leitura.ok && leitura.mac) {
        fluxoCelular.set(phone, { ...estadoCelular, mac: leitura.mac, confirming: false, printReminderSent: true });
        console.log(`[CELULAR] MAC detectado (${phone} - ${nome}): ${leitura.mac}`);
        await concluirFluxoCelular(msg, phone, nome, leitura.mac);
      } else {
        if (leitura.reason) {
          console.log(`[CELULAR] OCR nao encontrou MAC (${phone} - ${nome}). Motivo: ${leitura.reason}`);
        }
        fluxoCelular.delete(phone);
        await msg.reply("Nao consegui identificar o MAC. Um atendente vai te chamar para finalizar, tudo bem?");
      }
      return;
    }
    return;
  }

  const comando = texto.toUpperCase();

  if (aguardandoMac.has(phone) && comando.includes(COMMANDS.IBO)) {
    const macInline = extrairMacDeTexto(texto);
    if (macInline) {
      aguardandoMac.delete(phone);
      console.log(`[IBO] MAC em texto detectado (aguardandoMac) ${phone} - ${nome}: ${macInline}`);
      await iniciarTesteIbo(macInline, msg, phone, nome);
      return;
    }
    await msg.reply("Envie o MAC junto ao #IBO (ex.: #IBO 00:11:22:33:44:55).");
    return;
  }

  const perfilComando =
    comando.includes(COMMANDS.ASSIST) ? APP_PROFILES.ASSIST :
    comando.includes(COMMANDS.LAZER) ? APP_PROFILES.LAZER :
    comando.includes(COMMANDS.FUN) ? APP_PROFILES.FUN :
    comando.includes(COMMANDS.PLAYSIM) ? APP_PROFILES.PLAYSIM :
    null;

  if (perfilComando) {
    await responderComTeste(msg, phone, nome, perfilComando);
    return;
  }

  if (comando.includes(COMMANDS.IBO)) {
    console.log(`[IBO] Comando detectado para ${phone} (${nome}). hasQuotedMsg=${msg.hasQuotedMsg}`);

    const macInline = extrairMacDeTexto(texto);
    if (macInline) {
      console.log(`[IBO] MAC em texto detectado (${phone} - ${nome}): ${macInline}`);
      await iniciarTesteIbo(macInline, msg, phone, nome);
      return;
    }

    const handledQuoted = await handleIboMensagemMarcada(msg, phone, nome);
    if (handledQuoted) return;

    aguardandoMac.add(phone);
    logFluxoIdentificado("IBO - MAC", phone, nome);
    console.log(`[IBO] Aguardando imagem com MAC de ${phone} (${nome})`);
    await msg.reply("Envie a imagem contendo o MAC do dispositivo para continuar.");
    return;
  }

  if (estadoLazer) {
    const handledLazer = await handleFluxoLazerMensagem(msg, phone, textoLower);
    if (handledLazer) return;
  }

  const handledFluxoCelular = await handleFluxoCelular(msg, phone, nome, textoLower);
  if (handledFluxoCelular) return;
}

const AUTH_PATH = process.env.WWEB_AUTH_PATH || ".wwebjs_auth";
const client = new Client({
  authStrategy: new LocalAuth({ dataPath: AUTH_PATH }),
  puppeteer: {
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  }
});

client.on("qr", (qr) => {
  touchActivity();
  latestQr = qr;
  const qrImgUrl = `https://api.qrserver.com/v1/create-qr-code/?size=320x320&data=${encodeURIComponent(qr)}`;
  console.log("QR Code gerado. Abra o link abaixo para escanear em qualquer dispositivo (copie e cole no navegador):");
  console.log(qrImgUrl);
  console.log(`Opcional (se tiver acesso local): http://localhost:${QR_PORT}/qr`);
  qrcode.generate(qr, { small: true });
});

client.on("ready", () => {
  touchActivity();
  console.log("Cliente WhatsApp conectado e pronto para receber mensagens.");
});

client.on("message", async (msg) => {
  touchActivity();
  await processMessage(msg).catch((err) => console.error("Erro ao processar mensagem:", err.message));

  // Log estruturado conforme modelo solicitado
  const contact = await msg.getContact().catch(() => null);
  const chat = await msg.getChat().catch(() => null);
  const phone = resolvePhone(contact, msg, chat);
  let labels = [];
  if (chat?.getLabels) {
    try {
      labels = await chat.getLabels();
    } catch (err) {
      labels = [];
    }
  }
  labels = (labels || []).filter(Boolean);
  const etiqueta = labels.length ? labels.map((l) => l.name || "").filter(Boolean).join(", ") : "Sem etiqueta";
  const nome =
    contact?.verifiedName || // nome oficial/WhatsApp Business
    contact?.pushname || // nome exibido
    contact?.shortName ||
    chat?.name || // tÃ­tulo do chat (costuma trazer o nome salvo)
    contact?.businessProfile?.tag || // fallback de tag de perfil
    "";
  const corpo = (msg.body || "").trim();

  const timestamp = new Date().toISOString();
  console.log(
    `\n===== MENSAGEM RECEBIDA =====\n` +
    `Data/Hora: ${timestamp}\n` +
    `Etiqueta do Cliente: ${etiqueta}\n` +
    `Nome do WhatsApp: ${nome}\n` +
    `Telefone do Cliente: ${phone}\n` +
    `Mensagem: ${corpo || "<sem texto>"}\n` +
    `============================\n`
  );
});

// Log estruturado para mensagens enviadas pela prÃ³pria conta
client.on("message_create", async (msg) => {
  if (!msg.fromMe) return;
  touchActivity();

  const phone = resolvePhone(await msg.getContact().catch(() => null), msg, await msg.getChat().catch(() => null)) || cleanPhone(msg.to || msg.from);
  const corpo = (msg.body || "").trim();
  const corpoUpper = corpo.toUpperCase();
  const contact = await msg.getContact().catch(() => null);
  const chat = await msg.getChat().catch(() => null);
  const nome =
    contact?.verifiedName ||
    contact?.pushname ||
    contact?.shortName ||
    chat?.name ||
    contact?.businessProfile?.tag ||
    "";

  if (isInstrucaoMensagem(corpo)) {
    fluxoCelular.set(phone, { stage: "aguardando_prova", confirming: false, printReminderSent: false, mac: null });
    logFluxoIdentificado("CELULAR/IBO", phone, nome);
  }
  if (isInstrucaoLazer(corpo)) {
    await iniciarFluxoLazer(null, phone);
    console.log(`[LAZER] Instrucao detectada para ${phone}. Aguardando a foto do cliente para seguir com o teste.`);
  }

  let labels = [];
  if (chat?.getLabels) {
    try {
      labels = await chat.getLabels();
    } catch {
      labels = [];
    }
  }
  labels = (labels || []).filter(Boolean);
  const etiqueta = labels.length ? labels.map((l) => l.name || "").filter(Boolean).join(", ") : "Sem etiqueta";

  // Permite acionar #IBO via mensagem enviada (resposta marcada ou MAC inline)
  if (corpoUpper.includes(COMMANDS.IBO)) {
    console.log(`[IBO] Comando enviado (fromMe) para ${phone} (${nome}). hasQuotedMsg=${msg.hasQuotedMsg}`);

    const macInline = extrairMacDeTexto(corpo);
    if (macInline) {
      await iniciarTesteIbo(macInline, msg, phone, nome);
    } else {
      const handled = await handleIboMensagemMarcada(msg, phone, nome);
      if (!handled) {
        await msg.reply("Marque a imagem com o MAC ou envie o MAC junto ao #IBO.");
      }
    }
  }

  // Permite acionar testes em mensagens enviadas (fromMe)
  if (corpoUpper.includes(COMMANDS.ASSIST)) {
    await responderComTeste(msg, phone, nome, APP_PROFILES.ASSIST);
  } else if (corpoUpper.includes(COMMANDS.LAZER)) {
    await responderComTeste(msg, phone, nome, APP_PROFILES.LAZER);
  } else if (corpoUpper.includes(COMMANDS.FUN)) {
    await responderComTeste(msg, phone, nome, APP_PROFILES.FUN);
  } else if (corpoUpper.includes(COMMANDS.PLAYSIM)) {
    await responderComTeste(msg, phone, nome, APP_PROFILES.PLAYSIM);
  }

  const timestamp = new Date().toISOString();

  console.log(
    `\n===== MENSAGEM ENVIADA =====\n` +
      `Data/Hora: ${timestamp}\n` +
      `Etiqueta do Cliente: ${etiqueta}\n` +
      `Nome do WhatsApp: ${nome}\n` +
      `Telefone do Cliente: ${phone}\n` +
      `Mensagem: ${corpo || "<sem texto>"}\n` +
      `==========================\n`
  );
});

client.initialize();

// Servidor simples para exibir o QR em pagina web
app.get("/", (_req, res) => res.redirect("/qr"));
app.get("/qr", (_req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  const html = `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <title>QR WhatsApp</title>
    <meta http-equiv="refresh" content="6" />
    <style>
      body { font-family: Arial, sans-serif; background: #0f172a; color: #e2e8f0; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
      .card { background: #1e293b; padding: 24px 28px; border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,0.35); text-align: center; }
      #qrcode { margin: 16px auto; }
      .info { font-size: 14px; color: #cbd5e1; }
    </style>
  </head>
  <body>
    <div class="card">
      <h2>Escaneie o QR do WhatsApp</h2>
      <div id="qrcode"></div>
      <div class="info">A pÃ¡gina atualiza a cada 6s enquanto um novo QR estiver disponÃ­vel.</div>
    </div>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
    <script>
      const qrData = ${JSON.stringify(latestQr || "")};
      if (qrData) {
        new QRCode(document.getElementById("qrcode"), {
          text: qrData,
          width: 280,
          height: 280
        });
      } else {
        document.getElementById("qrcode").innerHTML = "<p>QR ainda nÃ£o gerado.</p>";
      }
    </script>
  </body>
</html>`;
  res.send(html);
});

app.get("/qr.json", (_req, res) => {
  res.json({ qr: latestQr || null });
});

app.listen(QR_PORT, () => {
  console.log(`Servidor de QR em http://localhost:${QR_PORT}/qr`);
});

// Ping periÃ³dico opcional para manter o serviÃ§o acordado (defina SELF_PING_URL)
function startKeepAlive() {
  if (!SELF_PING_URL) {
    console.log("Keep-alive desativado (defina SELF_PING_URL para habilitar).");
    return;
  }
  const interval = Number(process.env.SELF_PING_INTERVAL_MS || 240000); // default 4 min
  console.log(`Keep-alive ligado: ping em ${SELF_PING_URL} a cada ${interval} ms`);
  setInterval(() => {
    axios
      .get(SELF_PING_URL)
      .then(() => console.log("Keep-alive ping OK"))
      .catch((err) => console.log("Keep-alive falhou:", err.message));
  }, interval);
}

startKeepAlive();

// Log de ociosidade: se ficar sem eventos por IDLE_LOG_MS, imprime aviso
setInterval(() => {
  const agora = Date.now();
  if (agora - lastActivity >= IDLE_LOG_MS) {
    console.log("Aguardando mensagens...");
    touchActivity();
  }
}, Math.max(60000, Math.min(IDLE_LOG_MS, 300000))); // checa entre 1 e 5 minutos
