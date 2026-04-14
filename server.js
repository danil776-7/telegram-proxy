const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors({ origin: '*', methods: ['GET', 'POST', 'OPTIONS'], allowedHeaders: ['Content-Type'] }));
app.options('*', cors());
app.use(express.json({ limit: '50mb' }));

const BOT_TOKEN = '8743342099:AAGWRLBrNjd8YlkHPSeqOU64J4-0fJdILPg';
const GROUP_CHAT_ID = -1003911846697;
const SITE_URL = 'https://danil776-7.github.io/telegram-proxy/'; 

console.log('🚀 СЕРВЕР ЗАПУЩЕН');
console.log('📡 GROUP_CHAT_ID:', GROUP_CHAT_ID);

const users = new Map();
const topicToUser = new Map();
let lastUpdateId = 0;

// Функция для получения времени в часовом поясе пользователя (используем UTC+3 для Москвы, но лучше по IP)
function getLocalTime(timestamp = null, timezone = 'Europe/Moscow') {
    const date = timestamp ? new Date(timestamp * 1000) : new Date();
    return date.toLocaleString('ru-RU', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
}

// Определение часового пояса по IP
async function getTimezoneByIp(ip) {
    try {
        const response = await fetch(`http://ip-api.com/json/${ip}?fields=status,timezone`);
        const data = await response.json();
        if (data.status === 'success' && data.timezone) {
            return data.timezone;
        }
    } catch (error) {}
    return 'Europe/Amsterdam'; // По умолчанию Амстердам
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
    res.header('Access-Control-Allow-Origin', '*');
    res.json({ status: 'ok', message: 'Proxy работает!' });
});

app.post('/register', async (req, res) => {
    res.header('Access-Control-Allow-Origin', '*');
    console.log('📞 РЕГИСТРАЦИЯ:', req.body);
    const { userId, ip, phone, region } = req.body;
    
    if (!userId || !phone) {
        return res.status(400).json({ ok: false, error: 'userId and phone required' });
    }
    
    try {
        let geo = { country: 'Нидерланды', countryCode: 'NL', city: 'Амстердам', timezone: 'Europe/Amsterdam' };
        if (ip && ip !== '127.0.0.1') {
            geo = await getCountryByIp(ip);
        }
        
        const finalRegion = `${geo.country}${geo.city ? ', ' + geo.city : ''}`;
        const currentTime = getLocalTime(null, geo.timezone);
        
        // Создаём топик с иконкой статуса (🟢 для онлайн)
        const topic = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/createForumTopic`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: GROUP_CHAT_ID,
                name: `🟢 ${SITE_URL.replace('https://', '')}`,
                icon_color: 0x6FCF97
            })
        }).then(r => r.json());
        
        if (!topic.ok) {
            return res.status(500).json({ ok: false, error: topic.description });
        }
        
        const topicId = topic.result.message_thread_id;
        users.set(userId, { topicId, phone, region: finalRegion, ip, timezone: geo.timezone });
        topicToUser.set(topicId, userId);
        
        // ОДНО системное сообщение со всей информацией
        const infoMessage = `🔔 **НОВЫЙ ПОЛЬЗОВАТЕЛЬ**\n\n` +
            `🆔 **ID:** ${userId}\n` +
            `🌍 **IP:** ${ip}\n` +
            `📍 **Регион:** ${finalRegion}\n` +
            `📞 **Телефон:** ${phone}\n` +
            `🕐 **Время:** ${currentTime}\n` +
            `🌐 **Сайт:** ${SITE_URL}`;
        
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
        
        res.json({ ok: true, topicId });
        
    } catch (err) {
        console.error('Ошибка:', err);
        res.status(500).json({ ok: false, error: err.message });
    }
});

app.post('/send', async (req, res) => {
    res.header('Access-Control-Allow-Origin', '*');
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
                if (text) formData.append('caption', `💬 ${userId}:\n\n${text}`);
                
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
                    text: `💬 ${userId}:\n\n${text}`
                })
            });
        }
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ ok: false });
    }
});

// Обновление статуса - меняем название топика (иконка и ссылка сайта)
let lastStatus = new Map();
app.post('/updateStatus', async (req, res) => {
    res.header('Access-Control-Allow-Origin', '*');
    const { userId, isOnline, isActive } = req.body;
    
    const user = users.get(userId);
    if (user) {
        const prevStatus = lastStatus.get(userId) || false;
        // Отправляем обновление ТОЛЬКО если статус изменился
        if (prevStatus !== isOnline) {
            lastStatus.set(userId, isOnline);
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
            console.log(`🔄 Статус пользователя ${userId}: ${isOnline ? 'онлайн' : 'офлайн'}`);
        }
    }
    res.json({ ok: true });
});

app.get('/getUpdates', async (req, res) => {
    res.header('Access-Control-Allow-Origin', '*');
    const { offset, userId } = req.query;
    const currentOffset = parseInt(offset) || lastUpdateId;
    
    try {
        const url = `https://api.telegram.org/bot${BOT_TOKEN}/getUpdates?offset=${currentOffset}&timeout=30`;
        const response = await fetch(url);
        const data = await response.json();
        
        if (data.ok && data.result) {
            const filtered = [];
            
            for (const update of data.result) {
                const msg = update.message;
                if (msg && msg.chat.id === GROUP_CHAT_ID && msg.is_topic_message) {
                    const topicId = msg.message_thread_id;
                    const topicUserId = topicToUser.get(topicId);
                    
                    // Пропускаем сообщения от ботов и системные
                    if (msg.from && msg.from.is_bot) continue;
                    if (msg.text && (msg.text.includes('НОВЫЙ ПОЛЬЗОВАТЕЛЬ') || msg.text.includes('закрепил'))) continue;
                    
                    if (topicUserId && (!userId || topicUserId === userId)) {
                        const messageData = {
                            update_id: update.update_id,
                            message: {
                                text: msg.caption || msg.text || '',
                                from: msg.from?.first_name || 'Поддержка',
                                date: msg.date // Сохраняем оригинальный timestamp из Telegram
                            }
                        };
                        
                        // Обработка фото из Telegram
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
                                console.error('Ошибка получения фото:', err);
                            }
                        }
                        
                        filtered.push(messageData);
                        if (update.update_id + 1 > lastUpdateId) {
                            lastUpdateId = update.update_id + 1;
                        }
                    }
                }
            }
            
            data.result = filtered;
        }
        res.json(data);
    } catch (err) {
        console.error('Ошибка getUpdates:', err);
        res.status(500).json({ ok: false, error: err.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`\n🚀 Сервер на порту ${PORT}\n`);
    console.log(`📡 Группа: ${GROUP_CHAT_ID}`);
    console.log(`🤖 Бот: ${BOT_TOKEN.substring(0, 10)}...`);
});
