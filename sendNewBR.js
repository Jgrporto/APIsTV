import axios from "axios";

async function enviarParaNewBR() {

  const body = {
    appName: "com.whatsapp",
    messageDateTime: Math.floor(Date.now() / 1000),   // timestamp atual
    devicePhone: "5524999162165",                     // SEU NÚMERO DO DISPOSITIVO
    deviceName: "Dispositivo Emex",
    senderName: "Teste JG Porto",
    senderMessage: "Teste automático enviado!",
    senderPhone: "5524999157259",                // CLIENTE DESTINO
    userAgent: "BotBot.Chat"
  };

  try {
    const response = await axios.post(
      "https://painel.newbr.top/api/chatbot/V01pz25DdO/o231qzL4qz",
      body,
      { headers: { "Content-Type": "application/json" } }
    );

    console.log("📩 Resposta recebida:");
    console.log(response.data);

  } catch (erro) {
    console.error("❌ Erro ao enviar:", erro.response?.data || erro.message);
  }
}

enviarParaNewBR();
