const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors({ origin: '*', methods: ['GET', 'POST', 'OPTIONS'], allowedHeaders: ['Content-Type'] }));
app.options('*', cors());
app.use(express.json({ limit: '50mb' }));

const BOT_TOKEN = '8743342099:AAGWRLBrNjd8YlkHPSeqOU64J4-0fJdILPg';
const GROUP_CHAT_ID = -1003765383331;

console.log('🚀 Сервер запускается...');
console.log('📡 GROUP_CHAT_ID:', GROUP_CHAT_ID);

// Хранилище в памяти
const userTopics = new Map(); // ip -> topicId

async function callTelegram(method, params) {
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/${method}`;
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params)
    });
    return response.json();
}

// Создание топика
async function createTopic(ip, userId, phone, region) {
    try {
        console.log(`📝 Создаём топик для IP: ${ip}`);
        
        const topic = await callTelegram('createForumTopic', {
            chat_id: GROUP_CHAT_ID,
            name: `👤 ${userId.substring(0, 20)}`
        });
        
        if (!topic.ok) {
            console.error('Ошибка создания топика:', topic);
            return null;
        }
        
        const topicId = topic.result.message_thread_id;
        userTopics.set(ip, topicId);
        
        const currentTime = new Date().toLocaleString('ru-RU', {
            timeZone: 'Europe/Moscow',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        });
        
        // Отправляем приветственное сообщение с информацией о пользователе
        await callTelegram('sendMessage', {
            chat_id: GROUP_CHAT_ID,
            message_thread_id: topicId,
            text: `🔔 **НОВЫЙ ПОЛЬЗОВАТЕЛЬ!**\n\n🆔 **ID:** ${userId}\n📡 **IP:** ${ip}\n📍 **Регион:** ${region || 'не определён'}\n📞 **Телефон:** ${phone}\n⏰ **Время:** ${currentTime}`,
            parse_mode: 'Markdown'
        });
        
        // Закрепляем сообщение
        const pinnedMsg = await callTelegram('sendMessage', {
            chat_id: GROUP_CHAT_ID,
            message_thread_id: topicId,
            text: `🟢 **Пользователь онлайн**\n\nIP: ${ip}\nРегион: ${region}\nТелефон: ${phone}\nПоследняя активность: ${currentTime}`,
            parse_mode: 'Markdown'
        });
        
        if (pinnedMsg.ok) {
            await callTelegram('pinChatMessage', {
                chat_id: GROUP_CHAT_ID,
                message_thread_id: topicId,
                message_id: pinnedMsg.result.message_id
            });
        }
        
        console.log(`✅ Топик создан: ${topicId}`);
        return topicId;
        
    } catch (err) {
        console.error('❌ Ошибка создания топика:', err);
        return null;
    }
}

app.get('/', (req, res) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.json({ status: 'ok', message: 'Telegram Proxy работает!' });
});

app.post('/register', async (req, res) => {
    res.header('Access-Control-Allow-Origin', '*');
    const { userId, site, ip, phone, region } = req.body;
    console.log('📞 Регистрация:', { userId, ip, phone, region });
    
    if (!ip || !phone) {
        return res.status(400).json({ ok: false, error: 'ip and phone required' });
    }
    
    // Создаём топик сразу при регистрации
    let topicId = userTopics.get(ip);
    if (!topicId) {
        topicId = await createTopic(ip, userId, phone, region);
    }
    
    res.json({ ok: true, topicId: topicId });
});

app.post('/send', async (req, res) => {
    res.header('Access-Control-Allow-Origin', '*');
    const { userId, site, ip, text, imageBase64, region } = req.body;
    console.log('📨 Отправка сообщения от:', userId, 'IP:', ip);
    
    if (!ip) return res.status(400).json({ ok: false, error: 'ip required' });
    
    // Получаем или создаём топик
    let topicId = userTopics.get(ip);
    if (!topicId) {
        topicId = await createTopic(ip, userId, null, region);
        if (!topicId) return res.status(500).json({ ok: false, error: 'Не удалось создать топик' });
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
                if (text) formData.append('caption', `💬 **${userId}:**\n\n${text}`);
                
                const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, {
                    method: 'POST',
                    body: formData
                });
                const data = await response.json();
                return res.json(data);
            }
        } else if (text) {
            const data = await callTelegram('sendMessage', {
                chat_id: GROUP_CHAT_ID,
                message_thread_id: topicId,
                text: `💬 **${userId}:**\n\n${text}`,
                parse_mode: 'Markdown'
            });
            return res.json(data);
        }
        res.status(400).json({ ok: false, error: 'No text or image' });
    } catch (error) {
        console.error('Ошибка отправки:', error);
        res.status(500).json({ ok: false, error: error.message });
    }
});

app.get('/getUpdates', async (req, res) => {
    res.header('Access-Control-Allow-Origin', '*');
    const { offset } = req.query;
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
    console.log(`\n🚀 Сервер запущен на порту ${PORT}`);
    console.log(`📡 GROUP_CHAT_ID: ${GROUP_CHAT_ID}\n`);
});
