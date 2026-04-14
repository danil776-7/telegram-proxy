const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors({ origin: '*', methods: ['GET', 'POST', 'OPTIONS'], allowedHeaders: ['Content-Type'] }));
app.options('*', cors());
app.use(express.json({ limit: '50mb' }));

const BOT_TOKEN = '8743342099:AAGWRLBrNjd8YlkHPSeqOU64J4-0fJdILPg';
const GROUP_CHAT_ID = -1003911846697;

console.log('🚀 СЕРВЕР ЗАПУЩЕН');
console.log('📡 BOT_TOKEN:', BOT_TOKEN.substring(0, 20) + '...');
console.log('📡 GROUP_CHAT_ID:', GROUP_CHAT_ID);

const users = new Map();

// Проверка бота
async function checkBot() {
    const me = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getMe`).then(r => r.json());
    console.log('🤖 Бот:', me.ok ? me.result.username : 'Ошибка');
}
checkBot();

app.get('/', (req, res) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.json({ status: 'ok', message: 'Proxy работает!' });
});

// РЕГИСТРАЦИЯ
app.post('/register', async (req, res) => {
    res.header('Access-Control-Allow-Origin', '*');
    console.log('📞 РЕГИСТРАЦИЯ ПОЛУЧЕНА:', req.body);
    const { userId, ip, phone, region } = req.body;
    
    if (!userId || !phone) {
        return res.status(400).json({ ok: false, error: 'userId and phone required' });
    }
    
    try {
        // Создаём топик
        console.log('📝 Создаём топик...');
        const topic = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/createForumTopic`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: GROUP_CHAT_ID,
                name: `👤 ${userId.substring(0, 20)}`
            })
        }).then(r => r.json());
        
        console.log('📝 Ответ создания топика:', topic);
        
        if (!topic.ok) {
            console.error('❌ Ошибка создания топика:', topic);
            return res.status(500).json({ ok: false, error: topic.description });
        }
        
        const topicId = topic.result.message_thread_id;
        users.set(userId, { topicId, phone, region, ip });
        
        const time = new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Amsterdam' });
        
        // Отправляем сообщение
        const messageText = `🔔 НОВЫЙ ПОЛЬЗОВАТЕЛЬ!\n\nID: ${userId}\nIP: ${ip}\nРегион: ${region || 'не определён'}\nТелефон: ${phone}\nВремя: ${time}`;
        
        console.log('📤 Отправка сообщения в топик', topicId);
        console.log('📤 Текст:', messageText);
        
        const sent = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: GROUP_CHAT_ID,
                message_thread_id: topicId,
                text: messageText
            })
        }).then(r => r.json());
        
        console.log('✅ Ответ отправки:', sent);
        
        if (!sent.ok) {
            console.error('❌ Ошибка отправки:', sent.description);
            return res.status(500).json({ ok: false, error: sent.description });
        }
        
        console.log('✅ Регистрация успешна!');
        res.json({ ok: true, topicId });
        
    } catch (err) {
        console.error('❌ Ошибка:', err);
        res.status(500).json({ ok: false, error: err.message });
    }
});

// ОТПРАВКА СООБЩЕНИЯ
app.post('/send', async (req, res) => {
    res.header('Access-Control-Allow-Origin', '*');
    const { userId, text } = req.body;
    console.log('📨 СООБЩЕНИЕ от userId:', userId, 'текст:', text);
    
    const user = users.get(userId);
    
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
        
        console.log('✅ Отправка сообщения, результат:', result.ok);
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
