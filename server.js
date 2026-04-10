const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors({ origin: '*', methods: ['GET', 'POST', 'OPTIONS'], allowedHeaders: ['Content-Type'] }));
app.options('*', cors());
app.use(express.json({ limit: '50mb' }));

const BOT_TOKEN = '8743342099:AAGWRLBrNjd8YlkHPSeqOU64J4-0fJdILPg';
const GROUP_CHAT_ID = -1003765383331;

const userTopics = new Map();  // ip -> topicId
const topicToIp = new Map();   // topicId -> ip

async function callTelegram(method, params) {
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/${method}`;
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params)
    });
    return response.json();
}

async function createTopic(ip, userId, phone, region) {
    try {
        console.log('📝 Создаём топик для IP:', ip);
        
        const topic = await callTelegram('createForumTopic', {
            chat_id: GROUP_CHAT_ID,
            name: `👤 ${userId.substring(0, 20)}`
        });
        
        if (!topic.ok) {
            console.error('Ошибка создания топика:', topic);
            return null;
        }
        
        const topicId = topic.result.message_thread_id;
        userTopics.set(ip, topicId);
        topicToIp.set(topicId, ip);
        
        const currentTime = new Date().toLocaleString('ru-RU', {
            timeZone: 'Europe/Moscow',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        });
        
        // Отправляем полную информацию о пользователе
        await callTelegram('sendMessage', {
            chat_id: GROUP_CHAT_ID,
            message_thread_id: topicId,
            text: `🔔 **НОВЫЙ ПОЛЬЗОВАТЕЛЬ!**\n\n🆔 **ID:** ${userId}\n📡 **IP:** ${ip}\n📍 **Регион:** ${region || 'не определён'}\n📞 **Телефон:** ${phone || 'не указан'}\n⏰ **Время:** ${currentTime}`,
            parse_mode: 'Markdown'
        });
        
        console.log('✅ Топик создан:', topicId);
        return topicId;
        
    } catch (err) {
        console.error('Ошибка:', err);
        return null;
    }
}

app.get('/', (req, res) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.json({ status: 'ok', message: 'Telegram Proxy работает!' });
});

app.post('/register', async (req, res) => {
    res.header('Access-Control-Allow-Origin', '*');
    const { userId, site, ip, phone, region } = req.body;
    console.log('📞 Регистрация:', { userId, ip, phone, region });
    
    if (!ip || !phone) {
        return res.status(400).json({ ok: false, error: 'ip and phone required' });
    }
    
    let topicId = userTopics.get(ip);
    if (!topicId) {
        topicId = await createTopic(ip, userId, phone, region);
    }
    
    res.json({ ok: true, topicId });
});

app.post('/send', async (req, res) => {
    res.header('Access-Control-Allow-Origin', '*');
    const { userId, site, ip, text, imageBase64, region } = req.body;
    console.log('📨 Отправка от:', userId, 'IP:', ip, 'текст:', text?.substring(0, 50), 'есть фото:', !!imageBase64);
    
    if (!ip) return res.status(400).json({ ok: false, error: 'ip required' });
    
    let topicId = userTopics.get(ip);
    if (!topicId) {
        topicId = await createTopic(ip, userId, null, region);
        if (!topicId) return res.status(500).json({ ok: false, error: 'Не удалось создать топик' });
    }
    
    try {
        if (imageBase64) {
            // Отправка фото
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
                console.log('✅ Фото отправлено, ok:', data.ok);
                return res.json(data);
            }
        } else if (text) {
            const data = await callTelegram('sendMessage', {
                chat_id: GROUP_CHAT_ID,
                message_thread_id: topicId,
                text: `💬 **${userId}:**\n\n${text}`,
                parse_mode: 'Markdown'
            });
            console.log('✅ Сообщение отправлено, ok:', data.ok);
            return res.json(data);
        }
        res.status(400).json({ ok: false, error: 'No text or image' });
    } catch (error) {
        console.error('Ошибка отправки:', error);
        res.status(500).json({ ok: false, error: error.message });
    }
});

app.post('/updateStatus', async (req, res) => {
    res.header('Access-Control-Allow-Origin', '*');
    const { userId, site, ip, isOnline, isActive } = req.body;
    res.json({ ok: true });
});

app.get('/getUpdates', async (req, res) => {
    res.header('Access-Control-Allow-Origin', '*');
    const { offset, ip } = req.query;
    console.log('📡 Запрос getUpdates, offset:', offset, 'ip:', ip);
    
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
                    const userIp = topicToIp.get(topicId);
                    
                    // Пропускаем сообщения от бота и системные
                    if (msg.from && msg.from.is_bot) continue;
                    if (msg.text && (msg.text.includes('НОВЫЙ ПОЛЬЗОВАТЕЛЬ'))) continue;
                    
                    if (userIp && (!ip || userIp === ip)) {
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
                                    console.log('📸 Фото получено для IP:', userIp);
                                }
                            } catch (err) {
                                console.error('Ошибка получения фото:', err);
                            }
                        }
                        
                        filtered.push(messageData);
                        console.log('📨 Найдено сообщение для IP:', userIp);
                    }
                }
            }
            data.result = filtered;
            console.log(`📨 Отправлено ${filtered.length} сообщений в виджет`);
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
    console.log(`📡 GROUP_CHAT_ID: ${GROUP_CHAT_ID}\n`);
});
