/*  baileys.js  */

const express  = require('express');
const cors     = require('cors');
const http     = require('http');
const { Server } = require('socket.io');
const axios    = require('axios');
const qs = require('qs'); // Form verisi için
const multer = require('multer');
const FormData = require('form-data');
const fs = require('fs');

const app = express();
app.use(express.json());
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`Express (UltraMsg + Socket.io) ${PORT} portunda.`);
});

const upload = multer({ dest: 'uploads/' });

// Kullanıcıdan Instance ID + Token kaydı
app.post('/api/connect', async (req, res) => {
  const { userId, instanceId, token } = req.body;
  // ... db.execute ...
  res.json({ success: true });
});

// Mesaj gönderme
app.post('/api/send', async (req, res) => {
  const { userId, to, body } = req.body;
  // ... db.execute ...
  res.json({ success: true, id: msgId });
});

// Son 10 mesaj + sonsuz kaydırma desteği
app.get('/api/messages', async (req, res) => {
  const { instanceId, token, page = 1, limit = 20 } = req.query;
  if (!instanceId || !token) {
    return res.status(400).json({ error: 'instanceId ve token gerekli' });
  }
  const url = `https://api.ultramsg.com/${instanceId}/messages`;
  try {
    const { data } = await axios.get(url, {
      params: {
        token,
        page,
        limit,
        status: 'all',
        sort: 'desc'
      },
      headers: { 'content-type': 'application/x-www-form-urlencoded' }
    });
    res.json(data.messages || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Sohbet listesini dönen endpoint
app.get('/api/chats', async (req, res) => {
  const { instanceId, token } = req.query;
  if (!instanceId || !token) {
    return res.status(400).json({ error: 'instanceId ve token gerekli' });
  }
  try {
    const url = `https://api.ultramsg.com/${instanceId}/chats`;
    const params = { token };
    const response = await axios.get(url, { params });
    console.log('UltraMsg API yanıtı:', response.data);

    if (Array.isArray(response.data)) {
      res.json(response.data);
    } else if (response.data && Array.isArray(response.data.data)) {
      res.json(response.data.data);
    } else {
      res.json([]);
    }
  } catch (error) {
    console.error('UltraMsg API HATASI:', error.message);
    res.status(500).json({ error: error.message || 'Bilinmeyen hata' });
  }
});

// Belirli bir chatId ile mesajları dönen endpoint (log ve hata yönetimi ile)
app.get('/api/messages/:chatId', async (req, res) => {
  const { instanceId, token } = req.query;
  const chatId = req.params.chatId;
  if (!instanceId || !token) {
    return res.status(400).json({ error: 'instanceId ve token gerekli' });
  }
  try {
    const url = `https://api.ultramsg.com/${instanceId}/chats/messages`;
    const params = { token, chatId, limit: 50 };
    const response = await axios.get(url, { params });
    console.log('UltraMsg Mesaj Yanıtı:', response.data); // LOG
    if (Array.isArray(response.data)) {
      res.json(response.data);
    } else if (response.data && Array.isArray(response.data.data)) {
      res.json(response.data.data);
    } else {
      res.json([]);
    }
  } catch (error) {
    console.error('UltraMsg Mesaj HATASI:', error.message);
    res.status(500).json({ error: error.message || 'Bilinmeyen hata' });
  }
});

// Webhook log middleware'i (en üstlere yakın bir yere ekle)
app.post('/api/ultramsg/incoming', (req, res, next) => {
  console.log('GELEN WEBHOOK QUERY:', req.query);
  console.log('GELEN WEBHOOK BODY :', JSON.stringify(req.body).slice(0, 500));
  next();
});

// Asıl webhook handler (mevcut kodun)
app.post('/api/ultramsg/incoming', (req, res) => {
  const instanceId = req.body.instanceId || req.query.instanceId;
  const msg = req.body.data || req.body;
  io.to(instanceId).emit('new-message', {
    from: msg.from,
    to: msg.to,
    body: msg.body,
    timestamp: msg.time || Date.now()
  });
  res.sendStatus(200);
});

// UltraMsg Instance doğrulama endpoint'i
app.post('/api/ultramsg-auth', async (req, res) => {
  const { instanceId, token } = req.body;
  if (!instanceId || !token) {
    return res.status(400).json({ success: false, error: 'Instance ID ve Token gerekli' });
  }
  try {
    const response = await axios.get(
      `https://api.ultramsg.com/${instanceId}/instance/status?token=${token}`
    );
    const status = response.data?.status?.accountStatus?.status;
    if (status === 'authenticated') {
      res.json({ success: true });
    } else {
      res.json({ success: false, error: 'UltraMsg bağlantısı başarısız veya QR okutulmamış.' });
    }
  } catch (err) {
    res.json({ success: false, error: 'UltraMsg API bağlantı hatası' });
  }
});

// UltraMsg'den mesajları çekmek için yeni endpoint
app.get('/api/ultramsg/messages', async (req, res) => {
  const { instanceId, token, page = 1, limit = 10 } = req.query;
  if (!instanceId || !token) {
    return res.status(400).json({ error: 'instanceId ve token gerekli' });
  }
  const url = `https://api.ultramsg.com/${instanceId}/messages`;
  try {
    const { data } = await axios.get(url, {
      params: {
        token,
        page,
        limit,
        status: 'all',
        sort: 'desc'
      },
      headers: { 'content-type': 'application/x-www-form-urlencoded' }
    });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Socket.io bağlantısı
io.on('connection', socket => {
  const { instanceId } = socket.handshake.query;
  if (instanceId) socket.join(instanceId);
});

app.get('/api/me', async (req, res) => {
  const { instanceId, token } = req.query;
  if (!instanceId || !token) {
    return res.status(400).json({ error: 'instanceId ve token gerekli' });
  }
  try {
    const url = `https://api.ultramsg.com/${instanceId}/me`;
    const params = { token };
    const response = await axios.get(url, { params });
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ error: error.message || 'Bilinmeyen hata' });
  }
});

// Mesaj gönderme endpoint'i
app.post('/api/sendMessage', async (req, res) => {
  const { instanceId, token, chatId, body } = req.body;
  if (!instanceId || !token || !chatId || !body) {
    return res.status(400).json({ error: 'Eksik parametre' });
  }
  try {
    const url = `https://api.ultramsg.com/${instanceId}/messages/chat`;
    const form = qs.stringify({
      token,
      to: chatId,
      body,
      priority: 10,
      referenceId: '',
      msgId: '',
      mentions: ''
    });
    const { data } = await axios.post(url, form, {
      headers: { 'content-type': 'application/x-www-form-urlencoded' }
    });

    // *** Anlık mesaj yayını ***
    const msgId = data.messages?.[0]?.id || Date.now().toString();
    io.to(instanceId).emit('new-message', {
      id:        msgId,
      from:      'me',         // front-end'in isMe kontrolüne uysun
      to:        chatId,
      body,
      timestamp: Date.now()
    });

    res.json(data);
  } catch (error) {
    console.error('UltraMsg Mesaj Gönderme Hatası:', error.message, error.response?.data);
    res.status(500).json({ error: error.message || 'Bilinmeyen hata', detail: error.response?.data });
  }
});

app.post('/api/sendImage', async (req, res) => {
  const { instanceId, token, chatId, image, caption } = req.body;
  if (!instanceId || !token || !chatId || !image) {
    return res.status(400).json({ error: 'Eksik parametre' });
  }
  try {
    const url = `https://api.ultramsg.com/${instanceId}/messages/image`;
    const form = qs.stringify({
      token,
      to: chatId,
      image,      // Görselin URL'si
      caption,    // Açıklama (opsiyonel)
      priority: '',
      referenceId: '',
      nocache: '',
      msgId: '',
      mentions: ''
    });
    const response = await axios.post(url, form, {
      headers: { 'content-type': 'application/x-www-form-urlencoded' }
    });
    res.json(response.data);
  } catch (error) {
    console.error('UltraMsg Görsel Gönderme Hatası:', error.message, error.response?.data);
    res.status(500).json({ error: error.message || 'Bilinmeyen hata', detail: error.response?.data });
  }
});

app.post('/api/uploadImage', upload.single('image'), async (req, res) => {
  try {
    const filePath = req.file.path;
    const fileData = fs.readFileSync(filePath, { encoding: 'base64' });

    // imgBB API KEY'inizi buraya yazın
    const imgbbApiKey = 'YOUR_IMGBB_API_KEY';

    const form = new FormData();
    form.append('key', imgbbApiKey);
    form.append('image', fileData);

    const response = await axios.post('https://api.imgbb.com/1/upload', form, {
      headers: form.getHeaders(),
    });

    fs.unlinkSync(filePath); // temp dosyayı sil

    res.json({ url: response.data.data.url });
  } catch (error) {
    res.status(500).json({ error: 'Upload failed', detail: error.message });
  }
});

