const express = require('express');
const cors = require('cors');
const http = require('http');
const https = require('https');
const WebSocket = require('ws');
const app = express();

app.use(cors());
app.use(express.json({ limit: '50mb' }));

const BOT_TOKEN = '8743342099:AAGWRLBrNjd8YlkHPSeqOU64J4-0fJdILPg';
const GROUP_CHAT_ID = -1003911846697;
const SITE_URL = 'https://danil776-7.github.io';

const users = new Map();
const topicToUser = new Map();
const wsClients = new Map();
let lastUpdateId = 0;

const lastStatusUpdate = new Map();
const lastSentStatus = new Map();

// Кэш для изображений
const imageCache = new Map();

const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/ws' });

// WebSocket соединения
wss.on('connection', (ws, req) => {
    console.log(' Новое WebSocket соединение');
    let userId = null;
    
    ws.on('message', async (data) => {
        try {
            const message = JSON.parse(data.toString());
            if (message.type === 'register') {
                userId = message.userId;
                wsClients.set(userId, ws);
                console.log(` WebSocket зарегистрирован для ${userId}`);
                ws.send(JSON.stringify({ type: 'registered', ok: true }));
            }
        } catch (err) {
            console.error('WebSocket ошибка:', err);
        }
    });
    
    ws.on('close', () => {
        if (userId) {
            console.log(`🔌 WebSocket отключен для ${userId}`);
            wsClients.delete(userId);
        }
    });
});

function sendViaWebSocket(userId, message) {
    const ws = wsClients.get(userId);
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message));
        return true;
    }
    return false;
}

// ПРОКСИ ДЛЯ ИЗОБРАЖЕНИЙ (решает проблему с авторизацией)
app.get('/image/:fileId', async (req, res) => {
    const { fileId } = req.params;
    
    // Проверяем кэш
    if (imageCache.has(fileId)) {
        const cached = imageCache.get(fileId);
        res.setHeader('Content-Type', cached.contentType);
        res.setHeader('Cache-Control', 'public, max-age=86400');
        return res.send(cached.data);
    }
    
    try {
        // Получаем путь к файлу
        const fileResponse = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${fileId}`);
        const fileData = await fileResponse.json();
        
        if (!fileData.ok) {
            return res.status(404).json({ error: 'File not found' });
        }
        
        const filePath = fileData.result.file_path;
        const imageUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`;
        
        // Скачиваем изображение
        const response = await fetch(imageUrl);
        const buffer = await response.arrayBuffer();
        const contentType = response.headers.get('content-type') || 'image/jpeg';
        
        // Сохраняем в кэш
        imageCache.set(fileId, {
            data: Buffer.from(buffer),
            contentType: contentType
        });
        
        // Очищаем кэш если слишком большой (оставляем последние 100)
        if (imageCache.size > 100) {
            const firstKey = imageCache.keys().next().value;
            imageCache.delete(firstKey);
        }
        
        res.setHeader('Content-Type', contentType);
        res.setHeader('Cache-Control', 'public, max-age=86400');
        res.send(Buffer.from(buffer));
        
    } catch (err) {
        console.error('Ошибка прокси изображения:', err);
        res.status(500).json({ error: 'Failed to load image' });
    }
});

function getAmsterdamTime(timestamp = null) {
    const date = timestamp ? new Date(timestamp * 1000) : new Date();
    return date.toLocaleString('ru-RU', {
        timeZone: 'Europe/Amsterdam',
        year: '2-digit',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
}

async function getCountryByIp(ip) {
    try {
        const response = await fetch(`http://ip-api.com/json/${ip}?fields=status,country,countryCode,city,timezone`);
        const data = await response.json();
        if (data.status === 'success') {
            return {
                country: data.country,
                countryCode: data.countryCode,
                city: data.city,
                timezone: data.timezone || 'Europe/Amsterdam'
            };
        }
    } catch (error) {}
    return { country: 'Нидерланды', countryCode: 'NL', city: 'Амстердам', timezone: 'Europe/Amsterdam' };
}

app.get('/', (req, res) => {
    res.json({ status: 'ok', message: 'Proxy работает с WebSocket!', websocket: 'wss://telegram-proxy-wyqq.onrender.com/ws' });
});

// РЕГИСТРАЦИЯ
app.post('/register', async (req, res) => {
    console.log('📞 РЕГИСТРАЦИЯ:', req.body);
    const { userId, ip, phone, region } = req.body;
    
    if (!userId || !phone) {
        return res.status(400).json({ ok: false, error: 'userId and phone required' });
    }
    
    try {
        let geo = { country: 'Нидерланды', countryCode: 'NL', city: 'Амстердам', timezone: 'Europe/Amsterdam' };
        if (ip && ip !== '127.0.0.1' && ip !== '::1') {
            geo = await getCountryByIp(ip);
        }
        
        const finalRegion = `${geo.country}${geo.city ? ', ' + geo.city : ''}`;
        const currentTime = getAmsterdamTime();
        
        const topic = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/createForumTopic`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: GROUP_CHAT_ID,
                name: `🟢 ${SITE_URL.replace('https://', '').replace('http://', '')}`,
                icon_color: 0x6FCF97
            })
        }).then(r => r.json());
        
        if (!topic.ok) {
            return res.status(500).json({ ok: false, error: topic.description });
        }
        
        const topicId = topic.result.message_thread_id;
        
        const infoMessage = `🔔 **НОВЫЙ ПОЛЬЗОВАТЕЛЬ!**\n\n` +
            `🆔 **ID:** ${userId}\n` +
            `🌐 **Сайт:** ${SITE_URL}\n` +
            `🌍 **IP:** ${ip}\n` +
            `📍 **Регион:** ${finalRegion}\n` +
            `📞 **Телефон:** ${phone}\n` +
            `🕐 **Время:** ${currentTime}`;
        
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
        
        users.set(userId, { 
            topicId, 
            phone, 
            region: finalRegion, 
            ip, 
            timezone: geo.timezone,
            registeredAt: currentTime,
            isOnline: true
        });
        topicToUser.set(topicId, userId);
        lastSentStatus.set(userId, true);
        
        console.log(`✅ Пользователь ${userId} зарегистрирован`);
        res.json({ ok: true, topicId });
        
    } catch (err) {
        console.error('Ошибка:', err);
        res.status(500).json({ ok: false, error: err.message });
    }
});

// ОТПРАВКА СООБЩЕНИЯ
app.post('/send', async (req, res) => {
    const { userId, text, imageBase64 } = req.body;
    console.log('📨 Сообщение от:', userId);
    
    const user = users.get(userId);
    if (!user) {
        return res.status(400).json({ ok: false, error: 'Please register first' });
    }
    
    try {
        if (imageBase64) {
            const matches = imageBase64.match(/^data:image\/(\w+);base64,(.+)$/);
            if (matches) {
                const buffer = Buffer.from(matches[2], 'base64');
                const formData = new FormData();
                formData.append('chat_id', GROUP_CHAT_ID);
                formData.append('message_thread_id', user.topicId);
                formData.append('photo', new Blob([buffer]), 'image.jpg');
                if (text) formData.append('caption', `💬 **${userId}:**\n\n${text}`);
                
                await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, {
                    method: 'POST',
                    body: formData
                });
            }
        } else if (text) {
            await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: GROUP_CHAT_ID,
                    message_thread_id: user.topicId,
                    text: `💬 **${userId}:**\n\n${text}`,
                    parse_mode: 'Markdown'
                })
            });
        }
        res.json({ ok: true });
    } catch (err) {
        console.error('Ошибка отправки:', err);
        res.status(500).json({ ok: false });
    }
});

// ОБНОВЛЕНИЕ СТАТУСА
app.post('/updateStatus', async (req, res) => {
    const { userId, isOnline, isActive, heartbeat } = req.body;
    
    const user = users.get(userId);
    if (!user) {
        return res.json({ ok: false });
    }
    
    const now = Date.now();
    const lastUpdate = lastStatusUpdate.get(userId) || 0;
    const lastSent = lastSentStatus.get(userId);
    
    if (heartbeat) {
        return res.json({ ok: true });
    }
    
    if (lastSent !== isOnline && (now - lastUpdate) > 10000) {
        lastStatusUpdate.set(userId, now);
        lastSentStatus.set(userId, isOnline);
        user.isOnline = isOnline;
        
        const icon = isOnline ? '🟢' : '⚫️';
        const newName = `${icon} ${SITE_URL.replace('https://', '').replace('http://', '')}`;
        
        await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/editForumTopic`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: GROUP_CHAT_ID,
                message_thread_id: user.topicId,
                name: newName
            })
        }).catch(() => {});
        
        console.log(`🔄 Статус ${userId}: ${isOnline ? 'ОНЛАЙН' : 'ОФЛАЙН'}`);
    }
    res.json({ ok: true });
});

// ПОЛУЧЕНИЕ ОБНОВЛЕНИЙ
app.get('/getUpdates', async (req, res) => {
    const { offset, userId } = req.query;
    const currentOffset = parseInt(offset) || lastUpdateId;
    
    try {
        const url = `https://api.telegram.org/bot${BOT_TOKEN}/getUpdates?offset=${currentOffset}&timeout=5`;
        const response = await fetch(url);
        const data = await response.json();
        
        if (!data.ok) {
            return res.json({ ok: false, error: data.description });
        }
        
        const filtered = [];
        const proxyUrl = `${req.protocol}://${req.get('host')}`;
        
        for (const update of data.result) {
            const msg = update.message;
            if (msg && msg.chat.id === GROUP_CHAT_ID && msg.is_topic_message) {
                const topicId = msg.message_thread_id;
                const topicUserId = topicToUser.get(topicId);
                
                if (msg.from && msg.from.is_bot) continue;
                if (msg.text && msg.text.includes('НОВЫЙ ПОЛЬЗОВАТЕЛЬ')) continue;
                
                if (topicUserId && (!userId || topicUserId === userId)) {
                    const messageData = {
                        update_id: update.update_id,
                        message: {
                            text: msg.caption || msg.text || '',
                            from: msg.from?.first_name || 'Поддержка',
                            date: msg.date
                        }
                    };
                    
                    // Обработка фото - используем прокси сервера
                    if (msg.photo && msg.photo.length > 0) {
                        try {
                            const photo = msg.photo[msg.photo.length - 1];
                            messageData.message.imageUrl = `${proxyUrl}/image/${photo.file_id}`;
                            messageData.message.hasImage = true;
                        } catch (err) {}
                    }
                    
                    filtered.push(messageData);
                    if (update.update_id + 1 > lastUpdateId) {
                        lastUpdateId = update.update_id + 1;
                    }
                    
                    // Также отправляем через WebSocket
                    sendViaWebSocket(topicUserId, {
                        type: 'message',
                        text: msg.caption || msg.text || '',
                        isImage: !!msg.photo,
                        imageUrl: msg.photo ? `${proxyUrl}/image/${msg.photo[msg.photo.length - 1].file_id}` : null,
                        timestamp: msg.date,
                        operatorName: msg.from?.first_name || 'Оператор'
                    });
                }
            }
        }
        
        res.json({ ok: true, result: filtered });
        
    } catch (err) {
        console.error('Ошибка getUpdates:', err);
        res.status(500).json({ ok: false, error: err.message });
    }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`\n🚀 СЕРВЕР ЗАПУЩЕН!`);
    console.log(`📡 Порт: ${PORT}`);
    console.log(`🔌 WebSocket: wss://telegram-proxy-wyqq.onrender.com/ws`);
    console.log(`🖼️  Image proxy: /image/:fileId`);
    console.log(`📡 Группа Telegram: ${GROUP_CHAT_ID}\n`);
});
