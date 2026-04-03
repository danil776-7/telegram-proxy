const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
    res.json({ status: 'ok', message: 'Telegram Proxy работает!' });
});

app.post('/send', async (req, res) => {
    const { token, chatId, text } = req.body;
    
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
        res.json(data);
    } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
    }
});

app.get('/getUpdates', async (req, res) => {
    const { token, offset } = req.query;
    
    if (!token) {
        return res.status(400).json({ ok: false, error: 'Token required' });
    }
    
    try {
        const url = `https://api.telegram.org/bot${token}/getUpdates?offset=${offset || 0}&timeout=5`;
        const response = await fetch(url);
        const data = await response.json();
        res.json(data);
    } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✅ Сервер запущен на порту ${PORT}`);
});
