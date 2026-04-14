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

// Функция для получения времени в часовом поясе пользователя
function getUserTime(timeZone = 'Europe/Amsterdam') {
    const now = new Date();
    return now.toLocaleString('ru-RU', {
        timeZone: timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
}

// Функция для форматирования времени из Telegram
function formatTelegramTime(timestamp, timeZone = 'Europe/Amsterdam') {
    const date = new Date(timestamp * 1000);
    return date.toLocaleString('ru-RU', {
        timeZone: timeZone,
        hour: '2-digit',
        minute: '2-digit'
    });
}

app.get('/', (req, res) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.json({ status: 'ok', message: 'Proxy работает!' });
});

// РЕГИСТРАЦИЯ
app.post('/register', async (req, res) => {
    res.header('Access-Control-Allow-Origin', '*');
    console.log('📞 РЕГИСТРАЦИЯ:', req.body);
    const { userId, ip, phone, region } = req.body;
    
    if (!userId || !phone) {
        return res.status(400).json({ ok: false, error: 'userId and phone required' });
    }
    
    try {
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
        
        // Сохраняем данные
        users.set(userId, { 
            topicId, 
            phone, 
            region,
            online: true,
            lastActive: Date.now()
        });
        topicToUser.set(topicId, userId);
        
        const currentTime = getUserTime('Europe/Amsterdam');
        
        // Отправляем приветственное сообщение с информацией о пользователе
        await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: GROUP_CHAT_ID,
                message_thread_id: topicId,
                text: `🔔 **НОВЫЙ ПОЛЬЗОВАТЕЛЬ!**\n\n🆔 ID: ${userId}\n📡 IP: ${ip}\n📍 Регион: ${region || 'не определён'}\n📞 Телефон: ${phone}\n⏰ Время: ${currentTime}`,
                parse_mode: 'Markdown'
            })
        });
        
        // Создаём закреплённое сообщение (вся информация в одном месте)
        const pinnedMsg = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: GROUP_CHAT_ID,
                message_thread_id: topicId,
                text: `🧑‍💻 **Пользователь:** ${userId}\n📡 **IP:** ${ip}\n📍 **Регион:** ${region || 'не определён'}\n📞 **Телефон:** ${phone}\n🟢 **Онлайн:** ✅ Да\n⏱ **Последняя активность:** ${currentTime}`,
                parse_mode: 'Markdown'
            })
        }).then(r => r.json());
        
        if (pinnedMsg.ok) {
            await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/pinChatMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: GROUP_CHAT_ID,
                    message_thread_id: topicId,
                    message_id: pinnedMsg.result.message_id
                })
            });
        }
        
        console.log('✅ Регистрация успешна, userId:', userId, 'topicId:', topicId);
        res.json({ ok: true, topicId });
        
    } catch (err) {
        console.error('Ошибка:', err);
        res.status(500).json({ ok: false, error: err.message });
    }
});

// ОТПРАВКА СООБЩЕНИЯ
app.post('/send', async (req, res) => {
    res.header('Access-Control-Allow-Origin', '*');
    const { userId, text, imageBase64 } = req.body;
    console.log('📨 СООБЩЕНИЕ от userId:', userId, 'текст:', text?.substring(0, 50), 'есть фото:', !!imageBase64);
    
    const user = users.get(userId);
    
    if (!user) {
        console.log('❌ Нет регистрации для userId:', userId);
        return res.status(400).json({ ok: false, error: 'Please register first' });
    }
    
    // Обновляем активность
    user.lastActive = Date.now();
    user.online = true;
    users.set(userId, user);
    
    try {
        let result;
        
        if (imageBase64) {
            const matches = imageBase64.match(/^data:image\/(\w+);base64,(.+)$/);
            if (matches) {
                const buffer = Buffer.from(matches[2], 'base64');
                const formData = new FormData();
                formData.append('chat_id', GROUP_CHAT_ID);
                formData.append('message_thread_id', user.topicId);
                formData.append('photo', new Blob([buffer]), 'image.jpg');
                if (text) formData.append('caption', `💬 **${userId}:**\n\n${text}`);
                
                const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, {
                    method: 'POST',
                    body: formData
                });
                result = await response.json();
            }
        } else if (text) {
            result = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: GROUP_CHAT_ID,
                    message_thread_id: user.topicId,
                    text: `💬 **${userId}:**\n\n${text}`,
                    parse_mode: 'Markdown'
                })
            }).then(r => r.json());
        }
        
        console.log('✅ Сообщение отправлено, ok:', result?.ok);
        res.json({ ok: result?.ok || true });
        
    } catch (err) {
        console.error('Ошибка:', err);
        res.status(500).json({ ok: false });
    }
});

// ОБНОВЛЕНИЕ СТАТУСА
app.post('/updateStatus', async (req, res) => {
    res.header('Access-Control-Allow-Origin', '*');
    const { userId, isOnline, isActive } = req.body;
    
    const user = users.get(userId);
    if (user) {
        const wasOnline = user.online;
        user.online = isOnline !== false;
        if (isActive) user.lastActive = Date.now();
        users.set(userId, user);
        
        // Обновляем иконку топика при изменении статуса
        if (wasOnline !== user.online) {
            const icon = user.online ? '🟢' : '⚫️';
            await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/editForumTopic`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: GROUP_CHAT_ID,
                    message_thread_id: user.topicId,
                    name: `${icon} ${user.userId?.substring(0, 20)}`
                })
            }).catch(() => {});
        }
    }
    res.json({ ok: true });
});

// ПОЛУЧЕНИЕ ОТВЕТОВ
app.get('/getUpdates', async (req, res) => {
    res.header('Access-Control-Allow-Origin', '*');
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`\n🚀 Сервер на порту ${PORT}\n`);
});
