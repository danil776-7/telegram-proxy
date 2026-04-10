const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const app = express();

app.use(cors({ origin: '*', methods: ['GET', 'POST', 'OPTIONS'], allowedHeaders: ['Content-Type'] }));
app.options('*', cors());
app.use(express.json({ limit: '50mb' }));

const BOT_TOKEN = '8743342099:AAGWRLBrNjd8YlkHPSeqOU64J4-0fJdILPg';
const GROUP_CHAT_ID = -1003765383331;

const DATA_FILE = path.join(__dirname, 'data.json');

function getMoscowTime() {
    const now = new Date();
    const moscowTime = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Moscow' }));
    return moscowTime;
}

function formatMoscowTime(date) {
    return date.toLocaleString('ru-RU', {
        timeZone: 'Europe/Moscow',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
}

const ipTopics = new Map();
const topicToIp = new Map();
const ipStatus = new Map();

function loadData() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
            console.log('📂 Данные загружены из файла');
            return data;
        }
    } catch (err) {
        console.error('Ошибка загрузки данных:', err);
    }
    return { ipTopics: {}, topicToIp: {}, ipStatus: {} };
}

function saveData() {
    try {
        const data = {
            ipTopics: Object.fromEntries(ipTopics),
            topicToIp: Object.fromEntries(topicToIp),
            ipStatus: Object.fromEntries(ipStatus)
        };
        fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
        console.log('💾 Данные сохранены в файл');
    } catch (err) {
        console.error('Ошибка сохранения данных:', err);
    }
}

const savedData = loadData();
for (const [ip, topicId] of Object.entries(savedData.ipTopics || {})) ipTopics.set(ip, topicId);
for (const [topicId, ip] of Object.entries(savedData.topicToIp || {})) topicToIp.set(parseInt(topicId), ip);
for (const [ip, status] of Object.entries(savedData.ipStatus || {})) ipStatus.set(ip, status);

console.log(`📊 Загружено ${ipTopics.size} связей IP->топик`);

async function callTelegram(method, params) {
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/${method}`;
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params)
    });
    return response.json();
}

async function updateTopicInfo(ip, topicId, site) {
    const status = ipStatus.get(ip);
    if (!status) return;
    const iconEmoji = status.online ? '🟢' : '⚫️';
    const shortSite = site?.replace(/^https?:\/\//, '').replace(/\/$/, '').substring(0, 30) || 'unknown';
    try {
        await callTelegram('editForumTopic', {
            chat_id: GROUP_CHAT_ID,
            message_thread_id: topicId,
            name: `${iconEmoji} ${shortSite}`
        });
    } catch (e) { console.error('Ошибка иконки:', e.message); }
}

async function updatePinnedMessage(ip, topicId) {
    const status = ipStatus.get(ip);
    if (!status) return;
    
    const lastActiveDate = status.lastActive ? new Date(status.lastActive) : getMoscowTime();
    const lastActiveStr = formatMoscowTime(lastActiveDate);
    const phoneStr = status.phone ? `📞 **Телефон:** ${status.phone}\n` : '';
    const siteStr = status.site ? `🌐 **Сайт:** ${status.site}\n` : '';
    const regionStr = status.region ? `📍 **Регион:** ${status.region}\n` : '';
    
    const text = `🧑‍💻 **Пользователь:** ${status.userId}\n${siteStr}📡 **IP:** ${ip}\n${regionStr}${phoneStr}🟢 **Онлайн:** ${status.online ? '✅ Да' : '❌ Нет'}\n⏱ **Последняя активность:** ${lastActiveStr}`;
    
    try {
        if (status.pinnedMessageId) {
            await callTelegram('editMessageText', {
                chat_id: GROUP_CHAT_ID,
                message_thread_id: topicId,
                message_id: status.pinnedMessageId,
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
                status.pinnedMessageId = sent.result.message_id;
                await callTelegram('pinChatMessage', {
                    chat_id: GROUP_CHAT_ID,
                    message_thread_id: topicId,
                    message_id: sent.result.message_id
                });
            }
        }
        ipStatus.set(ip, status);
        saveData();
    } catch (e) { console.error('Ошибка обновления:', e.message); }
}

async function createTopicForIp(ip, site, userId, phone = null, region = null) {
    try {
        const shortSite = site?.replace(/^https?:\/\//, '').replace(/\/$/, '').substring(0, 30) || 'unknown';
        const topic = await callTelegram('createForumTopic', {
            chat_id: GROUP_CHAT_ID,
            name: `🟡 ${shortSite}`
        });
        if (!topic.ok) throw new Error('Не удалось создать топик');
        
        const topicId = topic.result.message_thread_id;
        ipTopics.set(ip, topicId);
        topicToIp.set(topicId, ip);
        ipStatus.set(ip, {
            online: true,
            lastActive: Date.now(),
            site,
            userId,
            phone,
            region,
            pinnedMessageId: null
        });
        
        saveData();
        
        const regionText = region ? `📍 **Регион:** ${region}\n` : '';
        const currentTime = formatMoscowTime(getMoscowTime());
        
        await callTelegram('sendMessage', {
            chat_id: GROUP_CHAT_ID,
            message_thread_id: topicId,
            text: `🔔 **Новый пользователь!**\n\n🆔 **ID:** ${userId}\n🌐 **Сайт:** ${site}\n📡 **IP:** ${ip}\n${regionText}${phone ? `📞 **Телефон:** ${phone}\n` : ''}⏰ **Время:** ${currentTime}`,
            parse_mode: 'Markdown'
        });
        
        await updatePinnedMessage(ip, topicId);
        await updateTopicInfo(ip, topicId, site);
        return topicId;
    } catch (err) {
        console.error('Ошибка создания топика:', err);
        return null;
    }
}

app.get('/', (req, res) => {
    res.json({ status: 'ok', message: 'Telegram Proxy работает!', topics: ipTopics.size });
});

app.post('/register', async (req, res) => {
    console.log('📞 Регистрация:', req.body);
    const { userId, site, ip, phone, region } = req.body;
    
    if (!ip || !phone) {
        return res.status(400).json({ ok: false, error: 'ip and phone required' });
    }
    
    try {
        let status = ipStatus.get(ip);
        if (!status) {
            status = { online: true, lastActive: Date.now(), site, userId, phone, region, pinnedMessageId: null };
        }
        status.phone = phone;
        status.userId = userId;
        status.site = site;
        if (region) status.region = region;
        ipStatus.set(ip, status);
        saveData();
        
        let topicId = ipTopics.get(ip);
        if (topicId) {
            await updatePinnedMessage(ip, topicId);
            await updateTopicInfo(ip, topicId, site);
        }
        
        console.log('✅ Регистрация успешна');
        res.json({ ok: true });
    } catch (error) {
        console.error('Ошибка регистрации:', error);
        res.status(500).json({ ok: false, error: error.message });
    }
});

app.post('/send', async (req, res) => {
    const { userId, site, ip, text, imageBase64, region } = req.body;
    console.log('📨 Отправка сообщения от:', userId, 'IP:', ip);
    
    if (!ip) return res.status(400).json({ ok: false, error: 'ip required' });
    
    let status = ipStatus.get(ip);
    if (!status) {
        status = { online: true, lastActive: Date.now(), site, userId, phone: null, region, pinnedMessageId: null };
    }
    status.online = true;
    status.lastActive = Date.now();
    status.site = site || status.site;
    status.userId = userId || status.userId;
    if (region) status.region = region;
    ipStatus.set(ip, status);
    saveData();
    
    let topicId = ipTopics.get(ip);
    if (!topicId) {
        console.log(`🆕 Создаём новый топик для IP: ${ip}`);
        topicId = await createTopicForIp(ip, site, userId, status.phone, status.region);
        if (!topicId) return res.status(500).json({ ok: false, error: 'Не удалось создать топик' });
    } else {
        console.log(`📌 Используем существующий топик для IP: ${ip}`);
        await updatePinnedMessage(ip, topicId);
        await updateTopicInfo(ip, topicId, site);
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
                console.log('✅ Фото отправлено:', data.ok);
                res.json(data);
            } else {
                throw new Error('Invalid image format');
            }
        } else if (text) {
            const data = await callTelegram('sendMessage', {
                chat_id: GROUP_CHAT_ID,
                message_thread_id: topicId,
                text: `💬 **${userId}:**\n\n${text}`,
                parse_mode: 'Markdown'
            });
            console.log('✅ Сообщение отправлено:', data.ok);
            res.json(data);
        } else {
            res.status(400).json({ ok: false, error: 'No text or image' });
        }
    } catch (error) {
        console.error('Ошибка отправки:', error);
        res.status(500).json({ ok: false, error: error.message });
    }
});

app.post('/updateStatus', async (req, res) => {
    const { userId, site, ip, isOnline, isActive } = req.body;
    if (!ip) return res.status(400).json({ ok: false, error: 'ip required' });
    
    let status = ipStatus.get(ip);
    if (!status) {
        status = { online: isOnline !== false, lastActive: Date.now(), site, userId, phone: null, pinnedMessageId: null };
    }
    const wasOnline = status.online;
    status.online = isOnline !== false;
    if (isActive) status.lastActive = Date.now();
    status.site = site || status.site;
    status.userId = userId || status.userId;
    ipStatus.set(ip, status);
    saveData();
    
    const topicId = ipTopics.get(ip);
    if (topicId) {
        if (wasOnline !== status.online) {
            await updatePinnedMessage(ip, topicId);
            await updateTopicInfo(ip, topicId, site);
        } else if (isActive) {
            await updatePinnedMessage(ip, topicId);
        }
    }
    res.json({ ok: true });
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
                    let userIp = null;
                    for (let [ip, tid] of ipTopics.entries()) {
                        if (tid === topicId) {
                            userIp = ip;
                            break;
                        }
                    }
                    
                    if (msg.from && msg.from.is_bot) continue;
                    if (msg.text && msg.text.includes('changed the topic name')) continue;
                    
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
                            } catch (err) {
                                console.error('Ошибка фото:', err);
                            }
                        }
                        
                        filtered.push(messageData);
                    }
                }
            }
            data.result = filtered;
        }
        res.json(data);
    } catch (error) {
        console.error('Ошибка getUpdates:', error);
        res.status(500).json({ ok: false, error: error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`\n🚀 Сервер запущен на порту ${PORT}`);
    console.log(`📡 GROUP_CHAT_ID: ${GROUP_CHAT_ID}`);
    console.log(`📂 Данные сохраняются в файл: ${DATA_FILE}\n`);
});
