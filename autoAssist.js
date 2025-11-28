import axios from "axios";
import FormData from "form-data";

/* CONFIGURAÇÕES */
const DEVICE_PHONE = "5524999162165";        // Seu número conectado ao BotBot
const ADMIN_NUMBER = "5524999157259";        // Número que vai poder mandar "ASSIST"

const KEYWORD = "ASSIST PLUS"; 

/* 🔵 1. GERAR TESTE NO NEWBR */
async function gerarTeste(cliente) {
  const payload = {
    appName: "com.whatsapp",
    messageDateTime: Math.floor(Date.now() / 1000),
    devicePhone: DEVICE_PHONE,
    deviceName: "Emex Device",
    senderName: "Cliente Emex",
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

/* 🔍 2. FILTRAR APENAS O BLOCO ASSIST PLUS */
function filtrarAssist(texto) {
  const linhas = texto.split("\n");

  let capturando = false;
  let resultado = [];

  const regexTitulo = /^🟢|^🟡|^🔴|^🟠/;

  for (let linha of linhas) {
    if (linha.toUpperCase().includes(KEYWORD.toUpperCase())) {
      capturando = true;
      resultado.push(linha);
      continue;
    }

    if (capturando && regexTitulo.test(linha)) break;

    if (capturando) resultado.push(linha);
  }

  return resultado.join("\n").trim();
}

/* 🟢 3. ENVIAR RESULTADO PELO BOTBOT */
async function enviarMensagem(numero, texto) {
  const form = new FormData();

  form.append("appkey", "4d557310-fc85-4723-9035-dce444191947");
  form.append("authkey", "KSGOsxWYorbTBtAGCkO4CEfkru62VK8dwLXst74Ihe00S3NDht");
  form.append("to", numero);
  form.append("typingDelay", "2");
  form.append("message", texto);

  await axios.post("https://botbot.chat/api/create-message", form, {
    headers: form.getHeaders(),
  });
}

/* 🔥 4. FUNÇÃO QUE TRATA A MENSAGEM RECEBIDA DO CLIENTE */
async function onMensagem(cliente, mensagem) {
  console.log("📩 Recebido de", cliente, "→", mensagem);

  // Só deixa rodar se o cliente for o admin autorizado
  if (cliente !== ADMIN_NUMBER) {
    console.log("❌ Número não autorizado");
    return;
  }

  // Comando detectado
  if (mensagem.trim().toUpperCase() === "ASSIST") {
    console.log("🚀 Gerando TESTE ASSIST PLUS...");

    const resposta = await gerarTeste(cliente);

    if (resposta.includes("já solicitou")) {
      await enviarMensagem(cliente, "❌ Este dispositivo já gerou o teste hoje.");
      return;
    }

    const filtrado = filtrarAssist(resposta);

    if (!filtrado) {
      await enviarMensagem(cliente, "⚠ Não encontrei dados do ASSIST PLUS.");
      return;
    }

    await enviarMensagem(cliente, filtrado);

    console.log("✔ Teste ASSIST enviado!");
  }
}

/* 🔄 SIMULAÇÃO DE RECEBIMENTO DE MENSAGEM */
onMensagem("5524999157259", "ASSIST");
