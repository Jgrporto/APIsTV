import axios from "axios";
import FormData from "form-data";

async function enviarMensagem() {
  const form = new FormData();
  form.append("appkey", "4d557310-fc85-4723-9035-dce444191947");
  form.append("authkey", "KSGOsxWYorbTBtAGCkO4CEfkru62VK8dwLXst74Ihe00S3NDht");
  form.append("to", "5524999157259");
  form.append("typingDelay", "2");
  form.append("message", "Olá! Teste automático enviado com sucesso 🚀");

  const response = await axios.post(
    "https://botbot.chat/api/create-message",
    form,
    { headers: form.getHeaders() }
  );

  console.log(response.data);
}

enviarMensagem();
