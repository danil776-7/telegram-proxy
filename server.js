const express = require('express');
const cors = require('cors');
const app = express();

// --- НАСТРОЙКИ CORS (САМЫЕ ВАЖНЫЕ) ---
app.use(cors({
    origin: '*', // Разрешаем запросы с любых доменов
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type']
}));
app.options('*', cors()); // Обрабатываем preflight-запросы

app.use(express.json({ limit: '50mb' }));

const BOT_TOKEN = '8743342099:AAGWRLBrNjd8YlkHPSeqOU64J4-0fJdILPg';
const GROUP_CHAT_ID = -1003765383331;

console.log('🚀 Сервер запускается...');

// Хранилище (простое, но для теста достаточно)
const users = new Map();

// Корневой маршрут для проверки
app.get('/', (req, res) => {
    res.json({ status: 'ok', message: 'Proxy работает! CORS настроен' });
});

// Регистрация номера телефона
app.post('/register', (req, res) => {
    const { userId, site, ip, phone, region } = req.body;
    console.log(`📞 Регистрация: ${ip} -> ${phone}`);
    users.set(ip, { userId, phone, region, site, lastActive: Date.now() });
    res.json({ ok: true });
});

// Отправка сообщения в Telegram
app.post('/send', async (req, res) => {
    const { userId, site, ip, text, imageBase64 } = req.body;
    console.log(`📨 Сообщение от ${ip}: ${text?.substring(0, 50)}`);
    
    if (!ip) return res.status(400).json({ ok: false, error: 'ip required' });
    
    try {
        const messageText = `💬 **${userId || ip}:**\n\n${text || 'Изображение'}`;
        
        if (imageBase64) {
            const matches = imageBase64.match(/^data:image\/(\w+);base64,(.+)$/);
            if (matches) {
                const buffer = Buffer.from(matches[2], 'base64');
                const formData = new FormData();
                formData.append('chat_id', GROUP_CHAT_ID);
                formData.append('photo', new Blob([buffer]), 'image.jpg');
                if (text) formData.append('caption', messageText);
                
                const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, {
                    method: 'POST',
                    body: formData
                });
                const data = await response.json();
                return res.json(data);
            }
        }
        
        const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: GROUP_CHAT_ID,
                text: messageText,
                parse_mode: 'Markdown'
            })
        });
        const data = await response.json();
        res.json(data);
        
    } catch (error) {
        console.error('Ошибка отправки:', error);
        res.status(500).json({ ok: false, error: error.message });
    }
});

// Получение обновлений
app.get('/getUpdates', async (req, res) => {
    const { offset } = req.query;
    console.log(`📡 Запрос getUpdates, offset: ${offset}`);
    try {
        const url = `https://api.telegram.org/bot${BOT_TOKEN}/getUpdates?offset=${offset || 0}&timeout=30`;
        const response = await fetch(url);
        const data = await response.json();
        
        if (data.ok && data.result) {
            const filtered = data.result.filter(update => {
                const msg = update.message;
                return msg && !msg.from?.is_bot && msg.text && !msg.text.startsWith('💬');
            });
            data.result = filtered;
        }
        res.json(data);
    } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✅ Сервер запущен на порту ${PORT}`);
});
