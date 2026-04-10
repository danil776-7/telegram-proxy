const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors({ origin: '*', methods: ['GET', 'POST', 'OPTIONS'], allowedHeaders: ['Content-Type'] }));
app.options('*', cors());
app.use(express.json({ limit: '50mb' }));

const BOT_TOKEN = '8743342099:AAGWRLBrNjd8YlkHPSeqOU64J4-0fJdILPg';
const GROUP_CHAT_ID = -1003765383331;

// Хранилище
const userData = new Map(); // ip -> { topicId, phone, region, userId, pinnedMessageId, online }

// Функция для форматирования времени в Московское время (UTC+3)
function getMoscowTime(timestamp = null) {
    const date = timestamp ? new Date(timestamp * 1000) : new Date();
    return date.toLocaleString('ru-RU', {
        timeZone: 'Europe/Moscow',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
}

async function callTelegram(method, params) {
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/${method}`;
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params)
    });
    return response.json();
}

// Обновление иконки топика (онлайн/офлайн)
async function updateTopicIcon(topicId, isOnline) {
    const icon = isOnline ? '🟢' : '⚫️';
    try {
        await callTelegram('editForumTopic', {
            chat_id: GROUP_CHAT_ID,
            message_thread_id: topicId,
            name: `${icon} ${icon === '🟢' ? 'Online' : 'Offline'}`
        });
    } catch (e) {}
}

// Обновление закреплённого сообщения (ВСЯ ИНФОРМАЦИЯ В 1 СООБЩЕНИИ)
async function updatePinnedMessage(ip, topicId) {
    const data = userData.get(ip);
    if (!data) return;
    
    const lastActiveStr = data.lastActive ? getMoscowTime(data.lastActive) : getMoscowTime();
    const phoneStr = data.phone ? `📞 **Телефон:** ${data.phone}\n` : '';
    const regionStr = data.region ? `📍 **Регион:** ${data.region}\n` : '';
    const onlineStr = data.online ? '✅ Да' : '❌ Нет';
    
    const text = `🧑‍💻 **Пользователь:** ${data.userId}\n📡 **IP:** ${ip}\n${regionStr}${phoneStr}🟢 **Онлайн:** ${onlineStr}\n⏱ **Последняя активность:** ${lastActiveStr}`;
    
    try {
        if (data.pinnedMessageId) {
            await callTelegram('editMessageText', {
                chat_id: GROUP_CHAT_ID,
                message_thread_id: topicId,
                message_id: data.pinnedMessageId,
                text: text,
                parse_mode: 'Markdown'
            });
        } else {
            const sent = await callTelegram('sendMessage', {
                chat_id: GROUP_CHAT_ID,
                message_thread_id: topicId,
                text: text,
                parse_mode: 'Markdown'
            });
            if (sent.ok) {
                data.pinnedMessageId = sent.result.message_id;
                await callTelegram('pinChatMessage', {
                    chat_id: GROUP_CHAT_ID,
                    message_thread_id: topicId,
                    message_id: sent.result.message_id
                });
                userData.set(ip, data);
            }
        }
    } catch (e) {}
}

// Создание топика
async function createTopic(ip, userId, phone, region) {
    try {
        console.log('📝 Создаём топик для IP:', ip);
        
        const topic = await callTelegram('createForumTopic', {
            chat_id: GROUP_CHAT_ID,
            name: `🟡 ${userId.substring(0, 20)}`
        });
        
        if (!topic.ok) return null;
        
        const topicId = topic.result.message_thread_id;
        
        const time = getMoscowTime();
        
        // Приветственное сообщение с информацией
        await callTelegram('sendMessage', {
            chat_id: GROUP_CHAT_ID,
            message_thread_id: topicId,
            text: `🔔 **НОВЫЙ ПОЛЬЗОВАТЕЛЬ!**\n\n🆔 **ID:** ${userId}\n📡 **IP:** ${ip}\n📍 **Регион:** ${region || 'не определён'}\n📞 **Телефон:** ${phone || 'не указан'}\n⏰ **Время:** ${time}`,
            parse_mode: 'Markdown'
        });
        
        userData.set(ip, {
            topicId,
            phone,
            region,
            userId,
            pinnedMessageId: null,
            online: true,
            lastActive: Math.floor(Date.now() / 1000)
        });
        
        await updatePinnedMessage(ip, topicId);
        await updateTopicIcon(topicId, true);
        
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

// Регистрация с номером телефона
app.post('/register', async (req, res) => {
    const { userId, ip, phone, region } = req.body;
    console.log('📞 РЕГИСТРАЦИЯ:', { userId, ip, phone, region });
    
    let data = userData.get(ip);
    
    if (!data) {
        const topicId = await createTopic(ip, userId, phone, region);
        if (!topicId) return res.status(500).json({ ok: false });
    } else {
        data.phone = phone;
        data.region = region;
        userData.set(ip, data);
        await updatePinnedMessage(ip, data.topicId);
        
        await callTelegram('sendMessage', {
            chat_id: GROUP_CHAT_ID,
            message_thread_id: data.topicId,
            text: `📞 **Пользователь указал номер телефона:** ${phone}\n📍 **Регион:** ${region}`,
            parse_mode: 'Markdown'
        });
    }
    
    res.json({ ok: true });
});

// Отправка сообщения
app.post('/send', async (req, res) => {
    const { userId, ip, text, imageBase64, region } = req.body;
    console.log('📨 Сообщение от', ip);
    
    let data = userData.get(ip);
    
    if (!data) {
        const topicId = await createTopic(ip, userId, null, region);
        if (!topicId) return res.status(500).json({ ok: false });
        data = userData.get(ip);
    }
    
    // Обновляем активность
    data.online = true;
    data.lastActive = Math.floor(Date.now() / 1000);
    userData.set(ip, data);
    await updatePinnedMessage(ip, data.topicId);
    await updateTopicIcon(data.topicId, true);
    
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
        res.json({ ok: true });
    } catch (error) {
        res.status(500).json({ ok: false });
    }
});

// Обновление статуса
app.post('/updateStatus', async (req, res) => {
    const { userId, ip, isOnline, isActive } = req.body;
    
    const data = userData.get(ip);
    if (data) {
        const wasOnline = data.online;
        data.online = isOnline !== false;
        if (isActive) data.lastActive = Math.floor(Date.now() / 1000);
        userData.set(ip, data);
        
        if (wasOnline !== data.online) {
            await updatePinnedMessage(ip, data.topicId);
            await updateTopicIcon(data.topicId, data.online);
        } else if (isActive) {
            await updatePinnedMessage(ip, data.topicId);
        }
    }
    res.json({ ok: true });
});

// Получение ответов (текст + фото)
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
                    let userIp = null;
                    for (let [i, val] of userData.entries()) {
                        if (val.topicId === msg.message_thread_id) {
                            userIp = i;
                            break;
                        }
                    }
                    
                    if (msg.from && msg.from.is_bot) continue;
                    if (msg.text && (msg.text.includes('НОВЫЙ ПОЛЬЗОВАТЕЛЬ') || msg.text.includes('указал номер телефона'))) continue;
                    
                    if (userIp && (!ip || userIp === ip)) {
                        const messageData = {
                            update_id: update.update_id,
                            message: {
                                text: msg.caption || msg.text || '',
                                from: msg.from?.first_name || 'Поддержка',
                                date: msg.date
                            }
                        };
                        
                        if (msg.photo && msg.photo.length > 0) {
                            try {
                                const photo = msg.photo[msg.photo.length - 1];
                                const fileResponse = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${photo.file_id}`);
                                const fileData = await fileResponse.json();
                                if (fileData.ok) {
                                    messageData.message.imageUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${fileData.result.file_path}`;
                                    messageData.message.hasImage = true;
                                }
                            } catch (err) {}
                        }
                        
                        filtered.push(messageData);
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
    console.log(`\n🚀 Сервер запущен на порту ${PORT}`);
    console.log(`📡 GROUP_CHAT_ID: ${GROUP_CHAT_ID}\n`);
});
