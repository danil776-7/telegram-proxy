const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());

// Проверка работы сервера
app.get('/', (req, res) => {
    res.json({ status: 'ok', message: 'Telegram Proxy работает!' });
});

// Прокси для Telegram API (POST)
app.post('/api/bot:token/:method', async (req, res) => {
    const { token, method } = req.params;
    const url = `https://api.telegram.org/bot${token}/${method}`;
    
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(req.body)
        });
        const data = await response.json();
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Прокси для Telegram API (GET)
app.get('/api/bot:token/:method', async (req, res) => {
    const { token, method } = req.params;
    const url = `https://api.telegram.org/bot${token}/${method}`;
    
    try {
        const response = await fetch(url);
        const data = await response.json();
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✅ Сервер запущен на порту ${PORT}`);
});
