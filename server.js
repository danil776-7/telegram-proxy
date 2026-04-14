const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors({ origin: '*', methods: ['GET', 'POST', 'OPTIONS'], allowedHeaders: ['Content-Type'] }));
app.options('*', cors());
app.use(express.json({ limit: '50mb' }));

const BOT_TOKEN = '8743342099:AAGWRLBrNjd8YlkHPSeqOU64J4-0fJdILPg';
const GROUP_CHAT_ID = -1003765383331;

console.log('🚀 СЕРВЕР ЗАПУЩЕН');
console.log('📡 GROUP_CHAT_ID:', GROUP_CHAT_ID);

// Хранилище - ключ = userId, а не ip!
const users = new Map();

app.get('/', (req, res) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.json({ status: 'ok', message: 'Proxy работает!' });
});

// РЕГИСТРАЦИЯ
app.post('/register', async (req, res) => {
    res.header('Access-Control-Allow-Origin', '*');
    console.log('📞 РЕГИСТРАЦИЯ:', req.body);
    const { userId, ip, phone, region } = req.body;
    
    if (!userId || !phone) {
        return res.status(400).json({ ok: false, error: 'userId and phone required' });
    }
    
    try {
        // Создаём топик
        const topic = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/createForumTopic`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: GROUP_CHAT_ID,
                name: `👤 ${userId.substring(0, 20)}`
            })
        }).then(r => r.json());
        
        if (!topic.ok) {
            console.error('Ошибка создания топика:', topic);
            return res.status(500).json({ ok: false, error: topic.description });
        }
        
        const topicId = topic.result.message_thread_id;
        // КЛЮЧ = userId, а не ip!
        users.set(userId, { topicId, phone, region });
        
        console.log('📦 Текущие пользователи:', Array.from(users.keys()));
        console.log('✅ Регистрация успешна, userId:', userId, 'topicId:', topicId);
        
        const time = new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });
        
        // Отправляем информацию
        await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: GROUP_CHAT_ID,
                message_thread_id: topicId,
                text: `🔔 НОВЫЙ ПОЛЬЗОВАТЕЛЬ!\n\n🆔 ID: ${userId}\n📡 IP: ${ip}\n📍 Регион: ${region || 'не определён'}\n📞 Телефон: ${phone}\n⏰ Время: ${time}`,
                parse_mode: 'Markdown'
            })
        });
        
        res.json({ ok: true, topicId });
        
    } catch (err) {
        console.error('Ошибка:', err);
        res.status(500).json({ ok: false, error: err.message });
    }
});

// ОТПРАВКА СООБЩЕНИЯ
app.post('/send', async (req, res) => {
    res.header('Access-Control-Allow-Origin', '*');
    const { userId, text } = req.body;
    console.log('📨 СООБЩЕНИЕ от userId:', userId, 'текст:', text?.substring(0, 50));
    
    // Ищем по userId
    const user = users.get(userId);
    console.log('🔍 ПОИСК ПОЛЬЗОВАТЕЛЯ:', userId, 'НАЙДЕН:', !!user);
    
    if (!user) {
        console.log('❌ Нет регистрации для userId:', userId);
        return res.status(400).json({ ok: false, error: 'Please register first' });
    }
    
    try {
        const result = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: GROUP_CHAT_ID,
                message_thread_id: user.topicId,
                text: `💬 ${userId}:\n\n${text}`,
                parse_mode: 'Markdown'
            })
        }).then(r => r.json());
        
        console.log('✅ Сообщение отправлено, ok:', result.ok);
        if (!result.ok) {
            console.error('❌ Ошибка Telegram:', result);
        }
        res.json({ ok: result.ok });
    } catch (err) {
        console.error('Ошибка:', err);
        res.status(500).json({ ok: false });
    }
});

// ПОЛУЧЕНИЕ ОТВЕТОВ
app.get('/getUpdates', async (req, res) => {
    res.header('Access-Control-Allow-Origin', '*');
    const { offset } = req.query;
    try {
        const url = `https://api.telegram.org/bot${BOT_TOKEN}/getUpdates?offset=${offset || 0}&timeout=30`;
        const response = await fetch(url);
        const data = await response.json();
        res.json(data);
    } catch (err) {
        res.status(500).json({ ok: false });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`\n🚀 Сервер на порту ${PORT}\n`);
});
