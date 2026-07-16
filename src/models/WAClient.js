const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const path = require("path");
const fs = require("fs");

class WAClient {
  constructor(headless = true, id = "tm-bot") {
    this.whatsappReady = false;

    this.client = new Client({
      authStrategy: new LocalAuth({
        clientId: id
      }),

      puppeteer: {
        headless,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu"
        ]
      }
    });

    this.registerEvents();

    console.log("Inicializando WhatsApp...");

    this.client.initialize().catch((error) => {
      console.error("Erro no initialize:", error);
    });
  };

  registerEvents() {
    this.client.on("qr", (qr) => {
      console.log("QR Code recebido");

      qrcode.generate(qr, {
        small: true
      });
    });

    this.client.on("authenticated", () => {
      console.log("WhatsApp autenticado com sucesso!");
    });

    this.client.on("loading_screen", (percent, message) => {
      console.log(
        `Carregando WhatsApp: ${percent}% - ${message}`
      );
    });

    this.client.on("change_state", (state) => {
      console.log("Estado alterado:", state);
    });

    this.client.on("ready", async () => {
      this.whatsappReady = true;

      console.log("WhatsApp conectado e pronto!");

      try {
        const state = await this.client.getState();
        console.log("Estado atual:", state);
        console.log(
          "Conta conectada:",
          this.client.info?.wid?._serialized
        );
      } catch (error) {
        console.error(
          "Erro ao consultar estado:",
          error.message
        );
      }
    });

    this.client.on("auth_failure", (error) => {
      this.whatsappReady = false;
      console.error("Falha na autenticação:", error);
    });

    this.client.on("disconnected", (reason) => {
      this.whatsappReady = false;
      console.error("WhatsApp desconectado:", reason);
    });
  }

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