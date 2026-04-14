const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors({ origin: '*', methods: ['GET', 'POST', 'OPTIONS'], allowedHeaders: ['Content-Type'] }));
app.options('*', cors());
app.use(express.json({ limit: '50mb' }));

const BOT_TOKEN = '8743342099:AAGWRLBrNjd8YlkHPSeqOU64J4-0fJdILPg';
const GROUP_CHAT_ID = -1003911846697;

console.log('🚀 СЕРВЕР ЗАПУЩЕН');
console.log('📡 GROUP_CHAT_ID:', GROUP_CHAT_ID);

const users = new Map();
const topicToUser = new Map();
let lastProcessedUpdateId = 0;
const processedUpdates = new Set();

// Функция для определения региона по IP
async function getGeoByIp(ip) {
    try {
        const response = await fetch(`http://ip-api.com/json/${ip}?fields=status,country,countryCode,city,region,query`);
        const data = await response.json();
        if (data.status === 'success') {
            return {
                country: data.country,
                countryCode: data.countryCode,
                city: data.city,
                region: data.region,
                ip: data.query
            };
        }
    } catch (error) {
        console.error('Ошибка определения геолокации:', error);
    }
    return { country: 'Неизвестно', countryCode: 'UN', city: '', region: '', ip: ip };
}

app.get('/', (req, res) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.json({ status: 'ok', message: 'Proxy работает!' });
});

// РЕГИСТРАЦИЯ
app.post('/register', async (req, res) => {
    res.header('Access-Control-Allow-Origin', '*');
    console.log('📞 РЕГИСТРАЦИЯ ПОЛУЧЕНА:', req.body);
    const { userId, ip, phone, region } = req.body;
    
    if (!userId || !phone) {
        return res.status(400).json({ ok: false, error: 'userId and phone required' });
    }
    
    try {
        // Определяем геолокацию по IP
        const geo = await getGeoByIp(ip);
        const geoRegion = `${geo.country}${geo.city ? ', ' + geo.city : ''}${geo.region ? ' (' + geo.region + ')' : ''}`;
        const finalRegion = region || geoRegion;
        
        console.log(`📍 IP: ${ip}, Регион: ${finalRegion}, Телефон: ${phone}`);
        
        // Создаём топик
        const topic = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/createForumTopic`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: GROUP_CHAT_ID,
                name: `👤 ${userId.substring(0, 20)}`
            })
        }).then(r => r.json());
        
        if (!topic.ok) {
            console.error('Ошибка создания топика:', topic);
            return res.status(500).json({ ok: false, error: topic.description });
        }
        
        const topicId = topic.result.message_thread_id;
        
        // Сохраняем данные пользователя
        users.set(userId, { 
            topicId, 
            phone, 
            region: finalRegion, 
            ip,
            geo,
            userId
        });
        topicToUser.set(topicId, userId);
        
        const time = new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Amsterdam' });
        
        // ОТПРАВЛЯЕМ ВСЮ ИНФОРМАЦИЮ О ПОЛЬЗОВАТЕЛЕ
        const infoMessage = `🔔 **НОВЫЙ ПОЛЬЗОВАТЕЛЬ!**\n\n` +
            `🆔 **ID:** ${userId}\n` +
            `📡 **IP:** ${ip}\n` +
            `📍 **Регион:** ${finalRegion}\n` +
            `📞 **Телефон:** ${phone}\n` +
            `⏰ **Время:** ${time}`;
        
        const sent = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: GROUP_CHAT_ID,
                message_thread_id: topicId,
                text: infoMessage,
                parse_mode: 'Markdown'
            })
        }).then(r => r.json());
        
        console.log('✅ Сообщение отправлено в Telegram, ok:', sent.ok);
        console.log('✅ Регистрация успешна, userId:', userId, 'topicId:', topicId);
        
        res.json({ ok: true, topicId, region: finalRegion });
        
    } catch (err) {
        console.error('❌ Ошибка:', err);
        res.status(500).json({ ok: false, error: err.message });
    }
});

// ОТПРАВКА СООБЩЕНИЯ
app.post('/send', async (req, res) => {
    res.header('Access-Control-Allow-Origin', '*');
    const { userId, text, imageBase64 } = req.body;
    console.log('📨 Сообщение от userId:', userId, 'текст:', text?.substring(0, 50), 'фото:', !!imageBase64);
    
    const user = users.get(userId);
    if (!user) {
        console.log('❌ Нет регистрации для userId:', userId);
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
                
                const result = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, {
                    method: 'POST',
                    body: formData
                }).then(r => r.json());
                console.log('📸 Фото отправлено, ok:', result.ok);
            }
        } else if (text) {
            const result = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: GROUP_CHAT_ID,
                    message_thread_id: user.topicId,
                    text: `💬 **${userId}:**\n\n${text}`,
                    parse_mode: 'Markdown'
                })
            }).then(r => r.json());
            console.log('✅ Сообщение отправлено, ok:', result.ok);
        }
        res.json({ ok: true });
    } catch (err) {
        console.error('Ошибка:', err);
        res.status(500).json({ ok: false });
    }
});

// ПОЛУЧЕНИЕ ОТВЕТОВ
app.get('/getUpdates', async (req, res) => {
    res.header('Access-Control-Allow-Origin', '*');
    const { offset, userId } = req.query;
    const currentOffset = parseInt(offset) || lastProcessedUpdateId;
    
    try {
        const url = `https://api.telegram.org/bot${BOT_TOKEN}/getUpdates?offset=${currentOffset}&timeout=30`;
        const response = await fetch(url);
        const data = await response.json();
        
        if (data.ok && data.result && data.result.length > 0) {
            const filtered = [];
            
            for (const update of data.result) {
                if (processedUpdates.has(update.update_id)) {
                    continue;
                }
                
                const msg = update.message;
                if (msg && msg.chat.id === GROUP_CHAT_ID && msg.is_topic_message) {
                    const topicId = msg.message_thread_id;
                    const topicUserId = topicToUser.get(topicId);
                    
                    if (msg.from && msg.from.is_bot) continue;
                    if (msg.text && (msg.text.includes('НОВЫЙ ПОЛЬЗОВАТЕЛЬ') || msg.text.includes('закрепил'))) continue;
                    
                    if (topicUserId && (!userId || topicUserId === userId)) {
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
                        processedUpdates.add(update.update_id);
                        lastProcessedUpdateId = Math.max(lastProcessedUpdateId, update.update_id + 1);
                    }
                }
            }
            
            data.result = filtered;
            console.log(`📨 Отправлено ${filtered.length} сообщений`);
        }
        res.json(data);
    } catch (err) {
        console.error('Ошибка getUpdates:', err);
        res.status(500).json({ ok: false });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`\n🚀 Сервер на порту ${PORT}\n`);
});
