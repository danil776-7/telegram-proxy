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
        
        // ВРЕМЯ В ЧАСОВОМ ПОЯСЕ ПОЛЬЗОВАТЕЛЯ (Амстердам)
        const time = new Date().toLocaleString('nl-NL', {
            timeZone: 'Europe/Amsterdam',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        });
        
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
        
        console.log('✅ Сообщение отправлено, ok:', result.ok);
        res.json({ ok: result.ok });
        
    } catch (err) {
        console.error('Ошибка:', err);
        res.status(500).json({ ok: false });
    }
});

app.get('/getUpdates', async (req, res) => {
    res.header('Access-Control-Allow-Origin', '*');
    const { offset, ip } = req.query;
    try {
        const url = `https://api.telegram.org/bot${BOT_TOKEN}/getUpdates?offset=${offset || 0}&timeout=30`;
        const response = await fetch(url);
        const data = await response.json();
        
        // Фильтруем сообщения для конкретного пользователя
        if (data.ok && data.result && ip) {
            const filtered = [];
            for (const update of data.result) {
                const msg = update.message;
                if (msg && msg.chat.id === GROUP_CHAT_ID && msg.text && !msg.text.includes('НОВЫЙ ПОЛЬЗОВАТЕЛЬ')) {
                    // Здесь можно добавить фильтрацию по топику
                    filtered.push({
                        update_id: update.update_id,
                        message: {
                            text: msg.text,
                            from: msg.from?.first_name || 'Поддержка',
                            date: msg.date
                        }
                    });
                }
            }
            data.result = filtered;
        }
        res.json(data);
    } catch (err) {
        res.status(500).json({ ok: false });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`\n🚀 Сервер на порту ${PORT}\n`);
});
