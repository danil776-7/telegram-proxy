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

const users = new Map();

app.get('/', (req, res) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.json({ status: 'ok', message: 'Proxy работает!' });
});

app.post('/register', async (req, res) => {
    res.header('Access-Control-Allow-Origin', '*');
    console.log('📞 РЕГИСТРАЦИЯ:', req.body);
    const { userId, ip, phone, region } = req.body;
    
    if (!userId || !phone) {
        return res.status(400).json({ ok: false, error: 'userId and phone required' });
    }
    
    try {
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
        users.set(userId, { topicId, phone, region });
        
        const time = new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });
        
        await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: GROUP_CHAT_ID,
                message_thread_id: topicId,
                text: `🔔 НОВЫЙ ПОЛЬЗОВАТЕЛЬ!\n\nID: ${userId}\nIP: ${ip}\nРегион: ${region || 'не определён'}\nТелефон: ${phone}\nВремя: ${time}`
            })
        });
        
        console.log('✅ Регистрация успешна, userId:', userId, 'topicId:', topicId);
        res.json({ ok: true, topicId });
        
    } catch (err) {
        console.error('Ошибка:', err);
        res.status(500).json({ ok: false, error: err.message });
    }
});

app.post('/send', async (req, res) => {
    res.header('Access-Control-Allow-Origin', '*');
    const { userId, text } = req.body;
    console.log('📨 СООБЩЕНИЕ от userId:', userId, 'текст:', text);
    
    const user = users.get(userId);
    console.log('🔍 ПОИСК ПОЛЬЗОВАТЕЛЯ:', userId, 'НАЙДЕН:', !!user, 'topicId:', user?.topicId);
    
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
                text: `💬 ${userId}:\n\n${text}`
            })
        }).then(r => r.json());
        
        console.log('📤 Ответ Telegram:', result);
        
        if (result.ok) {
            console.log('✅ Сообщение отправлено!');
            res.json({ ok: true });
        } else {
            console.error('❌ Ошибка Telegram:', result.description);
            res.json({ ok: false, error: result.description });
        }
    } catch (err) {
        console.error('❌ Ошибка fetch:', err);
        res.status(500).json({ ok: false, error: err.message });
    }
});

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
