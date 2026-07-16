// ENV OPTIONS
require('dotenv').config();

// WPP CLIENT
const whatsapp = require("./models/WAClient.js")

// REDIS QUEUE
const { enqueueMessage, getMessageJob, getQueueStatus, initMessageQueue } = require('./services/queue.js');

// API
const cors = require('cors');
const { app, express } = require("./utils/config.js")

// CONSTANTS
const client = whatsapp
const PORT = Number(process.env.PORT || 3000);
const HOST = String(process.env.HOST || "127.0.0.1");

app.use(express.json());

initMessageQueue(async (payload) => {
  console.log("Processando mensagem:", payload);

  const result = await client.sendMessage(
    payload.destination,
    payload.text,
    payload.image
  );

  console.log("Mensagem enviada:", result);
  return result;
});

// ==============================================================================
// ==============================================================================
// ROTAS ========================================================================
// ==============================================================================
// ==============================================================================

app.get("/jobs/:id", async (req, res) => {
  const job = await getMessageJob(req.params.id);

  if (!job) {
    return res.status(404).json({
      ok: false,
      error: "Job não encontrado."
    });
  }

  return res.json({
    ok: true,
    job
  });
});

app.get("/status", (req, res) => {
  return res.json({
    ok: true,
    connected: client.isWhatsappReady()
  });
});

app.post(['/send', '/enviar'], async (req, res) => {
  const { destination, text, image } = client.extractMessagePayload(req.body);

  if (!client.buildChatId(destination)) {
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

app.listen(PORT, HOST, () => {
  console.log(`API rodando em http://localhost:${PORT}`);
});