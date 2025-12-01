import wweb from "whatsapp-web.js";
import qrcode from "qrcode-terminal";
import axios from "axios";
import Tesseract from "tesseract.js";
import { criarUsuarioGerenciaAppComM3u } from "./gerenciaApp.js";

const { Client, LocalAuth } = wweb;

const DEVICE_PHONE = "5524999162165";
const KEYWORD_ASSIST = "ASSIST PLUS";
const KEYWORD_LAZER = "LAZER PLAY";
const COMMANDS = {
  ASSIST: "#ASSIST",
  LAZER: "#LAZER",
  IBO: "#IBO"
};

const aguardandoMac = new Set();
const fluxoCelular = new Map(); // { stage: 'aguardando_escolha'|'aguardando_prova', confirming: bool, mac?: string }

function resolveNome(contact, chat, phone) {
  return (
    contact?.verifiedName ||
    contact?.pushname ||
    contact?.name ||
    contact?.shortName ||
    chat?.name ||
    contact?.businessProfile?.tag ||
    contact?.number ||
    phone ||
    "Cliente"
  );
}

function nomeSeguro(nome, phone) {
  const n = (nome || "").trim();
  return n || phone || "Cliente";
}

async function gerarTesteSeguro(cliente, nome = "Cliente", appEscolhido = "") {
  try {
    return await gerarTeste(cliente, nome, appEscolhido);
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
  const headerRegex = /^[🟢🟡🟣🟠🔴]/;

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

  const padroes = [
    /(?:[0-9A-Fa-f]{2}[:\-]){5}[0-9A-Fa-f]{2}/g,
    /\b[0-9A-Fa-f]{12}\b/g
  ];

  for (const regex of padroes) {
    const encontrado = texto.match(regex);
    if (encontrado && encontrado.length) {
      let mac = encontrado[0].replace(/[^0-9A-Fa-f]/g, "").toUpperCase();
      if (mac.length === 12) {
        mac = mac.match(/.{1,2}/g).join(":");
      }
      return mac;
    }
  }
  return null;
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
  const mac = extrairMacDeTexto(texto);

  return { ok: !!mac, mac, rawText: texto };
}

function montarMensagemTeste(appEscolhido, nome, phone) {
  const linhas = [
    "gerar teste",
    "TESTE ATIVADO VIA CHATBOT",
    `APLICATIVO ESCOLHIDO: ${appEscolhido || "N/A"}`,
    `NOME: ${nome || "Cliente"}`,
    `WHATSAPP: ${phone || ""}`
  ];

  return linhas.join("\n");
}

async function gerarTeste(cliente, nome = "Cliente", appEscolhido = "") {
  const nomeFinal = nomeSeguro(nome, cliente);
  const payload = {
    appName: "com.whatsapp",
    messageDateTime: Math.floor(Date.now() / 1000),
    devicePhone: DEVICE_PHONE,
    deviceName: "Emex Device",
    senderName: nomeFinal,
    senderMessage: montarMensagemTeste(appEscolhido, nomeFinal, cliente),
    senderPhone: cliente,
    userAgent: "BotBot.Chat",
    // Campos extras para o painel: nome e whatsapp do cliente
    customerName: nomeFinal,
    customerWhatsapp: cliente
  };

  const res = await axios.post(
    "https://painel.newbr.top/api/chatbot/V01pz25DdO/o231qzL4qz",
    payload,
    { headers: { "Content-Type": "application/json" } }
  );

  return res.data.reply;
}

function detectouLimite(texto) {
  if (!texto) return false;
  const normalizado = texto.normalize("NFD").toLowerCase();
  return normalizado.includes("ja solicitou");
}

async function responderComTeste(msg, phone, nome, keyword, appNome) {
  const reply = await gerarTesteSeguro(phone, nome, appNome);
  if (!reply) {
    await msg.reply("Servico de testes indisponivel agora. Tente novamente em instantes.");
    return;
  }

  if (detectouLimite(reply)) {
    await msg.reply("Voce ja solicitou um teste hoje.");
    return;
  }

  const filtrado = filtrarBloco(reply, keyword);

  if (!filtrado) {
    await msg.reply(`Nao encontrei conteudo para ${keyword}.`);
    return;
  }

  await msg.reply(filtrado);
  console.log(`[${appNome}] Teste enviado para ${phone}`);
}

async function handleIboImagem(msg, phone, nome) {
  const leitura = await lerMacDaImagem(msg);

  if (!leitura.ok || !leitura.mac) {
    await msg.reply("Nao consegui ler o MAC. Envie outra foto com os dados bem visiveis.");
    return;
  }

  aguardandoMac.delete(phone);
  console.log(`[IBO] MAC detectado (${phone} - ${nome}): ${leitura.mac}`);

  const reply = await gerarTesteSeguro(phone, nome, "IBO");
  if (!reply) {
    await msg.reply("Servico de testes indisponivel agora. Tente novamente em instantes.");
    return;
  }
  if (detectouLimite(reply)) {
    await msg.reply("Voce ja solicitou um teste hoje.");
    return;
  }

  const m3u = extrairM3u(reply);
  if (!m3u) {
    await msg.reply("Nao consegui extrair o link M3U do teste.");
    return;
  }

  const username = extrairUsuarioDoM3u(m3u) || nome || phone;
  const serverName = `TVAUTO ${username || "Cliente"}`;
  const observacoes = `Teste Gerado via Chatbot\nMAC: ${leitura.mac}`;

  try {
    await criarUsuarioGerenciaAppComM3u(m3u, {
      mac: leitura.mac,
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

  await msg.reply("Teste Liberado, pode abrir o app agora?");
}

function querFluxoCelular(textoLower) {
  if (!textoLower) return false;
  const regexApp = /\bapp\b/;
  return (
    textoLower.includes("celular") || // somente vamos seguir fluxo celular
    regexApp.test(textoLower)
  );
}

function textoConfirmaDownload(textoLower) {
  if (!textoLower) return false;
  return (
    textoLower.includes("consegui") ||
    textoLower.includes("baixei") ||
    textoLower.includes("instalei") ||
    textoLower.includes("instalado") ||
    textoLower.includes("pronto") ||
    textoLower.includes("abri") ||
    textoLower.includes("aberto") ||
    textoLower.includes("print") ||
    textoLower.includes("screenshot")
  );
}

function textoSim(textoLower) {
  return ["sim", "s", "yes", "yep", "isso", "pode", "ok", "okay"].some((k) => {
    const re = new RegExp(`\\b${k}\\b`, "i");
    return re.test(textoLower);
  });
}

function textoNao(textoLower) {
  return ["nao", "não", "n", "no", "negativo"].some((k) => {
    const re = new RegExp(`\\b${k}\\b`, "i");
    return re.test(textoLower);
  });
}

async function iniciarFluxoCelular(msg, nome, phone) {
  fluxoCelular.set(phone, { stage: "aguardando_escolha", confirming: false });
  await msg.reply("Deseja testar por onde?\n- Televisao\n- Celular\n- Iphone\n- TVBOX");
}

async function enviarPassoCelular(msg) {
  await msg.reply(`Clica *NESSE LINK* pra baixar o aplicativo 👇🏻\n\nhttps://play.google.com/store/apps/details?id=com.colinet.boxv3&hl=pt_BR`);
  await msg.reply("Voce vai baixar o aplicativo, instalar e abrir.\nAssim que abrir me manda um print do aplicativo aberto ou diga 'baixei' aqui pra eu liberar seu teste.");
}

async function concluirFluxoCelular(msg, phone, nome, macFromMedia) {
  const estado = fluxoCelular.get(phone) || {};
  const mac = macFromMedia || estado.mac;

  if (!mac) {
    fluxoCelular.set(phone, { ...estado, mac: null, stage: "aguardando_prova", confirming: false });
    await msg.reply("Preciso de uma foto com o MAC visivel para liberar. Envie a imagem e tente novamente.");
    return;
  }

  const reply = await gerarTesteSeguro(phone, nome, "CELULAR");
  if (!reply) {
    await msg.reply("Servico de testes indisponivel agora. Tente novamente em instantes.");
    return;
  }
  if (detectouLimite(reply)) {
    await msg.reply("Voce ja solicitou um teste hoje.");
    return;
  }

  const m3u = extrairM3u(reply);
  if (!m3u) {
    console.log("[CELULAR] Nao foi possivel extrair M3U do teste para cadastro.");
    await msg.reply("Seu teste foi gerado! Fecha o app e abre novamente.");
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
    console.error("[CELULAR] Falha ao cadastrar no GerenciaApp:", err.message);
  } finally {
    fluxoCelular.delete(phone);
  }

  await msg.reply("Seu teste foi gerado! Fecha o app e abre novamente.");
}

async function handleFluxoCelular(msg, phone, nome, textoLower) {
  const estado = fluxoCelular.get(phone);

  // Responde a confirmacao pendente
  if (estado?.confirming) {
    if (textoSim(textoLower)) {
      fluxoCelular.set(phone, { ...estado, confirming: false });
      if (estado.stage === "aguardando_prova") {
        await msg.reply("Perfeito, continue: mande um print do app aberto ou escreva 'baixei' para liberar seu teste.");
      } else {
        await msg.reply('Certo! Responda "Celular" para eu te mandar o link e instrucoes.');
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

  if (estado?.stage === "aguardando_prova") {
    if (textoConfirmaDownload(textoLower)) {
      await concluirFluxoCelular(msg, phone, nome, estado.mac);
      return true;
    }
    // fora do esperado, pergunta uma unica vez
    fluxoCelular.set(phone, { ...estado, confirming: true });
    await msg.reply("O teste e pelo celular, certo? Responda SIM para continuar ou NAO para falar com um atendente.");
    return true;
  }

  if (estado?.stage === "aguardando_escolha") {
    if (textoLower.includes("celular")) {
      fluxoCelular.set(phone, { stage: "aguardando_prova", confirming: false });
      await enviarPassoCelular(msg);
      return true;
    }

    // fluxo so atende celular: confirma uma unica vez e, se nao, sai
    fluxoCelular.set(phone, { ...estado, confirming: true });
    await msg.reply("Esse fluxo e apenas para instalar no celular. Responda SIM para continuar ou NAO para falar com um atendente.");
    return true;
  }

  if (!estado && querFluxoCelular(textoLower)) {
    if (textoLower.includes("celular")) {
      fluxoCelular.set(phone, { stage: "aguardando_prova", confirming: false });
      await enviarPassoCelular(msg);
      return true;
    } else {
      await iniciarFluxoCelular(msg, nome, phone);
      return true;
    }
  }

  return false;
}

async function processMessage(msg) {
  const phone = cleanPhone(msg.from);

  const contact = await msg.getContact().catch(() => null);
  const chat = await msg.getChat().catch(() => null);
  const nome = resolveNome(contact, chat, phone);
  const texto = (msg.body || "").trim();
  const textoLower = texto.toLowerCase();

  console.log(`[MSG] ${phone} (${nome}): ${texto}`);

  if (msg.hasMedia) {
    if (aguardandoMac.has(phone)) {
      await handleIboImagem(msg, phone, nome);
      return;
    }

    const estadoCelular = fluxoCelular.get(phone);
    if (estadoCelular?.stage === "aguardando_prova") {
      const leitura = await lerMacDaImagem(msg);
      if (leitura.ok && leitura.mac) {
        fluxoCelular.set(phone, { ...estadoCelular, mac: leitura.mac, confirming: false });
        console.log(`[CELULAR] MAC detectado (${phone} - ${nome}): ${leitura.mac}`);
        await concluirFluxoCelular(msg, phone, nome, leitura.mac);
      } else {
        await msg.reply("Nao consegui ler o MAC. Envie outra foto com os dados bem visiveis (precisa aparecer o MAC).");
      }
      return;
    }
    return;
  }

  const comando = texto.toUpperCase();

  if (comando.includes(COMMANDS.ASSIST)) {
    await responderComTeste(msg, phone, nome, KEYWORD_ASSIST, "ASSIST");
    return;
  }

  if (comando.includes(COMMANDS.LAZER)) {
    await responderComTeste(msg, phone, nome, KEYWORD_LAZER, "LAZER");
    return;
  }

  if (comando.includes(COMMANDS.IBO)) {
    aguardandoMac.add(phone);
    console.log(`[IBO] Aguardando imagem com MAC de ${phone} (${nome})`);
    await msg.reply("Envie a imagem contendo o MAC do dispositivo para continuar.");
    return;
  }

  const handledFluxoCelular = await handleFluxoCelular(msg, phone, nome, textoLower);
  if (handledFluxoCelular) return;
}

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: ".wwebjs_auth" }),
  puppeteer: {
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  }
});

client.on("qr", (qr) => {
  console.log("QR Code gerado, escaneie para conectar:");
  qrcode.generate(qr, { small: true });
});

client.on("ready", () => {
  console.log("Cliente WhatsApp conectado e pronto para receber mensagens.");
});

client.on("message", async (msg) => {
  await processMessage(msg).catch((err) => console.error("Erro ao processar mensagem:", err.message));

  // Log estruturado conforme modelo solicitado
  const phone = cleanPhone(msg.from);
  const contact = await msg.getContact().catch(() => null);
  const chat = await msg.getChat().catch(() => null);
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
    chat?.name || // título do chat (costuma trazer o nome salvo)
    contact?.businessProfile?.tag || // fallback de tag de perfil
    contact?.number ||
    phone ||
    "Cliente";
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

// Log estruturado para mensagens enviadas pela própria conta
client.on("message_create", async (msg) => {
  if (!msg.fromMe) return;

  const phone = cleanPhone(msg.to || msg.from);
  const contact = await msg.getContact().catch(() => null);
  const chat = await msg.getChat().catch(() => null);

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

  const nome =
    contact?.verifiedName ||
    contact?.pushname ||
    contact?.shortName ||
    chat?.name ||
    contact?.businessProfile?.tag ||
    contact?.number ||
    phone ||
    "Cliente";

  const corpo = (msg.body || "").trim();
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
