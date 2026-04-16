const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json({ limit: '50mb' }));

const BOT_TOKEN = '8743342099:AAGWRLBrNjd8YlkHPSeqOU64J4-0fJdILPg';
const GROUP_CHAT_ID = -1003911846697;
const SITE_URL = 'https://danil776-7.github.io';

const users = new Map();
const topicToUser = new Map();
let lastUpdateId = 0;

function getAmsterdamTime(timestamp = null) {
    const date = timestamp ? new Date(timestamp * 1000) : new Date();
    return date.toLocaleString('ru-RU', {
        timeZone: 'Europe/Amsterdam',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
}

app.get('/', (req, res) => {
    res.json({ status: 'ok', message: 'Proxy работает!' });
});

app.post('/register', async (req, res) => {
    console.log('📞 РЕГИСТРАЦИЯ:', req.body);
    const { userId, ip, phone, region } = req.body;
    
    try {
        const topic = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/createForumTopic`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: GROUP_CHAT_ID,
                name: `🟢 ${SITE_URL.replace('https://', '')}`,
                icon_color: 0x6FCF97
            })
        }).then(r => r.json());
        
        const topicId = topic.result.message_thread_id;
        users.set(userId, { topicId, phone, region, ip, isOnline: true });
        topicToUser.set(topicId, userId);
        
        const infoMessage = `🔔 **НОВЫЙ ПОЛЬЗОВАТЕЛЬ!**\n\n` +
            `🆔 **ID:** ${userId}\n` +
            `🌐 **Сайт:** ${SITE_URL}\n` +
            `🌍 **IP:** ${ip}\n` +
            `📍 **Регион:** ${region}\n` +
            `📞 **Телефон:** ${phone}\n` +
            `🕐 **Время:** ${getAmsterdamTime()}\n` +
            `✅ **Статус:** Онлайн`;
        
        await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: GROUP_CHAT_ID,
                message_thread_id: topicId,
                text: infoMessage,
                parse_mode: 'Markdown'
            })
        });
        
        console.log(`✅ Пользователь ${userId} зарегистрирован, статус: онлайн`);
        res.json({ ok: true, topicId });
    } catch (err) {
        console.error('Ошибка:', err);
        res.status(500).json({ ok: false, error: err.message });
    }
});

app.post('/send', async (req, res) => {
    const { userId, text, imageBase64 } = req.body;
    const user = users.get(userId);
    if (!user) return res.status(400).json({ ok: false });
    
    try {
        if (imageBase64) {
            const matches = imageBase64.match(/^data:image\/(\w+);base64,(.+)$/);
            if (matches) {
                const buffer = Buffer.from(matches[2], 'base64');
                const formData = new FormData();
                formData.append('chat_id', GROUP_CHAT_ID);
                formData.append('message_thread_id', user.topicId);
                formData.append('photo', new Blob([buffer]), 'image.jpg');
                if (text) formData.append('caption', `💬 ${userId}:\n\n${text}`);
                await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, { method: 'POST', body: formData });
            }
        } else if (text) {
            await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: GROUP_CHAT_ID,
                    message_thread_id: user.topicId,
                    text: `💬 ${userId}:\n\n${text}`
                })
            });
        }
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ ok: false });
    }
});

// ========== ОБНОВЛЕНИЕ СТАТУСА (ИСПРАВЛЕНО) ==========
let lastStatusUpdate = new Map();

app.post('/updateStatus', async (req, res) => {
    const { userId, isOnline, isActive } = req.body;
    console.log(`📊 ОБНОВЛЕНИЕ СТАТУСА: ${userId} -> ${isOnline ? 'ОНЛАЙН' : 'ОФЛАЙН'}`);
    
    const user = users.get(userId);
    if (!user) {
        console.log(`❌ Пользователь ${userId} не найден`);
        return res.json({ ok: false, error: 'User not found' });
    }
    
    const now = Date.now();
    const lastUpdate = lastStatusUpdate.get(userId) || 0;
    
    // Отправляем обновление, если статус изменился И прошло больше 5 секунд (антиспам)
    if (user.isOnline !== isOnline && (now - lastUpdate) > 5000) {
        lastStatusUpdate.set(userId, now);
        user.isOnline = isOnline;
        
        const icon = isOnline ? '🟢' : '⚫️';
        const newName = `${icon} ${SITE_URL.replace('https://', '').replace('http://', '')}`;
        
        try {
            // Обновляем название топика
            await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/editForumTopic`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: GROUP_CHAT_ID,
                    message_thread_id: user.topicId,
                    name: newName
                })
            });
            console.log(`🔄 Статус изменён: ${isOnline ? '🟢 онлайн' : '⚫️ офлайн'}`);
        } catch (err) {
            console.error('Ошибка обновления топика:', err);
        }
    } else {
        console.log(`⏸️ Статус не изменён (${user.isOnline} -> ${isOnline})`);
    }
    
    res.json({ ok: true });
});

app.get('/getUpdates', async (req, res) => {
    const { offset, userId } = req.query;
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
                    const topicUserId = topicToUser.get(topicId);
                    if (msg.from && msg.from.is_bot) continue;
                    if (msg.text && msg.text.includes('НОВЫЙ')) continue;
                    if (topicUserId && (!userId || topicUserId === userId)) {
                        filtered.push(update);
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

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`\n🚀 СЕРВЕР ЗАПУЩЕН на порту ${PORT}`);
    console.log(`📍 http://localhost:${PORT}`);
    console.log(`📡 Группа: ${GROUP_CHAT_ID}`);
    console.log(`🌐 Сайт: ${SITE_URL}\n`);
});
