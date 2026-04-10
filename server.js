const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors({ origin: '*', methods: ['GET', 'POST', 'OPTIONS'], allowedHeaders: ['Content-Type'] }));
app.options('*', cors());
app.use(express.json({ limit: '50mb' }));

const BOT_TOKEN = '8743342099:AAGWRLBrNjd8YlkHPSeqOU64J4-0fJdILPg';
const GROUP_CHAT_ID = -1003765383331;

const userTopics = new Map();
const topicToIp = new Map();

async function callTelegram(method, params) {
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/${method}`;
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params)
    });
    return response.json();
}

async function createTopic(ip, userId, phone, region) {
    try {
        console.log('📝 Создаём топик для IP:', ip);
        
        const topic = await callTelegram('createForumTopic', {
            chat_id: GROUP_CHAT_ID,
            name: `👤 ${userId.substring(0, 20)}`
        });
        
        if (!topic.ok) return null;
        
        const topicId = topic.result.message_thread_id;
        userTopics.set(ip, topicId);
        topicToIp.set(topicId, ip);
        
        const time = new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });
        
        await callTelegram('sendMessage', {
            chat_id: GROUP_CHAT_ID,
            message_thread_id: topicId,
            text: `🔔 **НОВЫЙ ПОЛЬЗОВАТЕЛЬ!**\n\n🆔 ID: ${userId}\n📡 IP: ${ip}\n📍 Регион: ${region || 'не определён'}\n📞 Телефон: ${phone || 'не указан'}\n⏰ Время: ${time}`,
            parse_mode: 'Markdown'
        });
        
        console.log('✅ Топик создан:', topicId);
        return topicId;
    } catch (err) {
        console.error('Ошибка:', err);
        return null;
    }
}

app.get('/', (req, res) => {
    res.json({ status: 'ok', message: 'Proxy работает!' });
});

app.post('/register', async (req, res) => {
    const { userId, ip, phone, region } = req.body;
    console.log('📞 Регистрация:', { userId, ip, phone });
    
    let topicId = userTopics.get(ip);
    if (!topicId) {
        topicId = await createTopic(ip, userId, phone, region);
    }
    res.json({ ok: true });
});

app.post('/send', async (req, res) => {
    const { userId, ip, text, imageBase64 } = req.body;
    console.log('📨 Сообщение от', ip, 'текст:', text?.substring(0, 50));
    
    let topicId = userTopics.get(ip);
    if (!topicId) {
        topicId = await createTopic(ip, userId, null, null);
        if (!topicId) return res.status(500).json({ ok: false });
    }
    
    try {
        if (imageBase64) {
            const matches = imageBase64.match(/^data:image\/(\w+);base64,(.+)$/);
            if (matches) {
                const buffer = Buffer.from(matches[2], 'base64');
                const formData = new FormData();
                formData.append('chat_id', GROUP_CHAT_ID);
                formData.append('message_thread_id', topicId);
                formData.append('photo', new Blob([buffer]), 'image.jpg');
                if (text) formData.append('caption', `💬 ${userId}: ${text}`);
                
                await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, {
                    method: 'POST',
                    body: formData
                });
            }
        } else if (text) {
            await callTelegram('sendMessage', {
                chat_id: GROUP_CHAT_ID,
                message_thread_id: topicId,
                text: `💬 ${userId}:\n\n${text}`
            });
        }
        res.json({ ok: true });
    } catch (error) {
        res.status(500).json({ ok: false });
    }
});

app.get('/getUpdates', async (req, res) => {
    const { offset, ip } = req.query;
    try {
        const url = `https://api.telegram.org/bot${BOT_TOKEN}/getUpdates?offset=${offset || 0}&timeout=30`;
        const response = await fetch(url);
        const data = await response.json();
        
        if (data.ok && data.result) {
            const filtered = [];
            for (const update of data.result) {
                const msg = update.message;
                if (msg && msg.chat.id === GROUP_CHAT_ID && msg.is_topic_message) {
                    const topicId = msg.message_thread_id;
                    const userIp = topicToIp.get(topicId);
                    
                    if (msg.from && msg.from.is_bot) continue;
                    if (msg.text && msg.text.includes('НОВЫЙ ПОЛЬЗОВАТЕЛЬ')) continue;
                    
                    if (userIp && (!ip || userIp === ip)) {
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
    } catch (error) {
        res.status(500).json({ ok: false });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Сервер запущен на порту ${PORT}`);
});
