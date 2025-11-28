import wweb from "whatsapp-web.js";
import qrcode from "qrcode-terminal";
import axios from "axios";
import { criarUsuarioGerenciaAppComM3u } from "./gerenciaApp.js";

const { Client, LocalAuth } = wweb;

const KEYWORD = "TESTEAUTOMOCAOBOTIBO";
const DEVICE_PHONE = "5524999162165";

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

async function gerarTeste(cliente, nome = "Cliente Emex") {
  const payload = {
    appName: "com.whatsapp",
    messageDateTime: Math.floor(Date.now() / 1000),
    devicePhone: DEVICE_PHONE,
    deviceName: "Emex Device",
    senderName: nome,
    senderMessage: "gerar teste",
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

async function processMessage(msg) {
  const texto = (msg.body || "").trim();
  const phone = cleanPhone(msg.from);

  const contact = await msg.getContact().catch(() => null);
  const nome =
    contact?.pushname || contact?.name || contact?.number || phone || "Cliente";

  console.log(`[MSG] ${phone} (${nome}): ${texto}`);

  if (texto.toUpperCase() !== KEYWORD) return;

  console.log("Keyword detectada, gerando teste e salvando na plataforma...");

  const reply = await gerarTeste(phone, nome);
  const m3u = extrairM3u(reply);

  if (!m3u) {
    console.error("Nao foi possivel extrair a URL M3U do teste para", phone);
    return;
  }

  await criarUsuarioGerenciaAppComM3u(m3u);
  console.log("Teste salvo no GerenciaApp para", phone);
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
  processMessage(msg).catch((err) =>
    console.error("Erro ao processar mensagem:", err.message)
  );
});

client.initialize();
