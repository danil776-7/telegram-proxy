const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type']
}));

app.options('*', cors());

app.use(express.json({ limit: '10mb' }));

// ========== КОНФИГУРАЦИЯ ==========
const BOT_TOKEN = '8743342099:AAGWRLBrNjd8YlkHPSeqOU64J4-0fJdILPg';
const GROUP_CHAT_ID = -1003765383331;

// Хранилища
const ipTopics = new Map();     // ip -> topicId
const ipStatus = new Map();     // ip -> { online, lastActive, site, userId, pinnedMessageId }

// ========== ФУНКЦИИ ==========
async function callTelegram(method, params) {
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/${method}`;
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params)
    });
    return response.json();
}

// Обновление закреплённого сообщения (только если изменился статус)
async function updatePinnedMessage(ip, topicId, site, userName, force = false) {
    const status = ipStatus.get(ip);
    if (!status) return;
    
    const lastActiveStr = new Date(status.lastActive).toLocaleString('ru-RU');
    
    const text = `
🧑‍💻 **Пользователь:** ${status.userId}
🌐 **Сайт:** ${status.site}
📡 **IP:** ${ip}
🟢 **Онлайн:** ${status.online ? '✅ Да' : '❌ Нет'}
⏱ **Последняя активность:** ${lastActiveStr}
    `;
    
    // Проверяем, нужно ли обновлять (чтобы не спамить)
    if (!force && status.lastPinnedText === text) {
        return; // Текст не изменился, не обновляем
    }
    
    try {
        if (status.pinnedMessageId) {
            // Обновляем существующее закреплённое сообщение
            await callTelegram('editMessageText', {
                chat_id: GROUP_CHAT_ID,
                message_thread_id: topicId,
                message_id: status.pinnedMessageId,
                text: text,
                parse_mode: 'Markdown'
            });
        } else {
            // Создаём новое закреплённое сообщение
            const sent = await callTelegram('sendMessage', {
                chat_id: GROUP_CHAT_ID,
                message_thread_id: topicId,
                text: text,
                parse_mode: 'Markdown'
            });
            
            if (sent.ok) {
                status.pinnedMessageId = sent.result.message_id;
                await callTelegram('pinChatMessage', {
                    chat_id: GROUP_CHAT_ID,
                    message_thread_id: topicId,
                    message_id: sent.result.message_id
                });
            }
        }
        
        status.lastPinnedText = text;
        ipStatus.set(ip, status);
        
    } catch (e) {
        console.error('Ошибка обновления закрепления:', e.message);
    }
}

async function createTopicForIp(ip, site, userId) {
    try {
        console.log(`📝 Создаём топик для IP: ${ip}`);
        
        const topic = await callTelegram('createForumTopic', {
            chat_id: GROUP_CHAT_ID,
            name: `📡 IP: ${ip}`
        });
        
        if (!topic.ok) throw new Error('Не удалось создать топик');
        
        const topicId = topic.result.message_thread_id;
        ipTopics.set(ip, topicId);
        
        // Сохраняем информацию
        ipStatus.set(ip, {
            online: true,
            lastActive: Date.now(),
            site: site,
            userId: userId,
            pinnedMessageId: null,
            lastPinnedText: null
        });
        
        // Отправляем приветственное сообщение (только один раз)
        await callTelegram('sendMessage', {
            chat_id: GROUP_CHAT_ID,
            message_thread_id: topicId,
            text: `🔔 **Новый пользователь!**\n\n📡 **IP:** ${ip}\n🆔 **User ID:** ${userId}\n🌐 **Сайт:** ${site}\n⏰ **Время:** ${new Date().toLocaleString('ru-RU')}`,
            parse_mode: 'Markdown'
        });
        
        // Создаём закреплённое сообщение
        await updatePinnedMessage(ip, topicId, site, userId, true);
        
        console.log(`✅ Топик для IP ${ip} создан: ${topicId}`);
        return topicId;
        
    } catch (err) {
        console.error('❌ Ошибка создания топика:', err);
        return null;
    }
}

// ========== API ENDPOINTS ==========

app.get('/', (req, res) => {
    res.json({ status: 'ok', message: 'Telegram Proxy работает! Сортировка по IP' });
});

// Отправка сообщения
app.post('/send', async (req, res) => {
    const { userId, site, ip, text, imageBase64 } = req.body;
    
    console.log(`📨 Получено сообщение от IP: ${ip}, User: ${userId}`);
    
    if (!ip) {
        return res.status(400).json({ ok: false, error: 'ip required' });
    }
    
    // Обновляем статус
    let status = ipStatus.get(ip);
    if (!status) {
        status = {
            online: true,
            lastActive: Date.now(),
            site: site,
            userId: userId,
            pinnedMessageId: null,
            lastPinnedText: null
        };
    }
    
    status.online = true;
    status.lastActive = Date.now();
    status.site = site || status.site;
    status.userId = userId || status.userId;
    ipStatus.set(ip, status);
    
    // Получаем или создаём топик
    let topicId = ipTopics.get(ip);
    if (!topicId) {
        topicId = await createTopicForIp(ip, site, userId);
        if (!topicId) {
            return res.status(500).json({ ok: false, error: 'Не удалось создать топик' });
        }
    } else {
        // Только обновляем статус (без создания нового сообщения)
        await updatePinnedMessage(ip, topicId, site, userId);
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
                res.json(data);
            }
        } else if (text) {
            const data = await callTelegram('sendMessage', {
                chat_id: GROUP_CHAT_ID,
                message_thread_id: topicId,
                text: `💬 **${userId}:**\n\n${text}`,
                parse_mode: 'Markdown'
            });
            res.json(data);
        } else {
            res.status(400).json({ ok: false, error: 'No text or image' });
        }
    } catch (error) {
        console.error('Ошибка:', error);
        res.status(500).json({ ok: false, error: error.message });
    }
});

// Обновление статуса активности
app.post('/updateStatus', async (req, res) => {
    const { userId, site, ip, isOnline, isActive } = req.body;
    
    if (!ip) {
        return res.status(400).json({ ok: false, error: 'ip required' });
    }
    
    let status = ipStatus.get(ip);
    if (!status) {
        status = {
            online: isOnline !== false,
            lastActive: Date.now(),
            site: site,
            userId: userId,
            pinnedMessageId: null,
            lastPinnedText: null
        };
    }
    
    const wasOnline = status.online;
    status.online = isOnline !== false;
    if (isActive) status.lastActive = Date.now();
    status.site = site || status.site;
    status.userId = userId || status.userId;
    ipStatus.set(ip, status);
    
    // Обновляем закреплённое сообщение только если изменился статус онлайн
    const topicId = ipTopics.get(ip);
    if (topicId && wasOnline !== status.online) {
        await updatePinnedMessage(ip, topicId, site, userId);
    }
    
    res.json({ ok: true });
});

// Получение ответов
app.get('/getUpdates', async (req, res) => {
    const { offset } = req.query;
    try {
        const url = `https://api.telegram.org/bot${BOT_TOKEN}/getUpdates?offset=${offset || 0}&timeout=10`;
        const response = await fetch(url);
        const data = await response.json();
        
        if (data.ok && data.result) {
            const filtered = [];
            for (const update of data.result) {
                const msg = update.message;
                if (msg && msg.chat.id === GROUP_CHAT_ID && msg.is_topic_message) {
                    let userIp = null;
                    for (let [ip, tid] of ipTopics.entries()) {
                        if (tid === msg.message_thread_id) {
                            userIp = ip;
                            break;
                        }
                    }
                    if (userIp) {
                        filtered.push({
                            update_id: update.update_id,
                            message: {
                                text: msg.text,
                                ip: userIp
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`\n🚀 Сервер запущен на порту ${PORT}`);
    console.log(`📡 Сортировка по IP адресу (без спама)`);
    console.log(`📡 GROUP_CHAT_ID: ${GROUP_CHAT_ID}\n`);
});
