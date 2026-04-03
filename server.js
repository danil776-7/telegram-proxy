const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());

// Корневой путь - проверка работы
app.get('/', (req, res) => {
    res.json({ status: 'ok', message: 'Telegram Proxy работает!' });
});

// Универсальный прокси для Telegram API
app.all('/bot:token/:method', async (req, res) => {
    const { token, method } = req.params;
    const url = `https://api.telegram.org/bot${token}/${method}`;
    
    console.log(`📤 Запрос к: ${url}`);
    
    try {
        let response;
        
        if (req.method === 'GET') {
            // Для GET запросов с query параметрами
            const queryParams = new URLSearchParams(req.query).toString();
            const fullUrl = queryParams ? `${url}?${queryParams}` : url;
            response = await fetch(fullUrl);
        } else {
            // Для POST запросов
            response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(req.body)
            });
        }
        
        const data = await response.json();
        console.log(`✅ Ответ:`, data.ok ? 'OK' : 'ERROR');
        res.json(data);
        
    } catch (error) {
        console.error(`❌ Ошибка:`, error.message);
        res.status(500).json({ ok: false, error: error.message });
    }
});

// Поддержка старого формата (для совместимости)
app.all('/api/bot:token/:method', async (req, res) => {
    const { token, method } = req.params;
    const url = `https://api.telegram.org/bot${token}/${method}`;
    
    try {
        let response;
        
        if (req.method === 'GET') {
            const queryParams = new URLSearchParams(req.query).toString();
            const fullUrl = queryParams ? `${url}?${queryParams}` : url;
            response = await fetch(fullUrl);
        } else {
            response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(req.body)
            });
        }
        
        const data = await response.json();
        res.json(data);
    } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✅ Прокси-сервер запущен на порту ${PORT}`);
    console.log(`🌐 Используй: /bot{TOKEN}/sendMessage`);
});
