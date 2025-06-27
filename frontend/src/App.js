import React, { useEffect, useState, useRef } from 'react';
import io from 'socket.io-client';
import './App.css';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000';

export default function App() {
  // Giriş ve oturum state'leri
  const [instanceId, setInstanceId] = useState(localStorage.getItem('instanceId') || '');
  const [token, setToken] = useState(localStorage.getItem('token') || '');
  const [isLoggedIn, setIsLoggedIn] = useState(!!(localStorage.getItem('instanceId') && localStorage.getItem('token')));
  const [loginError, setLoginError] = useState('');
  const [loading, setLoading] = useState(false);

  // Sohbet ve mesaj state'leri
  const [chats, setChats] = useState([]);
  const [selectedChat, setSelectedChat] = useState(null);
  const [messages, setMessages] = useState([]);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);

  // Mesaj gönderme
  const [message, setMessage] = useState('');
  const messagesEndRef = useRef(null);
  const socketRef = useRef(null);
  const oldestTimestampRef = useRef(null);

  // UltraMsg messages
  const [ultraMsgMessages, setUltraMsgMessages] = useState([]);

  const [userNumber, setUserNumber] = useState('');

  // Hazır mesajlar state'i
  const [quickReplies, setQuickReplies] = useState([
    "Merhaba, nasıl yardımcı olabilirim?",
    "Siparişiniz hazırlanıyor.",
    "Kısa süre içinde dönüş yapacağım.",
    "Teşekkürler, iyi günler!",
    "Adresinizi paylaşır mısınız?",
    "Şu anda meşgulüm, sonra yazacağım."
  ]);
  const [editingIndex, setEditingIndex] = useState(null);
  const [editingValue, setEditingValue] = useState('');
  const [editMode, setEditMode] = useState(false);

  // Görsel gönderme state'leri
  const [showImageInput, setShowImageInput] = useState(false);
  const [imageFile, setImageFile] = useState(null);
  const [imageUrl, setImageUrl] = useState('');
  const [imageCaption, setImageCaption] = useState('');

  const jid = x => (x || '').replace('@c.us', '');

  const belongsHere = (m) =>
    [jid(m.from), jid(m.to)].includes(jid(selectedChat));

  // Giriş fonksiyonu
  const handleLogin = async () => {
    setLoginError('');
    if (!instanceId || !token) {
      setLoginError('Tüm alanlar gerekli');
      return;
    }
    // UltraMsg doğrulaması
    const res = await fetch(`${API_URL}/api/ultramsg-auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instanceId, token })
    });
    const data = await res.json();
    if (data.success) {
      // 1) Kimlik bilgilerini kaydet
      await fetch(`${API_URL}/api/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instanceId, token })
      });
      // 2) localStorage'a yaz ve panele geç
      localStorage.setItem('instanceId', instanceId);
      localStorage.setItem('token', token);
      setIsLoggedIn(true);
    } else {
      setLoginError(data.error || 'Giriş başarısız');
    }
  };

  // Çıkış fonksiyonu
  const handleLogout = () => {
    localStorage.removeItem('instanceId');
    localStorage.removeItem('token');
    setIsLoggedIn(false);
    setInstanceId('');
    setToken('');
    setChats([]);
    setMessages([]);
    setSelectedChat(null);
  };

  // Sohbet listesini çek
  useEffect(() => {
    if (instanceId && token) {
      fetch(`${API_URL}/api/chats?instanceId=${instanceId}&token=${token}`)
        .then(res => res.json())
        .then(data => setChats(Array.isArray(data) ? data : []));
    }
  }, [instanceId, token]);

  // Aktif sohbetin mesajlarını çek
  useEffect(() => {
    if (!isLoggedIn || !selectedChat) return;
    fetch(`${API_URL}/api/messages/${selectedChat}?instanceId=${instanceId}&token=${token}`)
      .then(res => res.json())
      .then(setMessages);
  }, [isLoggedIn, selectedChat, instanceId, token]);

  // Socket.io ile anlık mesajları dinle
  useEffect(() => {
    if (!isLoggedIn) return;
    socketRef.current = io(API_URL, { query: { instanceId } });
    socketRef.current.on('new-message', (msg) => {
      console.log('socket:', msg);
      if (belongsHere(msg)) {
        setMessages(prev => [...prev, msg]);
      }
      // Sohbetleri güncelle
      fetch(`${API_URL}/api/chats?instanceId=${instanceId}&token=${token}`)
        .then(res => {
          if (!res.ok) throw new Error('Sunucu hatası');
          return res.json();
        })
        .then(data => {
          console.log('Gelen sohbetler:', data);
          setChats(Array.isArray(data) ? data : []);
        })
        .catch(err => {
          setChats([]); // Hata olursa boş array ata
          // İstersen kullanıcıya hata mesajı göster
        });
    });
    return () => socketRef.current.disconnect();
  }, [isLoggedIn, selectedChat, instanceId, token]);

  // Mesaj gönder
  const handleSend = () => {
    if (!message.trim() || !selectedChat) return;
    fetch(`${API_URL}/api/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instanceId,
        token,
        chatId: selectedChat,
        body: message
      })
    })
      .then(res => res.json())
      .then(data => {
        setMessage('');
        // Optimistik ekleme veya socket ile bekleme
      });
  };

  const loadOlderMessages = () => {
    if (!hasMore || loadingMessages) return;
    setLoadingMessages(true);

    const oldest = messages[0]?.timestamp;
    const params = [];
    params.push(selectedChat, selectedChat);
    if (oldest) params.push(oldest);
    params.push(20);

    fetch(
      `${API_URL}/api/messages?instanceId=${instanceId}&token=${token}&before=${oldest}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ params })
      }
    )
      .then(r => r.json())
      .then(data => {
        setMessages(prev => [...data, ...prev]);
        setHasMore(data.length === 20);
      })
      .finally(() => setLoadingMessages(false));
  };

  const normalize = x => (x || '').replace('@c.us', '');
  const isMine = msg => normalize(msg.from) === normalize(instanceId);

  // UltraMsg messages fetch
  const fetchUltraMsgMessages = async () => {
    const res = await fetch(
      `${API_URL}/api/ultramsg/messages?instanceId=${instanceId}&token=${token}&page=1&limit=10`
    );
    const data = await res.json();
    setMessages(Array.isArray(data.messages) ? data.messages : []);
  };

  useEffect(() => {
    fetchUltraMsgMessages();
  }, [instanceId, token]);

  useEffect(() => {
    fetch(`${API_URL}/api/me?instanceId=${instanceId}&token=${token}`)
      .then(res => res.json())
      .then(data => setUserNumber(data.id)); // id: "9053xxxxxxx@c.us"
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, selectedChat]);

  const unreadChatsCount = chats.filter(chat => (chat.unread || chat.unreadCount || 0) > 0).length;

  // Hazır mesajı düzenleme başlat
  const startEdit = (i) => {
    setEditingIndex(i);
    setEditingValue(quickReplies[i]);
  };

  // Hazır mesajı kaydet
  const saveEdit = () => {
    if (editingIndex === null) return;
    const updated = [...quickReplies];
    updated[editingIndex] = editingValue;
    setQuickReplies(updated);
    setEditingIndex(null);
    setEditingValue('');
  };

  // Hazır mesajı iptal et
  const cancelEdit = () => {
    setEditingIndex(null);
    setEditingValue('');
  };

  // Hazır mesajı sohbete gönder
  const sendQuickReply = (msg) => {
    if (!selectedChat) return;
    setMessage(msg);
    // İstersen direkt gönderebilirsin:
    // handleSend(msg);
  };

  // Sohbetler değişince son sohbeti otomatik seç
  useEffect(() => {
    if (chats.length > 0) {
      setSelectedChat(chats[0].id || chats[0].chatId || chats[0].phone);
    }
  }, [chats]);

  // Dosya seçilince
  const handleFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // 1. Dosyayı backend'e upload et
    const formData = new FormData();
    formData.append('image', file);

    const uploadRes = await fetch('/api/uploadImage', {
      method: 'POST',
      body: formData
    });
    const uploadData = await uploadRes.json();
    if (!uploadData.url) return alert('Görsel yüklenemedi!');

    // 2. UltraMsg API'ye görseli gönder
    fetch('/api/sendImage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instanceId,
        token,
        chatId: selectedChat,
        image: uploadData.url,
        caption: ''
      })
    })
      .then(res => res.json())
      .then(() => {
        // Başarılıysa inputu temizle
      });
  };

  // Fotoğrafı UltraMsg ile göndermek için önce bir yere upload edip URL almalısın.
  // (UltraMsg sadece URL ile çalışır, base64 veya dosya upload desteklemez.)
  // Burada örnek olarak dosya seçimini ve URL inputunu gösteriyorum:

  const handleSendImage = () => {
    if (!imageFile && !imageUrl) return;
    // Burada imageFile'ı bir yere upload edip URL almalısın.
    // Örnek: imageUrl = await uploadToSomewhere(imageFile);
    // Şimdilik sadece URL ile gönderelim:
    fetch('/api/sendImage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instanceId,
        token,
        chatId: selectedChat,
        image: imageUrl, // veya upload sonrası imageFile'dan gelen url
        caption: imageCaption
      })
    })
      .then(res => res.json())
      .then(() => {
        setShowImageInput(false);
        setImageFile(null);
        setImageUrl('');
        setImageCaption('');
      });
  };

  // Giriş ekranı
  if (!isLoggedIn) {
    return (
      <div style={{ minHeight: '100vh', background: '#181a20', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#e0e0e0' }}>
        <div style={{ background: '#23272f', borderRadius: 16, padding: 40, boxShadow: '0 4px 32px #000a', display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 320 }}>
          <h2 style={{ marginBottom: 24 }}>UltraMsg ile Giriş Yap</h2>
          <input
            type="text"
            placeholder="Instance ID"
            value={instanceId}
            onChange={e => setInstanceId(e.target.value)}
            style={{ marginBottom: 16, padding: 10, borderRadius: 6, border: '1px solid #333', background: '#181a20', color: '#e0e0e0', width: '100%' }}
          />
          <input
            type="text"
            placeholder="Token"
            value={token}
            onChange={e => setToken(e.target.value)}
            style={{ marginBottom: 16, padding: 10, borderRadius: 6, border: '1px solid #333', background: '#181a20', color: '#e0e0e0', width: '100%' }}
          />
          <button
            onClick={handleLogin}
            disabled={loading}
            style={{ padding: '10px 22px', borderRadius: 8, border: 'none', background: '#00bfa5', color: '#181a20', fontWeight: 600, fontSize: 16, cursor: 'pointer', width: '100%' }}
          >
            {loading ? 'Bağlanıyor...' : 'Giriş Yap'}
          </button>
          {loginError && <div style={{ color: 'red' }}>{loginError}</div>}
        </div>
      </div>
    );
  }

  // Panel (sohbet listesi ve aktif sohbet)
  return (
    <div style={{
      display: 'flex',
      height: '100vh',
      background: '#181a20',
      color: '#fff',
      fontFamily: 'Inter, Arial, sans-serif',
      overflow: 'hidden'
    }}>
      {/* Sol: Sohbet Listesi */}
      <div style={{
        width: 320,
        borderRight: '1px solid #23272f',
        background: '#20232a',
        display: 'flex',
        flexDirection: 'column'
      }}>
        {/* Sabit Başlık */}
        <div style={{
          height: 60,
          minHeight: 60,
          maxHeight: 60,
          display: 'flex',
          alignItems: 'center',
          padding: '0 24px',
          fontWeight: 700,
          fontSize: 20,
          borderBottom: '1px solid #23272f',
          background: '#20232a',
          position: 'sticky',
          top: 0,
          zIndex: 2
        }}>
          <span>Sohbetler</span>
          {unreadChatsCount > 0 && (
            <span style={{
              background: '#4fbe79',
              color: '#fff',
              borderRadius: 12,
              minWidth: 28,
              height: 24,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 700,
              fontSize: 15,
              marginLeft: 12,
              padding: '0 10px'
            }}>
              {unreadChatsCount}
            </span>
          )}
          <div style={{ flex: 1 }} />
          <button
            onClick={handleLogout}
            style={{
              background: '#4fbe79',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              padding: '8px 18px',
              fontWeight: 700,
              cursor: 'pointer'
            }}
          >
            Çıkış
          </button>
        </div>
        {/* Scrollable Sohbet Listesi */}
        <div style={{
          flex: 1,
          overflowY: 'auto'
        }} className="hide-scrollbar">
          {chats.map(chat => {
            const chatId = chat.id || chat.chatId || chat.phone;
            const unread = chat.unread || chat.unreadCount || 0; // UltraMsg'de genelde 'unread'

            return (
              <div
                key={chatId}
                onClick={() => setSelectedChat(chatId)}
                style={{
                  position: 'relative',
                  padding: 16,
                  cursor: 'pointer',
                  background: selectedChat === chatId ? '#23272f' : 'none',
                  borderBottom: '1px solid #23272f',
                  color: '#fff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between'
                }}
              >
                <div>
                  <div style={{ fontWeight: 600 }}>{chat.name || chat.phone || chatId}</div>
                  <div style={{ fontSize: 13, color: '#aaa', marginTop: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {chat.lastMessage || chat.message || ''}
                  </div>
                </div>
                {/* Okunmamış mesaj badge'i */}
                {unread > 0 && (
                  <div style={{
                    minWidth: 22,
                    height: 22,
                    background: '#4fbe79',
                    color: '#fff',
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: 700,
                    fontSize: 13,
                    marginLeft: 12
                  }}>
                    {unread}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Sağ: Mesajlar Alanı */}
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        background: '#181a20'
      }}>
        {/* Sabit Başlık */}
        <div style={{
          height: 60,
          minHeight: 60,
          maxHeight: 60,
          display: 'flex',
          alignItems: 'center',
          padding: '0 24px',
          fontWeight: 700,
          fontSize: 18,
          borderBottom: '1px solid #23272f',
          background: '#20232a',
          position: 'sticky',
          top: 0,
          zIndex: 2
        }}>
          {selectedChat || 'Bir sohbet seçin'}
        </div>
        {/* Scrollable Mesajlar */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: 24,
            display: 'flex',
            flexDirection: 'column'
          }}
          className="hide-scrollbar"
        >
          {selectedChat ? (
            <>
              {messages.map(msg => {
                const isMe =
                  msg.from === userNumber     ||
                  msg.from === 'me'           ||
                  msg.fromMe === true         ||
                  msg.self    === true        ||
                  msg.author  === userNumber;

                return (
                  <div
                    key={msg.id || msg._id}
                    style={{
                      display: 'flex',
                      flexDirection: 'row',
                      justifyContent: isMe ? 'flex-end' : 'flex-start',
                      width: '100%',
                      margin: '8px 0'
                    }}
                  >
                    <div
                      style={{
                        background: isMe ? '#4fbe79' : '#222',
                        color: isMe ? '#fff' : '#eee',
                        padding: '10px 16px',
                        borderRadius: 16,
                        maxWidth: '70%',
                        textAlign: 'left'
                      }}
                    >
                      {msg.body}
                    </div>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
              {loadingMessages && <div style={{ color: '#aaa', textAlign: 'center', margin: 12 }}>Yükleniyor...</div>}
            </>
          ) : (
            <div style={{
              color: '#aaa',
              fontSize: 20,
              margin: 'auto',
              textAlign: 'center',
              opacity: 0.7
            }}>
              Sohbet seçiniz
            </div>
          )}
        </div>
        {/* Sabit Input */}
        <div style={{
          height: 60,
          minHeight: 60,
          maxHeight: 60,
          display: 'flex',
          alignItems: 'center',
          padding: '0 24px',
          borderTop: '1px solid #23272f',
          background: '#20232a'
        }}>
          <div style={{
            position: 'relative',
            flex: 1,
            display: 'flex',
            alignItems: 'center'
          }}>
            <input
              value={message}
              onChange={e => setMessage(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleSend(); }}
              style={{
                width: '100%',
                background: '#23272f',
                color: '#fff',
                border: 'none',
                borderRadius: 8,
                padding: '10px 48px 10px 16px',
                fontSize: 16,
                outline: 'none'
              }}
              placeholder="Mesaj yazın..."
            />
            {/* + butonu inputun en sağında, dosya seçtiriyor */}
            <label style={{
              position: 'absolute',
              right: 12,
              top: '50%',
              transform: 'translateY(-50%)',
              background: '#23272f',
              color: '#4fbe79',
              border: '1.5px solid #4fbe79',
              borderRadius: 8,
              padding: '6px 14px',
              fontWeight: 900,
              fontSize: 22,
              cursor: 'pointer',
              zIndex: 2
            }}>
              +
              <input
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={handleFileChange}
              />
            </label>
          </div>
          <button
            onClick={handleSend}
            style={{
              marginLeft: 8,
              background: '#4fbe79',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              padding: '10px 18px',
              fontWeight: 700,
              cursor: 'pointer'
            }}
          >
            Gönder
          </button>
        </div>
      </div>

      {/* Sağ: Hazır Mesajlar Kolonu */}
      <div style={{
        width: 320,
        background: '#20232a',
        borderLeft: '1px solid #23272f',
        display: 'flex',
        flexDirection: 'column',
        height: '100vh'
      }}>
        {/* En üstte çıkış butonu */}
        <div style={{
          height: 60,
          minHeight: 60,
          maxHeight: 60,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          padding: '0 24px',
          borderBottom: '1px solid #23272f',
          background: '#20232a',
          position: 'sticky',
          top: 0,
          zIndex: 2
        }}>
          <button
            onClick={handleLogout}
            style={{
              background: '#4fbe79',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              padding: '8px 18px',
              fontWeight: 700,
              cursor: 'pointer'
            }}
          >
            Çıkış
          </button>
        </div>
        {/* Hazır Mesajlar Başlığı ve Düzenle Butonu */}
        <div style={{
          padding: '18px 24px 8px 24px',
          fontWeight: 700,
          fontSize: 18,
          borderBottom: '1px solid #23272f',
          background: '#20232a',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between'
        }}>
          <span>Hazır Mesajlar</span>
          <button
            onClick={() => {
              setEditMode(!editMode);
              setEditingIndex(null);
              setEditingValue('');
            }}
            style={{
              background: editMode ? '#4fbe79' : '#23272f',
              color: editMode ? '#fff' : '#4fbe79',
              border: '1.5px solid #4fbe79',
              borderRadius: 6,
              padding: '6px 10px',
              fontWeight: 700,
              marginLeft: 8,
              cursor: 'pointer',
              transition: 'background 0.2s, color 0.2s'
            }}
          >
            {editMode ? 'Düzenlemeyi Kapat' : 'Düzenle'}
          </button>
        </div>
        {/* Hazır Mesajlar Listesi */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 24px' }} className="hide-scrollbar">
          {quickReplies.map((msg, i) => (
            <div
              key={i}
              style={{
                background: editingIndex === i ? '#2d3a2e' : '#23272f',
                borderRadius: 8,
                padding: 12,
                marginBottom: 14,
                display: 'flex',
                alignItems: 'center',
                border: editingIndex === i ? '2px solid #4fbe79' : 'none',
                transition: 'background 0.2s, border 0.2s',
                cursor: editMode && editingIndex === null ? 'pointer' : 'default'
              }}
              onClick={() => {
                if (editMode && editingIndex === null) {
                  setEditingIndex(i);
                  setEditingValue(msg);
                }
              }}
            >
              {editingIndex === i ? (
                <>
                  <input
                    value={editingValue}
                    onChange={e => setEditingValue(e.target.value)}
                    style={{
                      flex: 1,
                      background: '#181a20',
                      color: '#fff',
                      border: '1.5px solid #4fbe79',
                      borderRadius: 6,
                      padding: '6px 10px',
                      fontSize: 15,
                      marginRight: 8,
                      outline: 'none',
                      fontWeight: 600
                    }}
                  />
                  <button
                    onClick={() => {
                      const updated = [...quickReplies];
                      updated[i] = editingValue;
                      setQuickReplies(updated);
                      setEditingIndex(null);
                      setEditingValue('');
                    }}
                    style={{
                      background: '#4fbe79',
                      color: '#fff',
                      border: 'none',
                      borderRadius: 6,
                      padding: '6px 10px',
                      fontWeight: 700,
                      marginRight: 4,
                      cursor: 'pointer'
                    }}
                  >
                    Kaydet
                  </button>
                  <button
                    onClick={() => {
                      setEditingIndex(null);
                      setEditingValue('');
                    }}
                    style={{
                      background: '#444',
                      color: '#fff',
                      border: 'none',
                      borderRadius: 6,
                      padding: '6px 10px',
                      fontWeight: 700,
                      cursor: 'pointer'
                    }}
                  >
                    İptal
                  </button>
                </>
              ) : (
                <span
                  style={{
                    flex: 1,
                    cursor: editMode ? 'pointer' : 'pointer',
                    opacity: editMode && editingIndex === null ? 0.7 : 1
                  }}
                  onClick={e => {
                    if (!editMode) sendQuickReply(msg);
                  }}
                  title={editMode ? 'Düzenlemek için tıkla' : 'Sohbete ekle'}
                >
                  {msg}
                </span>
              )}
            </div>
          ))}

          {/* --- Hazır Mesajlar Altı Butonlar --- */}
          <div style={{ marginTop: 32, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <button
              style={quickButtonStyle}
              onClick={() => alert('Müşteriyi telefonla ara')}
            >
              Müşteriyi Telefonla Ara
            </button>
            <button
              style={quickButtonStyle}
              onClick={() => alert('Yapay zekayı sustur')}
            >
              Yapay Zekayı Sustur
            </button>
            <button
              style={quickButtonStyle}
              onClick={() => alert('Yapay zekayı aç')}
            >
              Yapay Zekayı Aç
            </button>
            <button
              style={quickButtonStyle}
              onClick={() => alert('Sipariş detayına git')}
            >
              Sipariş Detayına Git
            </button>
            <button
              style={quickButtonStyle}
              onClick={() => alert('Müşteriyi panelden sorgula')}
            >
              Müşteriyi Panelden Sorgula
            </button>
            <button
              style={quickButtonStyle}
              onClick={() => alert('Yeni sipariş oluştur')}
            >
              Yeni Sipariş Oluştur
            </button>
          </div>
        </div>
        {/* EN ALTTA ZUHAYR */}
        <div style={{
          width: '100%',
          textAlign: 'center',
          color: 'rgba(79, 190, 121, 0.6)',
          fontSize: 15,
          letterSpacing: 2,
          userSelect: 'none',
          pointerEvents: 'none',
          fontWeight: 700,
          padding: '16px 0 20px 0'
        }}>
          {atob('WnVoYXly')}
        </div>
      </div>

      {showImageInput && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000
        }}>
          <div style={{
            background: '#23272f',
            padding: 32,
            borderRadius: 12,
            minWidth: 320,
            display: 'flex',
            flexDirection: 'column',
            gap: 12
          }}>
            <b style={{ color: '#fff', marginBottom: 8 }}>Görsel URL'si</b>
            <input
              value={imageUrl}
              onChange={e => setImageUrl(e.target.value)}
              placeholder="https://..."
              style={{
                padding: 10,
                borderRadius: 6,
                border: 'none',
                background: '#181a20',
                color: '#fff'
              }}
            />
            <input
              value={imageCaption}
              onChange={e => setImageCaption(e.target.value)}
              placeholder="Açıklama (opsiyonel)"
              style={{
                padding: 10,
                borderRadius: 6,
                border: 'none',
                background: '#181a20',
                color: '#fff'
              }}
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button
                onClick={handleSendImage}
                style={{
                  background: '#4fbe79',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 6,
                  padding: '8px 18px',
                  fontWeight: 700,
                  cursor: 'pointer'
                }}
              >
                Gönder
              </button>
              <button
                onClick={() => setShowImageInput(false)}
                style={{
                  background: '#444',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 6,
                  padding: '8px 18px',
                  fontWeight: 700,
                  cursor: 'pointer'
                }}
              >
                İptal
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const quickButtonStyle = {
  background: '#23272f',
  color: '#4fbe79',
  border: '1px solid #4fbe79',
  borderRadius: 8,
  padding: '10px 0',
  fontWeight: 700,
  fontSize: 15,
  cursor: 'pointer',
  width: '100%',
  transition: 'background 0.2s, color 0.2s',
};
