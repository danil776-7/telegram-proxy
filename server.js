const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const app = express();

app.use(cors({ origin: '*', methods: ['GET', 'POST', 'OPTIONS'], allowedHeaders: ['Content-Type'] }));
app.options('*', cors());
app.use(express.json({ limit: '50mb' }));

const BOT_TOKEN = '8743342099:AAGWRLBrNjd8YlkHPSeqOU64J4-0fJdILPg';
const GROUP_CHAT_ID = -1003911846697;
const SITE_URL = 'https://ваш-сайт.ru'; // Замените на ваш URL

// Хранилище логов и пользователей
const users = new Map();
const topicToUser = new Map();
let allMessages = []; // Храним все сообщения для админ-панели
let lastUpdateId = 0;

// Функция для записи логов в файл
function logToFile(type, data) {
    const timestamp = new Date().toISOString();
    const logEntry = {
        timestamp,
        type,
        data
    };
    
    // Читаем существующие логи
    let logs = [];
    if (fs.existsSync('logs.json')) {
        try {
            logs = JSON.parse(fs.readFileSync('logs.json', 'utf8'));
        } catch(e) {}
    }
    
    logs.push(logEntry);
    
    // Сохраняем только последние 10000 логов
    if (logs.length > 10000) logs = logs.slice(-10000);
    
    fs.writeFileSync('logs.json', JSON.stringify(logs, null, 2));
}

// Функция для получения времени в Амстердаме
function getAmsterdamTime(timestamp = null) {
    const date = timestamp ? new Date(timestamp * 1000) : new Date();
    return date.toLocaleString('ru-RU', {
        timeZone: 'Europe/Amsterdam',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
}

// Улучшенное определение страны по IP
async function getCountryByIp(ip) {
    try {
        const response = await fetch(`http://ip-api.com/json/${ip}?fields=status,country,countryCode,city,timezone`);
        const data = await response.json();
        
        if (data.status === 'success') {
            console.log(`📍 IP ${ip} определён как: ${data.country} (${data.countryCode})`);
            return {
                country: data.country,
                countryCode: data.countryCode,
                city: data.city,
                timezone: data.timezone || 'Europe/Amsterdam'
            };
        }
    } catch (error) {
        console.error('Ошибка геолокации:', error);
    }
    
    return { country: 'Нидерланды', countryCode: 'NL', city: 'Амстердам', timezone: 'Europe/Amsterdam' };
}

// ========== АДМИН-ПАНЕЛЬ (HTML) ==========
app.get('/admin', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Админ-панель чата</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
            background: #f5f5f7;
            padding: 20px;
        }
        
        .container {
            max-width: 1400px;
            margin: 0 auto;
        }
        
        /* Шапка */
        .header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 24px 32px;
            border-radius: 20px;
            margin-bottom: 24px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            flex-wrap: wrap;
            gap: 16px;
        }
        
        .header h1 {
            font-size: 24px;
            font-weight: 600;
        }
        
        .stats {
            display: flex;
            gap: 20px;
        }
        
        .stat-card {
            background: rgba(255,255,255,0.2);
            padding: 8px 20px;
            border-radius: 40px;
            text-align: center;
        }
        
        .stat-number {
            font-size: 28px;
            font-weight: 700;
        }
        
        .stat-label {
            font-size: 12px;
            opacity: 0.8;
        }
        
        /* Табы */
        .tabs {
            display: flex;
            gap: 8px;
            margin-bottom: 24px;
            flex-wrap: wrap;
        }
        
        .tab {
            background: white;
            border: none;
            padding: 12px 24px;
            border-radius: 40px;
            cursor: pointer;
            font-size: 14px;
            font-weight: 500;
            transition: all 0.2s;
            color: #666;
        }
        
        .tab.active {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
        }
        
        .tab:hover:not(.active) {
            background: #e0e0e0;
        }
        
        /* Панели */
        .panel {
            display: none;
            background: white;
            border-radius: 20px;
            padding: 24px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.05);
        }
        
        .panel.active {
            display: block;
        }
        
        /* Таблицы */
        .table-wrapper {
            overflow-x: auto;
        }
        
        table {
            width: 100%;
            border-collapse: collapse;
        }
        
        th, td {
            padding: 12px;
            text-align: left;
            border-bottom: 1px solid #eee;
        }
        
        th {
            background: #f8f9fc;
            font-weight: 600;
            color: #333;
        }
        
        tr:hover {
            background: #f8f9fc;
        }
        
        .user-status {
            display: inline-block;
            width: 10px;
            height: 10px;
            border-radius: 50%;
            margin-right: 8px;
        }
        
        .status-online { background: #34c759; }
        .status-offline { background: #8e8e93; }
        
        .message-bubble {
            max-width: 300px;
            padding: 8px 12px;
            border-radius: 16px;
            background: #f2f2f6;
            font-size: 13px;
        }
        
        .message-user {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
        }
        
        .badge {
            display: inline-block;
            padding: 4px 8px;
            border-radius: 12px;
            font-size: 11px;
            font-weight: 500;
        }
        
        .badge-online { background: #34c75920; color: #34c759; }
        .badge-offline { background: #8e8e9320; color: #8e8e93; }
        
        /* Обновление в реальном времени */
        .refresh-info {
            text-align: right;
            font-size: 12px;
            color: #8e8e93;
            margin-bottom: 16px;
        }
        
        /* Модальное окно */
        .modal {
            display: none;
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0,0,0,0.5);
            z-index: 1000;
            align-items: center;
            justify-content: center;
        }
        
        .modal.active {
            display: flex;
        }
        
        .modal-content {
            background: white;
            border-radius: 20px;
            padding: 24px;
            max-width: 500px;
            width: 90%;
            max-height: 80vh;
            overflow-y: auto;
        }
        
        .modal-content h3 {
            margin-bottom: 16px;
        }
        
        .close-modal {
            background: #667eea;
            color: white;
            border: none;
            padding: 10px 20px;
            border-radius: 12px;
            cursor: pointer;
            margin-top: 16px;
        }
        
        @media (max-width: 768px) {
            .header {
                flex-direction: column;
                text-align: center;
            }
            .stats {
                justify-content: center;
            }
            th, td {
                font-size: 12px;
                padding: 8px;
            }
        }
    </style>
</head>
<body>
<div class="container">
    <div class="header">
        <h1>📊 Админ-панель чата поддержки</h1>
        <div class="stats" id="stats">
            <div class="stat-card">
                <div class="stat-number" id="statUsers">0</div>
                <div class="stat-label">Пользователей</div>
            </div>
            <div class="stat-card">
                <div class="stat-number" id="statMessages">0</div>
                <div class="stat-label">Сообщений</div>
            </div>
            <div class="stat-card">
                <div class="stat-number" id="statOnline">0</div>
                <div class="stat-label">Онлайн</div>
            </div>
        </div>
    </div>
    
    <div class="tabs">
        <button class="tab active" data-tab="users">👥 Пользователи</button>
        <button class="tab" data-tab="messages">💬 Сообщения</button>
        <button class="tab" data-tab="logs">📋 Системные логи</button>
    </div>
    
    <div class="panel active" id="panel-users">
        <div class="refresh-info">🔄 Обновляется автоматически каждые 5 секунд</div>
        <div class="table-wrapper">
            <table id="usersTable">
                <thead>
                    <tr><th>ID</th><th>Телефон</th><th>Регион</th><th>IP</th><th>Статус</th><th>Время регистрации</th><th>Действия</th></tr>
                </thead>
                <tbody id="usersList"></tbody>
            </table>
        </div>
    </div>
    
    <div class="panel" id="panel-messages">
        <div class="refresh-info">🔄 Обновляется автоматически каждые 3 секунды</div>
        <div class="table-wrapper">
            <table id="messagesTable">
                <thead>
                    <tr><th>Время</th><th>Пользователь</th><th>Сообщение</th><th>Тип</th></tr>
                </thead>
                <tbody id="messagesList"></tbody>
            </table>
        </div>
    </div>
    
    <div class="panel" id="panel-logs">
        <div class="refresh-info">🔄 Обновляется автоматически каждые 10 секунд</div>
        <div class="table-wrapper">
            <table id="logsTable">
                <thead>
                    <tr><th>Время</th><th>Тип</th><th>Данные</th></tr>
                </thead>
                <tbody id="logsList"></tbody>
            </table>
        </div>
    </div>
</div>

<div class="modal" id="modal">
    <div class="modal-content">
        <h3 id="modalTitle">Детали пользователя</h3>
        <div id="modalBody"></div>
        <button class="close-modal" onclick="closeModal()">Закрыть</button>
    </div>
</div>

<script>
    let currentTab = 'users';
    
    // Переключение табов
    document.querySelectorAll('.tab').forEach(tab => {
        tab.onclick = () => {
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
            tab.classList.add('active');
            const panelId = 'panel-' + tab.dataset.tab;
            document.getElementById(panelId).classList.add('active');
            currentTab = tab.dataset.tab;
        };
    });
    
    // Загрузка данных
    async function loadData() {
        try {
            const response = await fetch('/api/data');
            const data = await response.json();
            
            // Обновляем статистику
            document.getElementById('statUsers').innerText = data.stats.users;
            document.getElementById('statMessages').innerText = data.stats.messages;
            document.getElementById('statOnline').innerText = data.stats.online;
            
            // Обновляем список пользователей
            const usersList = document.getElementById('usersList');
            usersList.innerHTML = data.users.map(user => \`
                <tr>
                    <td><code>\${user.id.substring(0, 16)}...</code></td>
                    <td>\${user.phone || '—'}</td>
                    <td>\${user.region || '—'}</td>
                    <td><code>\${user.ip || '—'}</code></td>
                    <td>
                        <span class="user-status \${user.isOnline ? 'status-online' : 'status-offline'}"></span>
                        <span class="badge \${user.isOnline ? 'badge-online' : 'badge-offline'}">
                            \${user.isOnline ? 'онлайн' : 'офлайн'}
                        </span>
                    </td>
                    <td>\${user.registeredAt || '—'}</td>
                    <td><button onclick="showUserDetails('\${user.id}')">📋</button></td>
                </tr>
            \`).join('');
            
            // Обновляем список сообщений
            const messagesList = document.getElementById('messagesList');
            messagesList.innerHTML = data.messages.slice().reverse().map(msg => \`
                <tr>
                    <td style="white-space: nowrap">\${msg.time}</td>
                    <td><code>\${msg.userId?.substring(0, 12)}...</code></td>
                    <td>
                        <div class="message-bubble \${msg.isUser ? 'message-user' : ''}">
                            \${msg.text || (msg.hasImage ? '📷 Изображение' : '—')}
                        </div>
                    </td>
                    <td><span class="badge">\${msg.isUser ? '👤 Пользователь' : '🤖 Оператор'}</span></td>
                </tr>
            \`).join('');
            
            // Обновляем список логов
            const logsList = document.getElementById('logsList');
            logsList.innerHTML = data.logs.slice().reverse().map(log => \`
                <tr>
                    <td style="white-space: nowrap">\${log.timestamp}</td>
                    <td><span class="badge">\${log.type}</span></td>
                    <td style="word-break: break-word"><code>\${JSON.stringify(log.data, null, 2)}</code></td>
                </tr>
            \`).join('');
            
        } catch (err) {
            console.error('Ошибка загрузки:', err);
        }
    }
    
    function showUserDetails(userId) {
        fetch('/api/user/' + userId)
            .then(r => r.json())
            .then(user => {
                document.getElementById('modalTitle').innerText = '👤 Пользователь';
                document.getElementById('modalBody').innerHTML = \`
                    <p><strong>ID:</strong> <code>\${user.id}</code></p>
                    <p><strong>Телефон:</strong> \${user.phone || '—'}</p>
                    <p><strong>IP:</strong> \${user.ip || '—'}</p>
                    <p><strong>Регион:</strong> \${user.region || '—'}</p>
                    <p><strong>Статус:</strong> \${user.isOnline ? '🟢 Онлайн' : '⚫️ Офлайн'}</p>
                    <p><strong>Время регистрации:</strong> \${user.registeredAt || '—'}</p>
                    <p><strong>Топик ID:</strong> \${user.topicId || '—'}</p>
                \`;
                document.getElementById('modal').classList.add('active');
            });
    }
    
    function closeModal() {
        document.getElementById('modal').classList.remove('active');
    }
    
    // Автообновление
    loadData();
    setInterval(loadData, 5000);
</script>
</body>
</html>
    `);
});

// ========== API для админ-панели ==========
app.get('/api/data', (req, res) => {
    const usersList = Array.from(users.entries()).map(([id, data]) => ({
        id,
        phone: data.phone,
        region: data.region,
        ip: data.ip,
        isOnline: data.isOnline || false,
        registeredAt: data.registeredAt,
        topicId: data.topicId
    }));
    
    // Читаем логи из файла
    let logs = [];
    if (fs.existsSync('logs.json')) {
        try {
            logs = JSON.parse(fs.readFileSync('logs.json', 'utf8'));
        } catch(e) {}
    }
    
    res.json({
        stats: {
            users: users.size,
            messages: allMessages.length,
            online: Array.from(users.values()).filter(u => u.isOnline).length
        },
        users: usersList,
        messages: allMessages.slice(-200),
        logs: logs.slice(-100)
    });
});

app.get('/api/user/:userId', (req, res) => {
    const user = users.get(req.params.userId);
    if (user) {
        res.json({
            id: req.params.userId,
            phone: user.phone,
            region: user.region,
            ip: user.ip,
            isOnline: user.isOnline || false,
            registeredAt: user.registeredAt,
            topicId: user.topicId
        });
    } else {
        res.status(404).json({ error: 'User not found' });
    }
});

// ========== ОСНОВНЫЕ ЭНДПОИНТЫ ==========
app.get('/', (req, res) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.json({ status: 'ok', message: 'Proxy работает!', adminPanel: '/admin' });
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
        
        // Сохраняем пользователя с данными
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
        
        const infoMessage = `🔔 **НОВЫЙ ПОЛЬЗОВАТЕЛЬ**\n\n` +
            `🆔 **ID:** ${userId}\n` +
            `🌍 **IP:** ${ip}\n` +
            `📍 **Регион:** ${finalRegion}\n` +
            `📞 **Телефон:** ${phone}\n` +
            `🕐 **Время регистрации:** ${currentTime}\n` +
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
        
        // Логируем в файл
        logToFile('REGISTER', { userId, ip, phone, region: finalRegion });
        
        console.log(`✅ Пользователь ${userId} зарегистрирован`);
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
    
    // Сохраняем сообщение для админ-панели
    allMessages.push({
        userId,
        text: text || (imageBase64 ? '📷 Изображение' : ''),
        isUser: true,
        hasImage: !!imageBase64,
        time: getAmsterdamTime()
    });
    
    // Ограничиваем количество сообщений
    if (allMessages.length > 1000) allMessages = allMessages.slice(-1000);
    
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
        
        logToFile('MESSAGE', { userId, text: text || 'image', direction: 'out' });
        res.json({ ok: true });
    } catch (err) {
        console.error('Ошибка отправки:', err);
        res.status(500).json({ ok: false });
    }
});

// Обновление статуса
let lastStatus = new Map();
app.post('/updateStatus', async (req, res) => {
    res.header('Access-Control-Allow-Origin', '*');
    const { userId, isOnline, isActive } = req.body;
    
    const user = users.get(userId);
    if (user) {
        const prevStatus = lastStatus.get(userId) || false;
        if (prevStatus !== isOnline) {
            lastStatus.set(userId, isOnline);
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
            
            console.log(`🔄 Статус ${userId}: ${isOnline ? 'онлайн' : 'офлайн'}`);
            logToFile('STATUS', { userId, isOnline });
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
                    
                    if (msg.from && msg.from.is_bot) continue;
                    if (msg.text && (msg.text.includes('НОВЫЙ ПОЛЬЗОВАТЕЛЬ') || 
                                     msg.text.includes('закрепил') ||
                                     msg.text.includes('editForumTopic'))) continue;
                    
                    if (topicUserId && (!userId || topicUserId === userId)) {
                        const messageData = {
                            update_id: update.update_id,
                            message: {
                                text: msg.caption || msg.text || '',
                                from: msg.from?.first_name || 'Поддержка',
                                date: msg.date
                            }
                        };
                        
                        // Сохраняем входящее сообщение для админ-панели
                        allMessages.push({
                            userId: topicUserId,
                            text: msg.caption || msg.text || '',
                            isUser: false,
                            hasImage: false,
                            time: getAmsterdamTime(msg.date)
                        });
                        
                        if (msg.photo && msg.photo.length > 0) {
                            try {
                                const photo = msg.photo[msg.photo.length - 1];
                                const fileResponse = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${photo.file_id}`);
                                const fileData = await fileResponse.json();
                                if (fileData.ok) {
                                    messageData.message.imageUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${fileData.result.file_path}`;
                                    messageData.message.hasImage = true;
                                    
                                    allMessages.push({
                                        userId: topicUserId,
                                        text: '📷 Изображение от оператора',
                                        isUser: false,
                                        hasImage: true,
                                        imageUrl: messageData.message.imageUrl,
                                        time: getAmsterdamTime(msg.date)
                                    });
                                }
                            } catch (err) {}
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
    console.log(`\n🚀 СЕРВЕР ЗАПУЩЕН`);
    console.log(`📡 Порт: ${PORT}`);
    console.log(`🌐 Админ-панель: http://localhost:${PORT}/admin`);
    console.log(`📡 Группа: ${GROUP_CHAT_ID}`);
    console.log(`🤖 Бот: ${BOT_TOKEN.substring(0, 10)}...`);
    console.log(`🌍 Временная зона: Europe/Amsterdam\n`);
});
