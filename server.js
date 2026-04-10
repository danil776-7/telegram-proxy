const express = require('express');
const cors = require('cors');
const app = express();

// Разрешаем все CORS запросы
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type']
}));
app.options('*', cors());
app.use(express.json({ limit: '50mb' }));

const BOT_TOKEN = '8743342099:AAGWRLBrNjd8YlkHPSeqOU64J4-0fJdILPg';
const GROUP_CHAT_ID = -1003765383331;

console.log('🚀 Сервер запускается...');
console.log('📡 BOT_TOKEN:', BOT_TOKEN.substring(0, 20) + '...');
console.log('📡 GROUP_CHAT_ID:', GROUP_CHAT_ID);

// Хранилище данных пользователей
const users = new Map();

// Функция для форматирования времени в Московское время
function getMoscowTime() {
    const now = new Date();
    return now.toLocaleString('ru-RU', {
        timeZone: 'Europe/Moscow',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
}

// === ЭНДПОИНТЫ ===

// Проверка работоспособности сервера
app.get('/', (req, res) => {
    res.json({ status: 'ok', message: 'Telegram Proxy работает! Версия 2.0' });
});

// Регистрация номера телефона
app.post('/register', async (req, res) => {
    const { userId, site, ip, phone, region } = req.body;
    console.log('📞 Регистрация:', { userId, site, ip, phone, region });
    
    if (!ip || !phone) {
        return res.status(400).json({ ok: false, error: 'ip and phone required' });
    }
    
    users.set(ip, { userId, phone, region, site, lastActive: Date.now() });
    console.log(`✅ Зарегистрирован ${ip}: ${phone}`);
    res.json({ ok: true });
});

// Отправка сообщения в Telegram
app.post('/send', async (req, res) => {
    const { userId, site, ip, text, imageBase64, region } = req.body;
    console.log('📨 Отправка сообщения от:', userId || ip);
    
    if (!ip) return res.status(400).json({ ok: false, error: 'ip required' });
    
    // Обновляем активность пользователя
    if (users.has(ip)) {
        const user = users.get(ip);
        user.lastActive = Date.now();
        users.set(ip, user);
    }
    
    try {
        const messageText = `💬 **${userId || ip}:**\n\n${text || '📷 Изображение'}`;
        
        if (imageBase64) {
            // Отправка фото
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
                console.log('✅ Фото отправлено, ok:', data.ok);
                return res.json(data);
            }
        }
        
        // Отправка текста
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
        console.log('✅ Сообщение отправлено, ok:', data.ok);
        res.json(data);
        
    } catch (error) {
        console.error('❌ Ошибка отправки:', error);
        res.status(500).json({ ok: false, error: error.message });
    }
});

// Получение обновлений из Telegram (для виджета)
app.get('/getUpdates', async (req, res) => {
    const { offset, ip } = req.query;
    console.log('📡 Запрос getUpdates, offset:', offset, 'ip:', ip);
    
    try {
        const url = `https://api.telegram.org/bot${BOT_TOKEN}/getUpdates?offset=${offset || 0}&timeout=30`;
        const response = await fetch(url);
        const data = await response.json();
        
        if (data.ok && data.result) {
            // Фильтруем сообщения от бота
            const filtered = data.result.filter(update => {
                const msg = update.message;
                return msg && !msg.from?.is_bot && msg.text && !msg.text.startsWith('💬');
            });
            data.result = filtered;
            console.log(`📨 Найдено ${filtered.length} новых сообщений`);
        }
        res.json(data);
    } catch (error) {
        console.error('❌ Ошибка getUpdates:', error);
        res.status(500).json({ ok: false, error: error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`\n🚀 Сервер запущен на порту ${PORT}`);
    console.log(`📡 GROUP_CHAT_ID: ${GROUP_CHAT_ID}`);
    console.log(`🕐 Время запуска: ${getMoscowTime()}\n`);
});
