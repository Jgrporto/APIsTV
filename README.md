# APIsTV

Guia rapido para instalar dependencias e colocar os scripts para rodar.

## Requisitos
- Node.js 18+ e npm instalados.
- Acesso de rede para `painel.newbr.top`, `botbot.chat` e `gerenciaapp.top`.
- Permissao para o Puppeteer baixar ou usar um Chromium (ocorre durante `npm install`).

## Instalar dependencias
1. No diretorio do projeto rode:
   ```bash
   npm install
   ```
2. Se o download do Chromium falhar, use uma maquina com acesso liberado ou defina `PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=1` e configure `PUPPETEER_EXECUTABLE_PATH` apontando para um Chrome/Chromium ja instalado.

## Configuracoes importantes
Ajuste os valores fixos conforme o ambiente:
- `server.js`: `DEVICE_PHONE`, `KEYWORD`, `SUCCESS_NUMBER`, `TEST_NAME`, `TEST_PHONE`.
- `gerenciaApp.js`: credenciais `GERENCIA_USER` e `GERENCIA_PASS` e dados de formulario em `FORM_DATA`.
- Chaves do BotBot (`appkey`/`authkey`) usadas em `server.js`, `send.js`, `listener.js`, `filterAndSend.js`, `autoAssist.js`.
- Numeros de destino em `sendNewBR.js`, `filterAndSend.js`, `autoAssist.js`, `listener.js`.

## Executar o servidor principal
1. Certifique-se de que o webhook `POST /webhook` esteja exposto (porta padrao 3000 ou `PORT`).
2. Inicie:
   ```bash
   node server.js
   ```
   - Ao subir, `server.js` executa a automacao do GerenciaApp (usa o M3U retornado pela API NewBR) e envia mensagem de sucesso pelo BotBot.
   - O endpoint `/webhook` espera um JSON com `from` e `message`; quando recebe o comando `ASSIST`, gera e devolve o bloco filtrado.

## Scripts uteis
- `node listener.js` - faz polling das mensagens no BotBot e responde ao comando `ASSIST`.
- `node autoAssist.js` - fluxo simplificado que gera e envia o bloco ASSIST para o numero autorizado.
- `node filterAndSend.js` - busca um teste, filtra o bloco `ASSIST PLUS` e envia para `NUMERO_DESTINO`.
- `node send.js` - exemplo de envio simples via BotBot.
- `node sendNewBR.js` - exemplo de chamada direta para a API do painel NewBR.
- `node whatsappQrListener.js` - conecta no WhatsApp via QR Code usando `whatsapp-web.js`; ao receber a palavra-chave definida em `KEYWORD`, gera o teste no painel NewBR, extrai a URL M3U e cria o usuario no GerenciaApp. Na primeira execucao, sera exibido um QR Code no terminal para parear a conta; os dados ficam em `.wwebjs_auth`.

## Teste rapido do webhook
Com o servidor rodando, envie um POST local:
```bash
curl -X POST http://localhost:3000/webhook ^
  -H "Content-Type: application/json" ^
  -d "{\"from\":\"5524999999999\",\"message\":\"ASSIST\"}"
```
O retorno e o log devem mostrar o processamento do comando.
