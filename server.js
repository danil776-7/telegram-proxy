const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const TelegramBot = require('node-telegram-bot-api');

const BOT_TOKEN = process.env.BOT_TOKEN;
const GROUP_CHAT_ID = parseInt(process.env.GROUP_CHAT_ID);

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

const userTopics = new Map();
const userStatus = new Map();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" }
});

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '10mb' }));

// ===== helpers =====

function isValidPhone(phone) {
    return /^\+?[1-9]\d{7,14}$/.test(phone);
}

function updateStatus(userId, isOnline, isTabOpen = false) {
    const now = Date.now();
    userStatus.set(userId, {
        online: isOnline,
        tabOpen: isTabOpen,
        lastActive: now
    });
}

async function sendSystemInfo(userId, site, geo, phone, timezone) {
    const topicId = userTopics.get(userId);

    const time = new Date().toLocaleString('ru-RU', { timeZone: timezone });

    const text = `
🧑‍💻 ID: ${userId}
📞 Телефон: ${phone || 'не указан'}

🌍 ${geo?.country_name || ''}
🏙 ${geo?.city || ''}
🌐 ${site}

🕒 ${time}
    `.trim();

    const msg = await bot.sendMessage(GROUP_CHAT_ID, text, {
        message_thread_id: topicId
    });

    await bot.pinChatMessage(GROUP_CHAT_ID, msg.message_id, {
        message_thread_id: topicId
    });
}

async function createUserTopic(userId, site, geo, phone, timezone) {
    const topic = await bot.createForumTopic(GROUP_CHAT_ID, `🆕 ${userId}`);
    const topicId = topic.message_thread_id;

    userTopics.set(userId, topicId);

    await sendSystemInfo(userId, site, geo, phone, timezone);

    return topicId;
}

// ===== TG → сайт =====
bot.on('message', async (msg) => {
    if (msg.chat.id !== GROUP_CHAT_ID || !msg.is_topic_message) return;

    const topicId = msg.message_thread_id;

    let userId = null;
    for (let [uid, tid] of userTopics.entries()) {
        if (tid === topicId) userId = uid;
    }
    if (!userId) return;

    if (msg.photo) {
        const fileId = msg.photo[msg.photo.length - 1].file_id;
        const file = await bot.getFile(fileId);
        const url = `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`;

        io.to(userId).emit('tg_message', {
            isImage: true,
            imageUrl: url
        });
    } else {
        io.to(userId).emit('tg_message', {
            text: msg.text
        });
    }
});

// ===== SOCKET =====
io.on('connection', (socket) => {
    const { userId, site, timezone } = socket.handshake.query;

    socket.join(userId);

    socket.on('user_message', async (data) => {
        const { text, imageBase64, geo, phone } = data;

        if (!isValidPhone(phone)) {
            socket.emit('error', 'Неверный номер телефона');
            return;
        }

        let topicId = userTopics.get(userId);

        if (!topicId) {
            topicId = await createUserTopic(userId, site, geo, phone, timezone);
        }

        try {
            if (imageBase64) {
                const matches = imageBase64.match(/^data:image\/(\w+);base64,(.+)$/);
                const buffer = Buffer.from(matches[2], 'base64');

                await bot.sendPhoto(GROUP_CHAT_ID, buffer, {
                    caption: text || '📷 Фото',
                    message_thread_id: topicId
                });
            } else {
                await bot.sendMessage(GROUP_CHAT_ID, text, {
                    message_thread_id: topicId
                });
            }

        } catch (e) {
            socket.emit('error', 'Ошибка отправки');
        }
    });
});

server.listen(3000, () => {
    console.log('🚀 Server started');
});
