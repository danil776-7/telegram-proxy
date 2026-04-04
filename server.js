const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Хранилище: userId -> topicId
const userTopics = new Map();
const userStatus = new Map();

// Конфиг - ТВОИ ДАННЫЕ
const BOT_TOKEN = '8743342099:AAGWRLBrNjd8YlkHPSeqOU64J4-0fJdILPg';
const GROUP_CHAT_ID = -1003765383331; // Твой ID группы!

// Функции для работы с Telegram API
async function callTelegram(method, params) {
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/${method}`;
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params)
    });
    return response.json();
}

// Обновление закреплённого сообщения
async function updatePinnedMessage(userId, topicId, site, ip) {
    const status = userStatus.get(userId) || { online: false, lastActive: Date.now(), ip: ip || 'неизвестен', site: site };
    const lastActiveStr = new Date(status.lastActive).toLocaleString('ru-RU');
    
    const text = `
🧑‍💻 **Пользователь:** \`${userId}\`
🌐 **Сайт:** ${site}
📡 **IP:** ${ip || 'не определён'}
🟢 **Онлайн:** ${status.online ? '✅ Да' : '❌ Нет'}
⏱ **Последняя активность:** ${lastActiveStr}
    `;
    
    try {
        const sent = await callTelegram('sendMessage', {
            chat_id: GROUP_CHAT_ID,
            message_thread_id: topicId,
            text: text,
            parse_mode: 'Markdown'
        });
        
        if (sent.ok) {
            await callTelegram('pinChatMessage', {
                chat_id: GROUP_CHAT_ID,
                message_thread_id: topicId,
                message_id: sent.result.message_id
            });
        }
    } catch (e) {
        console.error('Ошибка обновления закрепления:', e);
    }
}

// Создание нового топика
async function createUserTopic(userId, site, ip) {
    try {
        const topic = await callTelegram('createForumTopic', {
            chat_id: GROUP_CHAT_ID,
            name: `Пользователь: ${userId.substring(0, 20)}`
        });
        
        if (!topic.ok) throw new Error('Не удалось создать топик');
        
        const topicId = topic.result.message_thread_id;
        userTopics.set(userId, topicId);
        
        await callTelegram('sendMessage', {
            chat_id: GROUP_CHAT_ID,
            message_thread_id: topicId,
            text: `🔔 **Новый пользователь!**\n\n🆔 ID: ${userId}\n🌐 Сайт: ${site}\n📡 IP: ${ip || 'не определён'}\n⏰ Время: ${new Date().toLocaleString('ru-RU')}`,
            parse_mode: 'Markdown'
        });
        
        await updatePinnedMessage(userId, topicId, site, ip);
        
        return topicId;
    } catch (err) {
        console.error('Ошибка создания топика:', err);
        return null;
    }
}

// ========== API Endpoints ==========

app.get('/', (req, res) => {
    res.json({ status: 'ok', message: 'Telegram Proxy работает!' });
});

// Отправка сообщения
app.post('/send', async (req, res) => {
    const { userId, site, ip, text, imageBase64 } = req.body;
    
    if (!userId) {
        return res.status(400).json({ ok: false, error: 'userId required' });
    }
    
    const status = userStatus.get(userId) || { online: true, lastActive: Date.now(), ip: ip, site: site };
    status.online = true;
    status.lastActive = Date.now();
    status.ip = ip || status.ip;
    status.site = site || status.site;
    userStatus.set(userId, status);
    
    let topicId = userTopics.get(userId);
    if (!topicId) {
        topicId = await createUserTopic(userId, site, ip);
        if (!topicId) {
            return res.status(500).json({ ok: false, error: 'Не удалось создать топик' });
        }
    }
    
    await updatePinnedMessage(userId, topicId, site, ip);
    
    try {
        if (imageBase64) {
            const matches = imageBase64.match(/^data:image\/(\w+);base64,(.+)$/);
            if (matches) {
                const buffer = Buffer.from(matches[2], 'base64');
                const formData = new FormData();
                formData.append('chat_id', GROUP_CHAT_ID);
                formData.append('message_thread_id', topicId);
                formData.append('photo', new Blob([buffer]), 'image.jpg');
                if (text) formData.append('caption', text);
                
                const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, {
                    method: 'POST',
                    body: formData
                });
                const data = await response.json();
                res.json(data);
            } else {
                throw new Error('Invalid image format');
            }
        } else if (text) {
            const data = await callTelegram('sendMessage', {
                chat_id: GROUP_CHAT_ID,
                message_thread_id: topicId,
                text: `💬 **Сообщение от пользователя:**\n\n${text}`,
                parse_mode: 'Markdown'
            });
            res.json(data);
        } else {
            res.status(400).json({ ok: false, error: 'No text or image' });
        }
    } catch (error) {
        console.error('Ошибка отправки:', error);
        res.status(500).json({ ok: false, error: error.message });
    }
});

// Обновление статуса активности
app.post('/updateStatus', async (req, res) => {
    const { userId, site, ip, isOnline, isActive } = req.body;
    
    if (!userId) {
        return res.status(400).json({ ok: false, error: 'userId required' });
    }
    
    const status = userStatus.get(userId) || { online: false, lastActive: Date.now(), ip: ip, site: site };
    status.online = isOnline !== false;
    if (isActive) status.lastActive = Date.now();
    status.ip = ip || status.ip;
    status.site = site || status.site;
    userStatus.set(userId, status);
    
    const topicId = userTopics.get(userId);
    if (topicId) {
        await updatePinnedMessage(userId, topicId, site, ip);
    }
    
    res.json({ ok: true });
});

// Получение ответов из Telegram
app.get('/getUpdates', async (req, res) => {
    const { offset } = req.query;
    
    try {
        const url = `https://api.telegram.org/bot${BOT_TOKEN}/getUpdates?offset=${offset || 0}&timeout=5`;
        const response = await fetch(url);
        const data = await response.json();
        
        if (data.ok && data.result) {
            const filtered = [];
            for (const update of data.result) {
                const msg = update.message;
                if (msg && msg.chat.id == GROUP_CHAT_ID && msg.is_topic_message) {
                    let userId = null;
                    for (let [uid, tid] of userTopics.entries()) {
                        if (tid === msg.message_thread_id) {
                            userId = uid;
                            break;
                        }
                    }
                    if (userId) {
                        filtered.push({
                            update_id: update.update_id,
                            message: {
                                text: msg.text,
                                userId: userId
                            }
                        });
                    }
                }
            }
            data.result = filtered;
        }
        
        res.json(data);
    } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
    }
});

setInterval(() => {
    console.log('💓 Сервер активен, время:', new Date().toISOString());
}, 4 * 60 * 1000);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✅ Сервер запущен на порту ${PORT}`);
    console.log(`📡 GROUP_CHAT_ID: ${GROUP_CHAT_ID}`);
});
