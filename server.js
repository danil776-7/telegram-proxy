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
    
    console.log('📨 Получен запрос:', { token: token ? 'есть' : 'нет', chatId, text: text?.substring(0, 50) });
    
    if (!token || !chatId || !text) {
        return res.status(400).json({ 
            ok: false, 
            error: 'Missing parameters: token, chatId, text are required' 
        });
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
        console.log('✅ Ответ Telegram:', data.ok ? 'Успешно' : 'Ошибка');
        res.json(data);
        
    } catch (error) {
        console.error('❌ Ошибка:', error.message);
        res.status(500).json({ ok: false, error: error.message });
    }
});

// Проверка токена бота
app.post('/check', async (req, res) => {
    const { token } = req.body;
    
    if (!token) {
        return res.status(400).json({ ok: false, error: 'Token required' });
    }
    
    try {
        const response = await fetch(`https://api.telegram.org/bot${token}/getMe`);
        const data = await response.json();
        res.json(data);
    } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
    }
});

// Keep-alive (каждые 4 минуты)
setInterval(() => {
    console.log('💓 Сервер активен, время:', new Date().toISOString());
}, 4 * 60 * 1000);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Сервер запущен на порту ${PORT}`);
    console.log(`🌐 Прокси доступен по адресу: https://test-gfg7.onrender.com`);
});
