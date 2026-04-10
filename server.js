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
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params)
    });
    return response.json();
}

app.get('/', (req, res) => {
    res.json({ status: 'ok', message: 'Proxy работает!' });
});

// РЕГИСТРАЦИЯ С НОМЕРОМ ТЕЛЕФОНА
app.post('/register', async (req, res) => {
    console.log('📞 ПОЛУЧЕНА РЕГИСТРАЦИЯ:', JSON.stringify(req.body, null, 2));
    
    const { userId, ip, phone, region } = req.body;
    
    if (!phone) {
        console.log('❌ Нет телефона!');
        return res.status(400).json({ ok: false, error: 'phone required' });
    }
    
    const time = new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });
    
    try {
        // Создаём топик
        const topic = await callTelegram('createForumTopic', {
            chat_id: GROUP_CHAT_ID,
            name: `👤 ${userId.substring(0, 20)}`
        });
        
        if (!topic.ok) {
            console.error('❌ Ошибка создания топика:', topic);
            return res.status(500).json({ ok: false });
        }
        
        const topicId = topic.result.message_thread_id;
        console.log('✅ Топик создан:', topicId);
        
        // Сохраняем данные
        userData.set(ip, { topicId, phone, region, userId });
        
        // Отправляем сообщение с информацией
        const messageText = `🔔 **НОВЫЙ ПОЛЬЗОВАТЕЛЬ!**\n\n🆔 **ID:** ${userId}\n📡 **IP:** ${ip}\n📍 **Регион:** ${region || 'не определён'}\n📞 **Телефон:** ${phone}\n⏰ **Время:** ${time}`;
        
        console.log('📤 Отправка сообщения:', messageText);
        
        const sent = await callTelegram('sendMessage', {
            chat_id: GROUP_CHAT_ID,
            message_thread_id: topicId,
            text: messageText,
            parse_mode: 'Markdown'
        });
        
        console.log('✅ Сообщение отправлено, ok:', sent.ok);
        
        res.json({ ok: true, topicId });
        
    } catch (err) {
        console.error('❌ Ошибка:', err);
        res.status(500).json({ ok: false });
    }
});

// ОТПРАВКА СООБЩЕНИЯ
app.post('/send', async (req, res) => {
    console.log('📨 ПОЛУЧЕНО СООБЩЕНИЕ:', JSON.stringify(req.body, null, 2));
    
    const { userId, ip, text, imageBase64, region } = req.body;
    
    let data = userData.get(ip);
    
    if (!data) {
        console.log('❌ Нет данных для IP:', ip);
        return res.status(400).json({ ok: false, error: 'No topic found' });
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
    } catch (error) {
        console.error('❌ Ошибка:', error);
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
    } catch (error) {
        res.status(500).json({ ok: false });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`\n🚀 Сервер запущен на порту ${PORT}\n`);
});
