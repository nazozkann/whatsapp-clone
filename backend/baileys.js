/*  baileys.js  */

const baileys                = require('@whiskeysockets/baileys');
const makeWASocket           = baileys.default;
const useMultiFileAuthState  = baileys.useMultiFileAuthState;
const fetchLatestBaileysVersion = baileys.fetchLatestBaileysVersion;
const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const path = require('path');
const fs = require('fs');
const { DisconnectReason } = require('@whiskeysockets/baileys');

const express  = require('express');
const qrcode   = require('qrcode-terminal');
const cors     = require('cors');
const http     = require('http');
const { Server } = require('socket.io');
const mysql    = require('mysql2/promise');
const { v4: uuidv4 } = require('uuid');

/* ────────────────────────────────────────────────────────────── */
/*  Express & Socket.IO setup                                     */
/* ────────────────────────────────────────────────────────────── */

const app = express();
app.use(express.json());
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

/* ────────────────────────────────────────────────────────────── */
/*  MySQL – bağlantı ve tablo                                     */
/* ────────────────────────────────────────────────────────────── */

const PORT = process.env.PORT || 3000;

let db;

(async () => {
  db = await mysql.createConnection({
    host    : process.env.DB_HOST,
    user    : process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    charset : 'utf8mb4',
    port    : process.env.DB_PORT || 3306,
  });

  await db.execute(`
    CREATE TABLE IF NOT EXISTS messages (
      id        VARCHAR(36)  PRIMARY KEY,
      jid       VARCHAR(255),
      name      VARCHAR(255),
      body      TEXT,
      timestamp BIGINT,
      from_me   TINYINT(1),
      to_jid    VARCHAR(255),
      clientid  VARCHAR(255),
      status    VARCHAR(32),
      image_base64 TEXT,
      is_read   TINYINT(1)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  io.on('connection', async socket => {
    console.log('Bir istemci bağlandı:', socket.id);

    const [rows] = await db.execute(
      'SELECT * FROM messages ORDER BY timestamp DESC LIMIT 100'
    );

    rows.reverse().forEach(msg => {
      const from = msg.from_me ? 'me' : normalizeJid(msg.jid);
      const to = msg.from_me ? normalizeJid(msg.to_jid) : 'me';
      socket.emit('message', {
        id       : msg.id,
        from,
        to,
        name     : getNameLocal(msg.from_me ? msg.to_jid : msg.jid),
        body     : msg.body,
        timestamp: msg.timestamp,
        fromMe   : !!msg.from_me,
        ...(msg.clientid ? { clientId: msg.clientid } : {}),
        status   : msg.status,
        ...(msg.image_base64 ? { imageBase64: msg.image_base64 } : {}),
        read     : !!msg.is_read
      });
    });
  });

  server.listen(PORT, () => {
    console.log(`Express (Baileys + Socket.io) ${PORT} portunda.`);
  });

  startSock();
})();

/* ────────────────────────────────────────────────────────────── */
/*  Yardımcılar                                                   */
/* ────────────────────────────────────────────────────────────── */

function normalizeJid(jid) {
  return jid ? jid.split('@')[0].split(':')[0] + '@s.whatsapp.net' : jid;
}

/* Rehberden isim çek – yoksa JID'ye geri düşer */
function getNameLocal(jid) {
  const normJid = normalizeJid(jid);
  const c = sock?.contacts?.[normJid] || {};
  return c.name || c.notify || c.vname || (normJid ? normJid.split('@')[0] : normJid);
}

const sane = v => (v === undefined ? null : v);

/* Mesajı veritabanına kaydet */
async function saveMessage(data) {
  const params = [
    uuidv4(),
    normalizeJid(data.jid),
    data.name,
    data.body,
    data.timestamp ?? Date.now(),
    data.fromMe ? 1 : 0,
    normalizeJid(data.to),
    data.clientId,
    data.status ?? 'sent',
    data.imageBase64 || null,
    0 // is_read: yeni mesajlar okunmamış olarak eklenir
  ];

  try {
    console.log('🚀  INSERT params:', params);
    await db.execute(
      `INSERT INTO messages
       (id, jid, name, body, timestamp, from_me, to_jid, clientid, status, image_base64, is_read)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params
    );
    console.log('✅  INSERT OK');
  } catch (err) {
    console.error('❌  INSERT FAIL:', err);   // <-- mutlak log
    throw err;                               // route'a fırlat
  }
}

/* ────────────────────────────────────────────────────────────── */
/*  Baileys – WhatsApp bağlantısı                                 */
/* ────────────────────────────────────────────────────────────── */

let sock = null;
let isStarting = false;
let myJid = null;    // kendi kullanıcı JID'i

async function clearAuthFiles() {
  const dir = path.join(__dirname, 'baileys_auth');
  if (fs.existsSync(dir)) {
    fs.readdirSync(dir).forEach(file => {
      fs.unlinkSync(path.join(dir, file));
    });
  }
  const credsPath = path.join(__dirname, 'creds.json');
  if (fs.existsSync(credsPath)) {
    fs.unlinkSync(credsPath);
  }
}

async function startSock() {
  if (sock || isStarting) return; // Zaten bağlantı varsa tekrar başlatma
  isStarting = true;

  const { state, saveCreds } = await useMultiFileAuthState('baileys_auth');
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    auth : state,
    printQRInTerminal: false,
    syncFullHistory  : false,
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      qrcode.generate(qr, { small: true });
      io.emit('wa-qr', qr);
    }
    if (connection === 'open') {
      myJid = sock?.user?.id ?? null;
      io.emit('wa-connected');
      if (sock.user && sock.user.name) {
        sock.sendPresenceUpdate('available');
      }
    }
    if (connection === 'close') {
      sock = null; // Bağlantı koptuysa referansı sıfırla
      const reason = lastDisconnect?.error?.output?.statusCode;
      if (reason === DisconnectReason.loggedOut) {
        io.emit('wa-logout');
        await clearAuthFiles();
        // startSock() çağırma! QR sadece giriş ekranında gösterilecek.
      } else {
        startSock();
      }
    }
  });

  /* Yeni mesajlar */
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const msg of messages) {
      if (!msg.message || !msg.key.remoteJid?.endsWith('@s.whatsapp.net')) continue;
      const from = normalizeJid(msg.key.remoteJid);
      const body = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
      const name = getNameLocal(from);
      let imageBase64 = null;
      if (msg.message.imageMessage) {
        try {
          const buffer = await downloadMediaMessage(msg, 'buffer', {}, { reuploadRequest: sock.updateMediaMessage });
          imageBase64 = buffer.toString('base64');
        } catch (e) {
          console.error('Görsel indirilemedi:', e);
        }
      }
      const msgObj = {
        jid      : from,
        name,
        body,
        timestamp: Date.now(),
        fromMe   : msg.key.fromMe,
        to       : normalizeJid(myJid),
        clientId : null,
        status   : 'received',
        imageBase64: imageBase64
      };
      await saveMessage(msgObj);
      io.emit('message', {
        ...msgObj,
        from: msg.key.fromMe ? 'me' : from,
        to: msg.key.fromMe ? from : 'me',
        read : false, 
      });
    }
  });

  sock.ev.on('contacts.upsert', (contacts) => {
    if (!sock.contacts) sock.contacts = {};
    for (const contact of contacts) {
      sock.contacts[contact.id] = contact;
    }
    console.log('Rehber güncellendi, toplam kişi:', Object.keys(sock.contacts).length);
  });

  isStarting = false;
}

/* ────────────────────────────────────────────────────────────── */
/*  REST API                                                      */
/* ────────────────────────────────────────────────────────────── */

/* Mesaj gönder */
app.post('/send-message', async (req, res) => {
  const { number, message, clientId, imageBase64 } = req.body;
  if (!number || (!message && !imageBase64)) {
    return res.status(400).json({ error: 'number ve message veya imageBase64 gerekli' });
  }
  try {
    const jid = number.endsWith('@s.whatsapp.net')
                ? number
                : `${number}@s.whatsapp.net`;
    const normJid = normalizeJid(jid);
    let sendResult;
    if (imageBase64) {
      // Fotoğraf gönder
      sendResult = await sock.sendMessage(normJid, { image: Buffer.from(imageBase64, 'base64'), caption: message || '' });
    } else {
      // Metin gönder
      sendResult = await sock.sendMessage(normJid, { text: message });
    }
    const name = getNameLocal(normJid);
    const msgObj = {
      jid: normJid,
      name,
      body     : message,
      timestamp: Date.now(),
      fromMe   : true,
      to       : normJid,
      clientId : clientId ?? null,
      status   : 'sent',
      ...(imageBase64 ? { imageBase64 } : {})
    };
    await saveMessage(msgObj);
    io.emit('message', {
      ...msgObj,
      from: 'me',
      to: normJid,
      read : true, 
    });
    res.json({ success: true });
  } catch (err) {
    console.error('❌  /send-message error:', err);
    res.status(500).json({ error: err.message });
  }
});

/* Seçili sohbetin geçmişi */
/* ── /messages endpoint'i ───────────────────────────────────── */

app.get('/messages', async (req, res) => {
  const { chatId, limit } = req.query;
  if (!chatId) return res.status(400).json({ error: 'chatId gerekli' });

  const safeLimit = Number.isFinite(+limit) ? +limit : 50;

  const [rows] = await db.execute(
    `SELECT * FROM messages
     WHERE jid = ? OR to_jid = ?
     ORDER BY timestamp DESC
     LIMIT ${safeLimit}`,
    [chatId, chatId]
  );

  res.json(rows.map(msg => {
    const from = msg.from_me ? 'me' : normalizeJid(msg.jid);
    const to = msg.from_me ? normalizeJid(msg.to_jid) : 'me';
    return {
      id       : msg.id,
      from,
      to,
      name     : getNameLocal(msg.from_me ? msg.to_jid : msg.jid),
      body     : msg.body,
      timestamp: msg.timestamp,
      fromMe   : !!msg.from_me,
      clientId : msg.clientid,
      status   : msg.status,
      ...(msg.image_base64 ? { imageBase64: msg.image_base64 } : {}),
      read     : !!msg.is_read
    };
  }));
});

/* ── /all-messages endpoint'i ──────────────────────────────── */

app.get('/all-messages', async (_req, res) => {
  const [rows] = await db.execute(
    `SELECT * FROM messages
     ORDER BY timestamp DESC
     LIMIT 100`
  );

  res.json(rows.map(msg => {
    const from = msg.from_me ? 'me' : normalizeJid(msg.jid);
    const to = msg.from_me ? normalizeJid(msg.to_jid) : 'me';
    return {
      id       : msg.id,
      from,
      to,
      name     : getNameLocal(msg.from_me ? msg.to_jid : msg.jid),
      body     : msg.body,
      timestamp: msg.timestamp,
      fromMe   : !!msg.from_me,
      clientId : msg.clientid,
      status   : msg.status,
      ...(msg.image_base64 ? { imageBase64: msg.image_base64 } : {}),
      read     : !!msg.is_read
    };
  }));
});

/* Okundu işaretleme endpoint'i */
app.post('/messages/mark-read', async (req, res) => {
  const { chatId } = req.body;
  if (!chatId) return res.status(400).json({ error: 'chatId gerekli' });
  try {
    await db.execute(
      `UPDATE messages SET is_read = 1 WHERE (jid = ? OR to_jid = ?)`,
      [chatId, chatId]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/logout', async (req, res) => {
  try {
    if (sock) {
      await sock.logout();
    }
    await clearAuthFiles();
    io.emit('wa-logout');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/start-qr', async (req, res) => {
  try {
    startSock();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});