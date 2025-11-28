import axios from "axios";
import FormData from "form-data";

const DEVICE_PHONE = "5524999162165";
const ADMIN_NUMBER = "5524999157259";
const KEYWORD = "ASSIST PLUS";

let ultimoId = 0; // controla ultima mensagem lida

/* BUSCAR MENSAGENS RECEBIDAS NO BOTBOT */
async function buscarMensagens() {
  const resp = await axios.get(
    "https://botbot.chat/api/messages?appkey=4d557310-fc85-4723-9035-dce444191947&authkey=KSGOsxWYorbTBtAGCkO4CEfkru62VK8dwLXst74Ihe00S3NDht"
  );

  return resp.data.messages || [];
}

/* GERAR TESTE NEWBR */
async function gerarTeste(cliente) {
  const payload = {
    appName: "com.whatsapp",
    messageDateTime: Math.floor(Date.now() / 1000),
    devicePhone: DEVICE_PHONE,
    deviceName: "Emex Device",
    senderName: "Cliente",
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

/* FILTRAR ASSIST */
function filtrarAssist(texto) {
  const linhas = texto.split("\n");

  let capturando = false;
  let resultado = [];

  const regex = /^�YY�|^�YY�|^�Y"�|^�YY�/;

  for (let linha of linhas) {
    if (linha.toUpperCase().includes(KEYWORD.toUpperCase())) {
      capturando = true;
      resultado.push(linha);
      continue;
    }

    if (capturando && regex.test(linha)) break;

    if (capturando) resultado.push(linha);
  }

  return resultado.join("\n").trim();
}

/* ENVIAR PELO BOTBOT */
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

/* LOOP PRINCIPAL */
async function processarNovasMensagens() {
  try {
    const mensagens = await buscarMensagens();

    for (const msg of mensagens) {
      if (msg.id <= ultimoId) continue; // ignora mensagens velhas

      ultimoId = msg.id;

      const texto = msg.message;
      const numero = msg.from;

      if (numero !== ADMIN_NUMBER) continue; // valida admin

      if (texto.trim().toUpperCase() === "ASSIST") {
        console.log("ASSIST detectado!");

        const resposta = await gerarTeste(numero);

        if (resposta.includes("jǭ solicitou")) {
          await enviarMensagem(numero, "Voce ja solicitou um teste hoje.");
          continue;
        }

        const filtrado = filtrarAssist(resposta);

        if (!filtrado) {
          await enviarMensagem(numero, "Nenhum bloco ASSIST PLUS encontrado.");
          continue;
        }

        await enviarMensagem(numero, filtrado);
      }
    }
  } catch (e) {
    console.error("Erro:", e.response?.data || e.message);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function inicializarUltimoId() {
  const msgs = await buscarMensagens();
  if (!msgs.length) return;
  const maxId = Math.max(...msgs.map((m) => m.id || 0));
  ultimoId = maxId;
  console.log(`Marcador inicial definido para id ${ultimoId} (ignora historico anterior).`);
}

async function start() {
  await inicializarUltimoId();
  console.log("Listener iniciado...");
  while (true) {
    await processarNovasMensagens();
    await sleep(3000);
  }
}

start();
