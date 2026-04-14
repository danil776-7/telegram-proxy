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

// Хранилище
const userData = new Map();

async function callTelegram(method, params) {
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/${method}`;
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(params)
        });
        const data = await response.json();
        console.log(`📡 ${method}:`, data.ok ? 'OK' : 'ERROR', data.description || '');
        return data;
    } catch (err) {
        console.error(`❌ Ошибка ${method}:`, err);
        return { ok: false, error: err.message };
    }
}

app.get('/', (req, res) => {
    res.json({ status: 'ok', message: 'Proxy работает!' });
});

// РЕГИСТРАЦИЯ
app.post('/register', async (req, res) => {
    console.log('📞 РЕГИСТРАЦИЯ:', req.body);
    const { userId, ip, phone, region } = req.body;
    
    if (!phone) {
        return res.status(400).json({ ok: false, error: 'phone required' });
    }
    
    try {
        // Создаём топик
        const topic = await callTelegram('createForumTopic', {
            chat_id: GROUP_CHAT_ID,
            name: `👤 ${userId.substring(0, 20)}`
        });
        
        if (!topic.ok) {
            return res.status(500).json({ ok: false, error: topic.description });
        }
        
        const topicId = topic.result.message_thread_id;
        userData.set(ip, { topicId, phone, region, userId });
        
        const time = new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });
        
        // Отправляем информацию о пользователе
        await callTelegram('sendMessage', {
            chat_id: GROUP_CHAT_ID,
            message_thread_id: topicId,
            text: `🔔 **НОВЫЙ ПОЛЬЗОВАТЕЛЬ!**\n\n🆔 **ID:** ${userId}\n📡 **IP:** ${ip}\n📍 **Регион:** ${region || 'не определён'}\n📞 **Телефон:** ${phone}\n⏰ **Время:** ${time}`,
            parse_mode: 'Markdown'
        });
        
        console.log('✅ Регистрация успешна, топик:', topicId);
        res.json({ ok: true, topicId });
        
    } catch (err) {
        console.error('❌ Ошибка:', err);
        res.status(500).json({ ok: false, error: err.message });
    }
});

// ОТПРАВКА СООБЩЕНИЯ
app.post('/send', async (req, res) => {
    console.log('📨 СООБЩЕНИЕ:', { userId: req.body.userId, ip: req.body.ip, text: req.body.text?.substring(0, 50) });
    const { userId, ip, text, imageBase64 } = req.body;
    
    const data = userData.get(ip);
    if (!data) {
        console.log('❌ Нет регистрации для IP:', ip);
        return res.status(400).json({ ok: false, error: 'Please register first' });
    }
    
    try {
        if (imageBase64) {
            const matches = imageBase64.match(/^data:image\/(\w+);base64,(.+)$/);
            if (matches) {
                const buffer = Buffer.from(matches[2], 'base64');
                const formData = new FormData();
                formData.append('chat_id', GROUP_CHAT_ID);
                formData.append('message_thread_id', data.topicId);
                formData.append('photo', new Blob([buffer]), 'image.jpg');
                if (text) formData.append('caption', `💬 **${userId}:**\n\n${text}`);
                
                await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, {
                    method: 'POST',
                    body: formData
                });
            }
        } else if (text) {
            await callTelegram('sendMessage', {
                chat_id: GROUP_CHAT_ID,
                message_thread_id: data.topicId,
                text: `💬 **${userId}:**\n\n${text}`,
                parse_mode: 'Markdown'
            });
        }
        console.log('✅ Сообщение отправлено');
        res.json({ ok: true });
    } catch (err) {
        console.error('❌ Ошибка:', err);
        res.status(500).json({ ok: false });
    }
});

// ПОЛУЧЕНИЕ ОТВЕТОВ
app.get('/getUpdates', async (req, res) => {
    const { offset } = req.query;
    try {
        const url = `https://api.telegram.org/bot${BOT_TOKEN}/getUpdates?offset=${offset || 0}&timeout=30`;
        const response = await fetch(url);
        const data = await response.json();
        
        if (data.ok && data.result) {
            const filtered = [];
            for (const update of data.result) {
                const msg = update.message;
                if (msg && msg.chat.id === GROUP_CHAT_ID && !msg.from?.is_bot) {
                    if (msg.text && !msg.text.includes('НОВЫЙ ПОЛЬЗОВАТЕЛЬ')) {
                        filtered.push({
                            update_id: update.update_id,
                            message: {
                                text: msg.text || '',
                                from: msg.from?.first_name || 'Поддержка',
                                date: msg.date
                            }
                        });
                    }
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
