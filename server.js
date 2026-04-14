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

const users = new Map(); // userId -> { topicId, phone, region }
const topicToUser = new Map(); // topicId -> userId

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
        users.set(userId, { topicId, phone, region });
        topicToUser.set(topicId, userId);
        
        const time = new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Amsterdam' });
        
        await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: GROUP_CHAT_ID,
                message_thread_id: topicId,
                text: `🔔 НОВЫЙ ПОЛЬЗОВАТЕЛЬ!\n\nID: ${userId}\nIP: ${ip}\nРегион: ${region || 'не определён'}\nТелефон: ${phone}\nВремя: ${time}`
            })
        });
        
        console.log('✅ Регистрация успешна, userId:', userId, 'topicId:', topicId);
        res.json({ ok: true, topicId });
        
    } catch (err) {
        console.error('Ошибка:', err);
        res.status(500).json({ ok: false, error: err.message });
    }
});

// ОТПРАВКА СООБЩЕНИЯ (текст + фото)
app.post('/send', async (req, res) => {
    res.header('Access-Control-Allow-Origin', '*');
    const { userId, text, imageBase64 } = req.body;
    console.log('📨 СООБЩЕНИЕ от userId:', userId, 'текст:', text?.substring(0, 50), 'есть фото:', !!imageBase64);
    
    const user = users.get(userId);
    
    if (!user) {
        console.log('❌ Нет регистрации для userId:', userId);
        return res.status(400).json({ ok: false, error: 'Please register first' });
    }
    
    try {
        let result;
        
        if (imageBase64) {
            // Отправка фото
            const matches = imageBase64.match(/^data:image\/(\w+);base64,(.+)$/);
            if (matches) {
                const buffer = Buffer.from(matches[2], 'base64');
                const formData = new FormData();
                formData.append('chat_id', GROUP_CHAT_ID);
                formData.append('message_thread_id', user.topicId);
                formData.append('photo', new Blob([buffer]), 'image.jpg');
                if (text) formData.append('caption', `💬 ${userId}:\n\n${text}`);
                
                const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, {
                    method: 'POST',
                    body: formData
                });
                result = await response.json();
                console.log('📸 Фото отправлено, ok:', result.ok);
            } else {
                throw new Error('Invalid image format');
            }
        } else if (text) {
            // Отправка текста
            result = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: GROUP_CHAT_ID,
                    message_thread_id: user.topicId,
                    text: `💬 ${userId}:\n\n${text}`
                })
            }).then(r => r.json());
            console.log('✅ Сообщение отправлено, ok:', result.ok);
        }
        
        res.json({ ok: result?.ok || true });
        
    } catch (err) {
        console.error('Ошибка:', err);
        res.status(500).json({ ok: false, error: err.message });
    }
});

// ПОЛУЧЕНИЕ ОТВЕТОВ ИЗ TELEGRAM (текст + фото)
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
                    
                    // Пропускаем сообщения от бота и системные
                    if (msg.from && msg.from.is_bot) continue;
                    if (msg.text && msg.text.includes('НОВЫЙ ПОЛЬЗОВАТЕЛЬ')) continue;
                    
                    // Фильтруем по userId
                    if (topicUserId && (!userId || topicUserId === userId)) {
                        const messageData = {
                            update_id: update.update_id,
                            message: {
                                text: msg.caption || msg.text || '',
                                from: msg.from?.first_name || 'Поддержка',
                                date: msg.date
                            }
                        };
                        
                        // Обработка фото
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
                    }
                }
            }
            data.result = filtered;
            console.log(`📨 Отправлено ${filtered.length} сообщений для userId:`, userId);
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
});
