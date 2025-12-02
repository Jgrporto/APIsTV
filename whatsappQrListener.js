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
const COMMANDS = {
  ASSIST: "#ASSIST",
  LAZER: "#LAZER",
  IBO: "#IBO"
};
const INSTRUCAO_TRIGGER = "VOCE VAI BAIXAR O APLICATIVO, INSTALAR E ABRIR";
const MSG_INSTRUCAO_CELULAR =
  "Voce vai baixar o aplicativo, instalar e abrir.\n\nAssim que abrir me manda um print do aplicativo aberto";
const MSG_PEDIR_PRINT =
  "Preciso do print do app aberto para liberar o teste. Pode me enviar a imagem da tela aberta, por favor?";
const MSG_TESTE_ATIVO = "Aguarde um momento que um atendente vai falar com voce.";


function normalizeInstrucao(str) {
  return (str || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
}

function isInstrucaoMensagem(texto) {
  return normalizeInstrucao(texto).includes(INSTRUCAO_TRIGGER);
}
const aguardandoMac = new Set();
const fluxoCelular = new Map(); // { stage: 'aguardando_prova', confirming: bool, mac?: string, printReminderSent?: bool }
let latestQr = "";
const app = express();
const QR_PORT = process.env.PORT || 3000;
const SELF_PING_URL = process.env.SELF_PING_URL || "";
const IDLE_LOG_MS = Number(process.env.IDLE_LOG_MS || 300000); // 5 min

let lastActivity = Date.now();
const touchActivity = () => {
  lastActivity = Date.now();
};
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
    await msg.reply(MSG_TESTE_ATIVO);
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
    await msg.reply("Servico de testes indisponivel agora. Tente novamente em instantes.");
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
        fluxoCelular.set(phone, { ...estadoCelular, mac: leitura.mac, confirming: false, printReminderSent: true });
        console.log(`[CELULAR] MAC detectado (${phone} - ${nome}): ${leitura.mac}`);
        await concluirFluxoCelular(msg, phone, nome, leitura.mac);
      } else {
        fluxoCelular.delete(phone);
        await msg.reply("Nao consegui identificar o MAC. Um atendente vai te chamar para finalizar, tudo bem?");
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
  touchActivity();

  const phone = cleanPhone(msg.to || msg.from);
  const corpo = (msg.body || "").trim();
  const contact = await msg.getContact().catch(() => null);
  const chat = await msg.getChat().catch(() => null);

  if (isInstrucaoMensagem(corpo)) {
    fluxoCelular.set(phone, { stage: "aguardando_prova", confirming: false, printReminderSent: false, mac: null });
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

  const nome =
    contact?.verifiedName ||
    contact?.pushname ||
    contact?.shortName ||
    chat?.name ||
    contact?.businessProfile?.tag ||
    contact?.number ||
    phone ||
    "Cliente";

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
      <div class="info">A página atualiza a cada 6s enquanto um novo QR estiver disponível.</div>
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
        document.getElementById("qrcode").innerHTML = "<p>QR ainda não gerado.</p>";
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

// Ping periódico opcional para manter o serviço acordado (defina SELF_PING_URL)
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
