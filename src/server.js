require('dotenv').config();

const cors = require('cors');
const express = require('express');
const fs = require('fs');
const QRCode = require('qrcode');
const qrcodeTerminal = require('qrcode-terminal');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const {
  enqueueMessage,
  getMessageJob,
  getQueueStatus,
  initMessageQueue
} = require('./queue/messageQueue');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';
const API_KEY = process.env.API_KEY || '';
const HEADLESS = String(process.env.PUPPETEER_HEADLESS || 'true') !== 'false';

function detectChromeExecutablePath() {
  const configured = process.env.CHROME_EXECUTABLE_PATH;
  if (configured && fs.existsSync(configured)) {
    return configured;
  }

  if (process.platform !== 'win32') {
    return undefined;
  }

  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
  ];

  return candidates.find((candidate) => fs.existsSync(candidate));
}

const app = express();

let clientReady = false;
let lastQr = null;
let lastQrDataUrl = null;
let lastState = 'starting';
let authenticatedAt = null;
let readyAt = null;
let lastError = null;
let initializeAttempts = 0;
let initializing = false;

app.use(cors());
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || '25mb' }));

// function requireApiKey(req, res, next) {
//   if (!API_KEY) { return next(); }

//   const token = req.get('x-api-key') || req.query.api_key;
//   if (token !== API_KEY) {
//     return res.status(401).json({ ok: false, error: 'API key invÃ¡lida ou ausente.' });
//   }

//   return next();
// }

function normalizePhoneNumber(value) {
  if (!value) {
    return null;
  }

  const onlyDigits = String(value).replace(/\D/g, '');
  return onlyDigits || null;
}

function buildChatId(to) {
  const value = String(to || '').trim();
  if (value.endsWith('@c.us') || value.endsWith('@g.us')) {
    return value;
  }

  const phone = normalizePhoneNumber(value);
  return phone ? `${phone}@c.us` : null;
}

async function resolveChatId(to) {
  const value = String(to || '').trim();
  if (!value) {
    return null;
  }

  if (value.endsWith('@g.us')) {
    return value;
  }

  if (value.endsWith('@c.us')) {
    const phone = value.replace('@c.us', '');
    const numberId = await client.getNumberId(phone);
    return numberId?._serialized || null;
  }

  const phone = normalizePhoneNumber(value);
  if (!phone) {
    return null;
  }

  const numberId = await client.getNumberId(phone);
  return numberId?._serialized || null;
}

function publicStatus() {
  return {
    ok: true,
    connected: clientReady,
    state: lastState,
    hasQr: Boolean(lastQr),
    authenticatedAt,
    readyAt,
    lastError
  };
}

function normalizeImagePayload({ image, imageUrl, imageBase64, imagePath, caption }) {
  if (image && typeof image === 'object') {
    return {
      url: image.url || null,
      path: image.path || null,
      base64: image.base64 || null,
      mimetype: image.mimetype || image.mimeType || null,
      filename: image.filename || image.fileName || null,
      caption: image.caption || caption || null
    };
  }

  if (imageUrl) {
    return { url: imageUrl, caption: caption || null };
  }

  if (imagePath) {
    return { path: imagePath, caption: caption || null };
  }

  if (imageBase64) {
    return {
      base64: imageBase64,
      mimetype: 'image/jpeg',
      filename: 'image.jpg',
      caption: caption || null
    };
  }

  return null;
}

function extractMessagePayload(body) {
  const { to, numero, phone, message, mensagem, text, image, imageUrl, imageBase64, imagePath, caption } = body || {};

  return {
    destination: to || numero || phone,
    text: message || mensagem || text || caption || '',
    image: normalizeImagePayload({ image, imageUrl, imageBase64, imagePath, caption })
  };
}

async function buildMedia(image) {
  if (!image) {
    return null;
  }

  if (image.url) {
    return MessageMedia.fromUrl(image.url);
  }

  if (image.path) {
    return MessageMedia.fromFilePath(image.path);
  }

  if (image.base64) {
    const cleanBase64 = String(image.base64).replace(/^data:[^;]+;base64,/, '');
    return new MessageMedia(
      image.mimetype || 'image/jpeg',
      cleanBase64,
      image.filename || 'image.jpg'
    );
  }

  return null;
}

async function sendQueuedMessage(payload) {
  if (!clientReady) {
    throw new Error('WhatsApp ainda nÃ£o estÃ¡ conectado.');
  }

  const chatId = await resolveChatId(payload.destination);
  if (!chatId) {
    throw new Error('NÃºmero nÃ£o encontrado no WhatsApp ou nÃ£o resolvido pelo WhatsApp Web.');
  }

  const media = await buildMedia(payload.image);
  const text = String(payload.text || '');

  if (media) {
    const result = await client.sendMessage(chatId, media, {
      caption: payload.image?.caption || text || undefined
    });
    return {
      to: chatId,
      sent: true,
      media: true,
      messageId: result?.id?._serialized || null
    };
  }

  const result = await client.sendMessage(chatId, text);
  return {
    to: chatId,
    sent: true,
    media: false,
    messageId: result?.id?._serialized || null
  };
}

const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    headless: HEADLESS,
    executablePath: detectChromeExecutablePath(),
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--disable-gpu'
    ]
  }
});

client.on('qr', async (qr) => {
  lastQr = qr;
  lastQrDataUrl = await QRCode.toDataURL(qr);
  clientReady = false;
  lastState = 'qr';
  lastError = null;

  console.log('\nEscaneie este QR Code com o WhatsApp:');
  qrcodeTerminal.generate(qr, { small: true });
  console.log(`\nTambÃ©m disponÃ­vel em http://${HOST}:${PORT}/qr\n`);
});

client.on('authenticated', () => {
  authenticatedAt = new Date().toISOString();
  lastState = 'authenticated';
  lastError = null;
  console.log('WhatsApp autenticado.');
});

client.on('ready', () => {
  clientReady = true;
  lastQr = null;
  lastQrDataUrl = null;
  readyAt = new Date().toISOString();
  lastState = 'ready';
  lastError = null;
  console.log('WhatsApp conectado e pronto para enviar mensagens.');
});

client.on('auth_failure', (message) => {
  clientReady = false;
  lastState = 'auth_failure';
  lastError = message || 'Falha de autenticaÃ§Ã£o.';
  console.error('Falha de autenticaÃ§Ã£o:', lastError);
});

client.on('disconnected', (reason) => {
  clientReady = false;
  lastState = 'disconnected';
  lastError = reason || null;
  console.warn('WhatsApp desconectado:', reason);
});

function shouldRetryInitialize(error) {
  const message = String(error?.message || '');

  return [
    'Execution context was destroyed',
    'Most likely because of a navigation',
    'Target closed',
    'Protocol error',
    'Navigation timeout'
  ].some((pattern) => message.includes(pattern));
}

function initializeClientWithRetry() {
  if (initializing || clientReady) {
    return;
  }

  initializing = true;
  initializeAttempts += 1;
  lastState = 'initializing';

  console.log(`Inicializando cliente WhatsApp... tentativa ${initializeAttempts}`);

  client.initialize().catch((error) => {
    clientReady = false;
    initializing = false;
    lastState = 'initialize_error';
    lastError = error.message;
    console.error('Falha ao inicializar WhatsApp:', error);

    if (!shouldRetryInitialize(error)) {
      return;
    }

    const delayMs = Math.min(30000, 5000 * initializeAttempts);
    console.log(`Tentando inicializar novamente em ${delayMs / 1000}s...`);
    setTimeout(initializeClientWithRetry, delayMs);
  });
}

app.get('/', (req, res) => {
  const status = publicStatus();

  if (status.connected) {
    return res.type('html').send(`
      <!doctype html>
      <html lang="pt-BR">
        <head><meta charset="utf-8"><title>WhatsApp Listener</title></head>
        <body>
          <h1>WhatsApp conectado</h1>
          <pre>${JSON.stringify(status, null, 2)}</pre>
        </body>
      </html>
    `);
  }

  if (lastQrDataUrl) {
    return res.type('html').send(`
      <!doctype html>
      <html lang="pt-BR">
        <head><meta charset="utf-8"><title>Conectar WhatsApp</title></head>
        <body>
          <h1>Conectar WhatsApp</h1>
          <p>Escaneie o QR Code abaixo ou use o QR exibido no terminal.</p>
          <img src="${lastQrDataUrl}" alt="QR Code do WhatsApp" width="320" height="320">
          <pre>${JSON.stringify(status, null, 2)}</pre>
        </body>
      </html>
    `);
  }

  return res.type('html').send(`
    <!doctype html>
    <html lang="pt-BR">
      <head><meta charset="utf-8"><title>WhatsApp Listener</title></head>
      <body>
        <h1>WhatsApp iniciando</h1>
        <p>Aguardando geraÃ§Ã£o do QR Code. Recarregue esta pÃ¡gina em alguns segundos.</p>
        <pre>${JSON.stringify(status, null, 2)}</pre>
      </body>
    </html>
  `);
});

app.get('/status', (req, res) => {
  res.json(publicStatus());
});

app.get('/qr', (req, res) => {
  if (!lastQr) {
    return res.status(clientReady ? 409 : 404).json({
      ok: false,
      connected: clientReady,
      error: clientReady ? 'WhatsApp jÃ¡ estÃ¡ conectado.' : 'QR Code ainda nÃ£o foi gerado.'
    });
  }

  const format = String(req.query.format || 'json').toLowerCase();
  if (format === 'image') {
    return res.type('html').send(`<img src="${lastQrDataUrl}" alt="QR Code do WhatsApp">`);
  }
  if (format === 'raw') {
    return res.type('text').send(lastQr);
  }

  return res.json({ ok: true, qr: lastQr, qrDataUrl: lastQrDataUrl });
});

app.post(['/send', '/enviar'], async (req, res) => {
  const { destination, text, image } = extractMessagePayload(req.body);

  if (!buildChatId(destination)) {
    return res.status(400).json({
      ok: false,
      error: 'Informe o destino em "to", "numero" ou "phone". Exemplo: 5511999999999.'
    });
  }

  if ((!text || !String(text).trim()) && !image) {
    return res.status(400).json({
      ok: false,
      error: 'Informe texto em "message", "mensagem" ou "text", ou imagem em "image", "imageUrl", "imagePath" ou "imageBase64".'
    });
  }

  try {
    const job = await enqueueMessage({
      destination,
      text,
      image,
      requestedAt: new Date().toISOString()
    });

    return res.status(202).json({
      ok: true,
      queued: true,
      persistent: job.persistent,
      queueMode: job.mode,
      jobId: job.id
    });
  } catch (error) {
    lastError = error.message;
    return res.status(500).json({
      ok: false,
      error: 'Falha ao adicionar mensagem na fila.',
      details: error.message
    });
  }
});

app.get('/queue', async (req, res) => {
  try {
    return res.json({ ok: true, status: await getQueueStatus() });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.get('/queue/:id', async (req, res) => {
  try {
    const job = await getMessageJob(req.params.id);
    if (!job) {
      return res.status(404).json({ ok: false, error: 'Job nÃ£o encontrado.' });
    }
    return res.json({ ok: true, job });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});


app.use((req, res) => {
  res.status(404).json({ ok: false, error: 'Rota nÃ£o encontrada.' });
});

app.listen(PORT, HOST, () => {
  console.log(`Servidor HTTP rodando em http://${HOST}:${PORT}`);
  initMessageQueue(sendQueuedMessage);
  initializeClientWithRetry();
});
