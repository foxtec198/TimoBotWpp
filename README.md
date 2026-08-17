# Timo Bot | Wpp

An ChatBot for TMHub.

Este diretório raiz é o bot WhatsApp em Node.js usando `whatsapp-web.js`.

O projeto OpenCV/Python fica isolado em `ptn/`.

## Instalação

```bash
PUPPETEER_SKIP_DOWNLOAD=true npm install
cp .env.example .env
npm start
```

No Windows PowerShell, se `npm` estiver bloqueado pela execution policy:

```powershell
$env:PUPPETEER_SKIP_DOWNLOAD="true"
npm.cmd install
npm.cmd start
```

## Configuração

Variáveis do `.env` raiz:

```env
PORT=3000
HOST=127.0.0.1
API_KEY=troque-essa-chave
PUPPETEER_HEADLESS=true
WA_INITIALIZE_TIMEOUT_MS=90000
PUPPETEER_NAVIGATION_TIMEOUT_MS=120000
WA_AUTH_TIMEOUT_MS=120000
WA_LOADING_100_WATCHDOG_MS=15000
WA_WEB_VERSION=
WA_WEB_VERSION_CACHE=
WA_WEB_VERSION_REMOTE_PATH=https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/{version}.html
CHROME_EXECUTABLE_PATH=
QUEUE_DRIVER=memory
REDIS_URL=redis://127.0.0.1:6379
MESSAGE_QUEUE_NAME=whatsapp-messages
MESSAGE_QUEUE_CONCURRENCY=1
MESSAGE_QUEUE_ATTEMPTS=5
MESSAGE_QUEUE_BACKOFF_MS=5000
JSON_BODY_LIMIT=25mb
```

Se `API_KEY` ficar preenchida, chamadas de envio precisam enviar o header `x-api-key`.

## Rotas

- `GET /`: mostra se está conectado. Se houver QR pendente, exibe o QR na página.
- `GET /status`: retorna o estado em JSON.
- `GET /qr`: retorna o QR atual em JSON.
- `GET /qr?format=image`: mostra o QR como imagem HTML.
- `GET /qr?format=raw`: retorna o conteúdo cru do QR.
- `POST /send` ou `POST /enviar`: adiciona mensagem na fila.
- `GET /queue`: status da fila.
- `GET /queue/:id`: status de um job.

Com `QUEUE_DRIVER=memory`, a fila usa memória local para desenvolvimento. Para persistir fila em Redis, configure `QUEUE_DRIVER=redis` e `REDIS_URL`.

## Envio

```bash
curl -X POST http://127.0.0.1:3000/enviar \
  -H "Content-Type: application/json" \
  -H "x-api-key: troque-essa-chave" \
  -d "{\"to\":\"5511999999999\",\"message\":\"Teste via API\"}"
```

Enviar imagem por URL:

```bash
curl -X POST http://127.0.0.1:3000/enviar \
  -H "Content-Type: application/json" \
  -H "x-api-key: troque-essa-chave" \
  -d "{\"to\":\"5511999999999\",\"imageUrl\":\"https://exemplo.com/foto.jpg\",\"caption\":\"Legenda\"}"
```

Enviar imagem em base64:

```json
{
  "to": "5511999999999",
  "message": "Legenda opcional",
  "image": {
    "base64": "...",
    "mimetype": "image/png",
    "filename": "foto.png"
  }
}
```

Também são aceitos os aliases:

- destino: `to`, `numero`, `phone`
- mensagem: `message`, `mensagem`, `text`

## VPS

O login fica salvo em `.wwebjs_auth/`; essa pasta não deve ir para o Git. Em Linux/VPS, mantenha `PUPPETEER_HEADLESS=true` e use Chrome/Chromium instalado no servidor. Se necessário:

```bash
CHROME_EXECUTABLE_PATH=/usr/bin/chromium-browser
```
