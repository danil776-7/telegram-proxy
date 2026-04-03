const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());

// Корневой путь
app.get('/', (req, res) => {
    res.json({ status: 'ok', message: 'Telegram Proxy работает!' });
});

// Прокси для всех запросов к Telegram
app.post('/send', async (req, res) => {
    const { token, chatId, text } = req.body;
    
    if (!token || !chatId || !text) {
        return res.status(400).json({ error: 'Missing parameters: token, chatId, text' });
    }
    
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: chatId,
                text: text
            })
        });
        
        const data = await response.json();
        res.json(data);
    } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
    }
});

// Проверка токена бота
app.post('/check', async (req, res) => {
    const { token } = req.body;
    
    try {
        const response = await fetch(`https://api.telegram.org/bot${token}/getMe`);
        const data = await response.json();
        res.json(data);
    } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✅ Прокси-сервер запущен на порту ${PORT}`);
    console.log(`📡 Используй POST /send с параметрами: token, chatId, text`);
});
