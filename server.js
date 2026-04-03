const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());

// Проверка работы сервера
app.get('/', (req, res) => {
    res.json({ status: 'ok', message: 'Telegram Proxy работает!' });
});

// Отправка сообщения в Telegram
app.post('/send', async (req, res) => {
    const { token, chatId, text } = req.body;
    
    console.log('📨 Отправка:', { chatId, textLength: text?.length });
    
    if (!token || !chatId || !text) {
        return res.status(400).json({ ok: false, error: 'Missing parameters' });
    }
    
    try {
        const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text: text })
        });
        const data = await response.json();
        console.log('✅ Ответ Telegram:', data.ok ? 'Успех' : 'Ошибка');
        res.json(data);
    } catch (error) {
        console.error('❌ Ошибка:', error.message);
        res.status(500).json({ ok: false, error: error.message });
    }
});

// Получение новых сообщений из Telegram
app.get('/getUpdates', async (req, res) => {
    const { token, offset } = req.query;
    
    console.log('📥 Запрос getUpdates, offset:', offset);
    
    if (!token) {
        return res.status(400).json({ ok: false, error: 'Token required' });
    }
    
    try {
        const url = `https://api.telegram.org/bot${token}/getUpdates?offset=${offset || 0}&timeout=10`;
        const response = await fetch(url);
        const data = await response.json();
        console.log('✅ Получено обновлений:', data.result?.length || 0);
        res.json(data);
    } catch (error) {
        console.error('❌ Ошибка:', error.message);
        res.status(500).json({ ok: false, error: error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Сервер запущен на порту ${PORT}`);
    console.log(`📡 Endpoints:`);
    console.log(`   GET  /`);
    console.log(`   POST /send`);
    console.log(`   GET  /getUpdates?token=...&offset=...`);
});
