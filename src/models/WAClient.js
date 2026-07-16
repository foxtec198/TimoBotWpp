const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const path = require("path");
const fs = require("fs");

class WAClient {
  constructor(headless = true, id) {
    this.whatsappReady = false;
    const clientOptions = {
      authStrategy: new LocalAuth(),
      puppeteer: {
        headless: headless,
        executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu',
          '--disable-extensions',
          '--disable-background-networking',
          '--disable-sync',
          '--disable-default-apps',
          '--hide-scrollbars',
          '--mute-audio'
        ]
      }
    };

    // Create a new client instance
    const client = new Client(clientOptions);

    // When the client is ready, run this code (only once)
    client.once('ready', () => {
      this.whatsappReady = true
      console.log('Whatsapp connectado e pronto!!');
    });

    // Gera o QRCode
    client.on('qr', qr => {
      return qrcode.generate(qr, { small: true });
    });

    client.on("disconnected", (reason) => {
      this.whatsappReady = false;
      console.log("WhatsApp desconectado:", reason);
    });

    client.on("auth_failure", (error) => {
      this.whatsappReady = false;
      console.error("Falha na autenticação:", error);
    });

    // Inicializa o cliente
    client.initialize();

    this.client = client;
  };

  async createMessageMedia(image) {
    if (!image) {
      return null;
    }

    if (image.path) {
      const imagePath = path.resolve(image.path);

      if (!fs.existsSync(imagePath)) {
        throw new Error(
          `Imagem não encontrada: ${imagePath}`
        );
      }

      return MessageMedia.fromFilePath(imagePath);
    }

    if (image.url) {
      return await MessageMedia.fromUrl(image.url);
    }

    if (image.base64) {
      const base64 = image.base64.replace(
        /^data:[^;]+;base64,/,
        ""
      );

      return new MessageMedia(
        image.mimetype || "image/jpeg",
        base64,
        image.filename || "image.jpg"
      );
    }

    throw new Error("Formato de imagem inválido.");
  };

  async sendMessage(destination, text, image = null) {
    if (!this.whatsappReady) {
      throw new Error("WhatsApp não está conectado.");
    }

    const phone = this.normalizePhoneNumber(destination);

    if (!phone) {
      throw new Error("Número de telefone inválido.");
    }

    const numberId = await this.client.getNumberId(phone);

    if (!numberId) {
      throw new Error(
        `O número ${phone} não está registrado no WhatsApp.`
      );
    }

    const chatId = numberId._serialized;

    let result;

    if (image) {
      const media = await this.createMessageMedia(image);

      result = await this.client.sendMessage(
        chatId,
        media,
        {
          caption: image.caption || text || ""
        }
      );
    } else {
      result = await this.client.sendMessage(
        chatId,
        String(text)
      );
    }

    return {
      messageId: result.id._serialized,
      destination: chatId,
      type: image ? "image" : "text",
      timestamp: result.timestamp
    };
  };

  normalizePhoneNumber(value) {
    if (!value) { return null }

    const onlyDigits = String(value).replace(/\D/g, '');
    return onlyDigits || null;
  };

  normalizeImagePayload({ image, imageUrl, imageBase64, imagePath, caption }) {
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
  };

  extractMessagePayload(body) {
    const { to, numero, phone, message, mensagem, text, image, imageUrl, imageBase64, imagePath, caption } = body || {};

    return {
      destination: to || numero || phone,
      text: message || mensagem || text || caption || '',
      image: this.normalizeImagePayload({ image, imageUrl, imageBase64, imagePath, caption })
    };
  };

  buildChatId(to) {
    const value = String(to || '').trim();
    if (value.endsWith('@c.us') || value.endsWith('@g.us')) {
      return value;
    }

    const phone = this.normalizePhoneNumber(value);
    return phone ? `${phone}@c.us` : null;
  };

  isWhatsappReady() {
    return this.whatsappReady;
  };
};

const whatsapp = new WAClient();
module.exports = whatsapp