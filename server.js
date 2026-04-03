const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const TelegramBot = require('node-telegram-bot-api');

// ========== КОНФИГУРАЦИЯ ==========
const BOT_TOKEN = process.env.BOT_TOKEN || '8743342099:AAGWRLBrNjd8YlkHPSeqOU64J4-0fJdILPg';
const GROUP_CHAT_ID = parseInt(process.env.GROUP_CHAT_ID) || 7545540622;

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// Хранилище: userId -> topicId
const userTopics = new Map();
const userStatus = new Map();

// ========== Express + Socket.IO ==========
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '10mb' }));

// ========== Вспомогательные функции ==========
function updateStatus(userId, isOnline, isTabOpen = false) {
    const now = Date.now();
    const existing = userStatus.get(userId) || {};
    userStatus.set(userId, {
        online: isOnline,
        tabOpen: isTabOpen,
        lastActive: existing.lastActive || now,
    });
    if (isOnline) {
        userStatus.get(userId).lastActive = now;
    }
}

async function updatePinnedMessage(userId, site = 'неизвестный сайт') {
    const topicId = userTopics.get(userId);
    if (!topicId) return;

    const status = userStatus.get(userId) || { online: false, tabOpen: false, lastActive: Date.now() };
    const lastActiveStr = new Date(status.lastActive).toLocaleString('ru-RU');

    const text = `
🧑‍💻 **Пользователь:** \`${userId}\`
🌐 **Сайт:** ${site}
🟢 **Онлайн:** ${status.online ? 'Да' : 'Нет'}
🪟 **Вкладка открыта:** ${status.tabOpen ? 'Да' : 'Нет'}
⏱ **Последняя активность:** ${lastActiveStr}
    `.trim();

    try {
        const sent = await bot.sendMessage(GROUP_CHAT_ID, text, {
            message_thread_id: topicId,
            parse_mode: 'Markdown',
        });
        await bot.pinChatMessage(GROUP_CHAT_ID, sent.message_id, { message_thread_id: topicId });
    } catch (e) {
        console.log('Ошибка при закреплении:', e.message);
    }
}

async function createUserTopic(userId, site) {
    try {
        const topic = await bot.createForumTopic(GROUP_CHAT_ID, `Пользователь: ${userId}`);
        const topicId = topic.message_thread_id;
        userTopics.set(userId, topicId);

        await bot.sendMessage(GROUP_CHAT_ID, `🔔 Новый пользователь!\nID: ${userId}\nСайт: ${site}`, {
            message_thread_id: topicId,
        });

        updateStatus(userId, true, true);
        await updatePinnedMessage(userId, site);

        return topicId;
    } catch (err) {
        console.error('Ошибка создания топика:', err);
        return null;
    }
}

// ========== Telegram Bot: приём сообщений ==========
bot.on('message', async (msg) => {
    if (msg.chat.id !== GROUP_CHAT_ID) return;
    if (!msg.is_topic_message) return;

    const topicId = msg.message_thread_id;
    let userId = null;
    for (let [uid, tid] of userTopics.entries()) {
        if (tid === topicId) {
            userId = uid;
            break;
        }
    }
    if (!userId) return;

    const content = msg.text || (msg.photo ? '📷 Изображение' : '');
    io.to(userId).emit('tg_message', {
        text: content,
        isImage: !!msg.photo,
    });
});

// ========== Socket.IO ==========
io.on('connection', (socket) => {
    const userId = socket.handshake.query.userId || `anon_${Date.now()}_${Math.random()}`;
    const site = socket.handshake.query.site || 'unknown';
    socket.join(userId);

    console.log(`✅ Пользователь подключился: ${userId} с сайта ${site}`);

    updateStatus(userId, true, true);
    if (userTopics.has(userId)) {
        updatePinnedMessage(userId, site);
    }

    socket.on('user_activity', () => {
        updateStatus(userId, true, true);
        if (userTopics.has(userId)) updatePinnedMessage(userId, site);
    });

    socket.on('tab_focus', (isFocused) => {
        const status = userStatus.get(userId) || {};
        status.tabOpen = isFocused;
        status.online = true;
        status.lastActive = Date.now();
        userStatus.set(userId, status);
        if (userTopics.has(userId)) updatePinnedMessage(userId, site);
    });

    socket.on('user_message', async (data) => {
        const { text, imageBase64 } = data;
        let topicId = userTopics.get(userId);

        if (!topicId) {
            topicId = await createUserTopic(userId, site);
            if (!topicId) return;
        }

        try {
            if (imageBase64) {
                const matches = imageBase64.match(/^data:image\/(\w+);base64,(.+)$/);
                if (matches) {
                    const buffer = Buffer.from(matches[2], 'base64');
                    await bot.sendPhoto(GROUP_CHAT_ID, buffer, {
                        caption: text || 'Изображение от пользователя',
                        message_thread_id: topicId,
                    });
                }
            } else if (text) {
                await bot.sendMessage(GROUP_CHAT_ID, text, { message_thread_id: topicId });
            }

            updateStatus(userId, true, true);
            updatePinnedMessage(userId, site);
        } catch (err) {
            console.error('Ошибка отправки в Telegram:', err);
            socket.emit('error', 'Не удалось отправить сообщение');
        }
    });

    socket.on('disconnect', () => {
        updateStatus(userId, false, false);
        if (userTopics.has(userId)) updatePinnedMessage(userId, site);
        console.log(`❌ Пользователь отключился: ${userId}`);
    });
});

// Обновляем статусы каждые 5 минут
setInterval(() => {
    for (let [userId, topicId] of userTopics.entries()) {
        updatePinnedMessage(userId, 'сайт');
    }
}, 5 * 60 * 1000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Сервер запущен на порту ${PORT}`);
    console.log(`🤖 Бот @${(await bot.getMe()).username} готов к работе`);
});