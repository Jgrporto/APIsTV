import axios from "axios";
import FormData from "form-data";

const KEYWORD = "ASSIST PLUS";         // 🔍 Palavra-chave a ser buscada
const NUMERO_DESTINO = "5524992910708"; // 🔥 Número para enviar o resultado

async function obterTeste() {
  const payload = {
    appName: "com.whatsapp",
    messageDateTime: Math.floor(Date.now() / 1000),
    devicePhone: "5524999162165",
    deviceName: "Dispositivo Emex",
    senderName: "Teste JG Porto",
    senderMessage: "gerar teste",
    senderPhone: "5524999162165",
    userAgent: "BotBot.Chat"
  };

  const response = await axios.post(
    "https://painel.newbr.top/api/chatbot/V01pz25DdO/o231qzL4qz",
    payload,
    { headers: { "Content-Type": "application/json" } }
  );

  return response.data.reply;
}

function filtrarBloco(texto, keyword) {
  const linhas = texto.split("\n");

  let coletando = false;
  let resultado = [];

  const tituloRegex = /^🟢|^🟡|^🔴|^🟠/;

  for (let linha of linhas) {

    // Quando encontra o bloco desejado
    if (linha.toUpperCase().includes(keyword.toUpperCase())) {
      coletando = true;
      resultado.push(linha);
      continue;
    }

    // Quando encontra outro título, para a captura
    if (coletando && tituloRegex.test(linha)) {
      break;
    }

    if (coletando) resultado.push(linha);
  }

  return resultado.join("\n").trim();
}


async function enviarParaBotBot(mensagem) {
  const form = new FormData();
  form.append("appkey", "4d557310-fc85-4723-9035-dce444191947");
  form.append("authkey", "KSGOsxWYorbTBtAGCkO4CEfkru62VK8dwLXst74Ihe00S3NDht");
  form.append("to", NUMERO_DESTINO);
  form.append("typingDelay", "3");
  form.append("message", mensagem);

  const resp = await axios.post("https://botbot.chat/api/create-message", form, {
    headers: form.getHeaders()
  });

  console.log("Mensagem enviada:", resp.data);
}

async function processar() {
  console.log("🔍 Obtendo teste...");
  const textoCompleto = await obterTeste();

  console.log("\n🔍 Filtrando pelo termo:", KEYWORD);
  const trechoFiltrado = filtrarBloco(textoCompleto, KEYWORD);

  console.log("\n📦 Conteúdo filtrado:\n", trechoFiltrado);

  console.log("\n📲 Enviando para o usuário...");
  await enviarParaBotBot(trechoFiltrado);
}

processar();
