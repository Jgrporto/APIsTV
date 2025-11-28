import express from "express";
import axios from "axios";
import FormData from "form-data";
import { criarUsuarioGerenciaAppComM3u } from "./gerenciaApp.js";

const app = express();
app.use(express.json());

const DEVICE_PHONE = "5524999162165"; // Numero conectado no BotBot
const KEYWORD = "ASSIST PLUS";
const SUCCESS_NUMBER = "24999157259"; // Numero para receber aviso de sucesso
const TEST_NAME = "João Gabriel Teste";
const TEST_PHONE = "5524999157259";

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

async function gerarTesteJoao() {
  return gerarTeste(TEST_PHONE, TEST_NAME);
}

function extrairM3u(texto) {
  if (!texto) return null;

  const linhas = texto.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const urlFromLine = (line) => {
    const m = line.match(/https?:\/\/[^\s]+/i);
    return m ? m[0] : null;
  };

  // Prefer HLS/M3U lines
  const preferidas = linhas.filter((l) => /HLS|M3U/i.test(l));
  for (const l of preferidas) {
    const url = urlFromLine(l);
    if (url) return url;
  }

  // Caso não encontre, pega a primeira URL com m3u_plus no texto
  const mPlus = texto.match(/https?:\/\/[^\s]+m3u_plus[^\s]*/i);
  if (mPlus) return mPlus[0];

  // fallback: primeira URL qualquer
  const qualquer = texto.match(/https?:\/\/[^\s]+/i);
  return qualquer ? qualquer[0] : null;
}

function filtrarAssist(texto) {
  const linhas = texto.split("\n");

  let capturando = false;
  let resultado = [];

  const tituloRegex = /^�YY�|^�YY�|^�Y"�|^�YY�/;

  for (let linha of linhas) {
    if (linha.toUpperCase().includes(KEYWORD.toUpperCase())) {
      capturando = true;
      resultado.push(linha);
      continue;
    }

    if (capturando && tituloRegex.test(linha)) break;

    if (capturando) resultado.push(linha);
  }

  return resultado.join("\n").trim();
}

async function enviarMensagem(numero, texto) {
  const form = new FormData();

  form.append("appkey", "4d557310-fc85-4723-9035-dce444191947");
  form.append("authkey", "KSGOsxWYorbTBtAGCkO4CEfkru62VK8dwLXst74Ihe00S3NDht");
  form.append("to", numero);
  form.append("typingDelay", "2");
  form.append("message", texto);

  await axios.post("https://botbot.chat/api/create-message", form, {
    headers: form.getHeaders()
  });
}

async function processarMensagem(sender, message) {
  console.log("Mensagem recebida:", sender, message);

  const comando = message.trim().toUpperCase();

  if (comando === "ASSIST") {
    console.log("Comando ASSIST detectado");

    const reply = await gerarTeste(sender);

    if (reply.includes("jǭ solicitou")) {
      await enviarMensagem(sender, "Voce ja solicitou um teste hoje.");
      return;
    }

    const filtrado = filtrarAssist(reply);

    if (!filtrado) {
      await enviarMensagem(sender, "Nao encontrei conteudo ASSIST PLUS.");
      return;
    }

    await enviarMensagem(sender, filtrado);
    return;
  }

  // Comando CELULAR removido a pedido; nenhuma automacao executa.
}

// Executa a automacao de cadastro ao iniciar o servidor
async function executarAutomacaoInicial() {
  try {
    console.log("Iniciando automacao GerenciaApp (startup)...");

    console.log(`Gerando teste para ${TEST_NAME} (${TEST_PHONE})...`);
    const respostaTeste = await gerarTesteJoao();
    const m3u = extrairM3u(respostaTeste);

    if (!m3u) {
      console.error("Nao foi possivel extrair a URL M3U do teste.");
      return;
    }

    console.log("M3U extraido:", m3u);

    await criarUsuarioGerenciaAppComM3u(m3u);

    console.log("Automacao concluida, enviando mensagem de sucesso...");
    await enviarMensagem(SUCCESS_NUMBER, "Sucesso");
  } catch (err) {
    console.error("Falha na automacao inicial:", err.message);
  }
}

app.post("/webhook", async (req, res) => {
  try {
    const data = req.body;

    const sender = data.from;
    const msg = data.message;

    await processarMensagem(sender, msg);

    res.json({ status: "OK" });
  } catch (e) {
    console.error("Erro:", e);
    res.status(500).json({ error: true });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Servidor rodando na porta", PORT);
});

// dispara automacao ao iniciar
executarAutomacaoInicial();
