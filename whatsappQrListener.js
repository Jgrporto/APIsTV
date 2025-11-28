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
  const payload = {
    appName: "com.whatsapp",
    messageDateTime: Math.floor(Date.now() / 1000),
    devicePhone: DEVICE_PHONE,
    deviceName: "Emex Device",
    senderName: nome,
    senderMessage: montarMensagemTeste(appEscolhido, nome, cliente),
    senderPhone: cliente,
    userAgent: "BotBot.Chat"
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
  const reply = await gerarTeste(phone, nome, appNome);

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

  const reply = await gerarTeste(phone, nome, "IBO");
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
  const serverName = `+TV ${username}`;
  const observacoes = "TESTE ATIVADO VIA CHATBOT\nAPLICATIVO ESCOLHIDO: IBO";

  try {
    await criarUsuarioGerenciaAppComM3u(m3u, {
      mac: leitura.mac,
      serverName,
      app: "IBO",
      nome,
      whatsapp: phone,
      observacoes
    });
  } catch (err) {
    console.error("[IBO] Falha ao cadastrar no GerenciaApp:", err.message);
    await msg.reply("Falha ao salvar no GerenciaApp, tente novamente mais tarde.");
    return;
  }

  await msg.reply("Teste Liberado, pode abrir o app agora?");
}

async function processMessage(msg) {
  const phone = cleanPhone(msg.from);

  const contact = await msg.getContact().catch(() => null);
  const nome = contact?.pushname || contact?.name || contact?.number || phone || "Cliente";
  const texto = (msg.body || "").trim();

  console.log(`[MSG] ${phone} (${nome}): ${texto}`);

  if (msg.hasMedia) {
    if (aguardandoMac.has(phone)) {
      await handleIboImagem(msg, phone, nome);
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
  }
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

client.on("message", (msg) => {
  processMessage(msg).catch((err) => console.error("Erro ao processar mensagem:", err.message));
});

client.initialize();
