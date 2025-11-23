import React, { useState, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';
import './App.css';

// Безопасное получение переменных окружения
const supabaseUrl = process.env.REACT_APP_SUPABASE_URL;
const supabaseKey = process.env.REACT_APP_SUPABASE_ANON_KEY;

// Временно отключаем если нет ключей
let supabase;
if (supabaseUrl && supabaseKey) {
    supabase = createClient(supabaseUrl, supabaseKey);
} else {
    console.warn('Supabase keys not found - running in demo mode');
}

function App() {
    const [donaters, setDonaters] = useState([]);
    const [username, setUsername] = useState('');
    const [amount, setAmount] = useState('');
    const [isAdmin, setIsAdmin] = useState(true);
    const [isLoading, setIsLoading] = useState(false);
    const [password, setPassword] = useState('');
    const [isAuthenticated, setIsAuthenticated] = useState(false);

    // Пароль для админки (замени на свой!)
    const ADMIN_PASSWORD = process.env.REACT_APP_ADMIN_PASSWORD;

    if (!ADMIN_PASSWORD) {
        console.error('REACT_APP_ADMIN_PASSWORD not set in environment variables');
    }
    // Загружаем топ донатеров и настраиваем режим
    useEffect(() => {
        // Автоматически определяем режим по URL параметру
        const urlParams = new URLSearchParams(window.location.search);
        const viewMode = urlParams.get('view');

        if (viewMode === 'widget') {
            setIsAdmin(false);
            setIsAuthenticated(false);
        } else {
            const savedAuth = localStorage.getItem('admin_authenticated');
            if (savedAuth === 'true') {
                setIsAuthenticated(true);
            }
        }

        if (supabase) {
            loadTopDonaters();
            setupRealtimeSubscription();
            const cleanup = startKeepAlive(); // Сохраняем функцию очистки

            // Очистка при размонтировании
            return () => {
                if (cleanup) cleanup();
                if (supabase) {
                    supabase.removeChannel(supabase.channel('donaters-changes'));
                }
            };
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Realtime подписка (только если supabase доступен)
    const setupRealtimeSubscription = () => {
        if (!supabase) return;

        const channel = supabase
            .channel('donaters-changes')
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'donaters'
                },
                () => {
                    loadTopDonaters();
                }
            )
            .subscribe();

        return () => {
            if (supabase) {
                supabase.removeChannel(channel);
            }
        };
    };

    // Функция для поддержания активности БД
    const startKeepAlive = () => {
        if (!supabase) return;

        const makeKeepAliveRequest = async () => {
            try {
                console.log('🔄 Keep-alive запрос...');

                // Используем обычный запрос к таблице с правильной авторизацией
                const { error } = await supabase
                    .from('donaters')
                    .select('id')
                    .limit(1);

                if (error) {
                    console.log('❌ Keep-alive ошибка:', error.message);
                } else {
                    console.log('✅ Keep-alive успешно выполнен');
                }
            } catch (error) {
                console.log('❌ Keep-alive исключение:', error.message);
            }
        };

        // Выполняем первый запрос сразу
        makeKeepAliveRequest();

        // Интервал на 24 часа (86,400,000 миллисекунд)
        const keepAliveInterval = 24 * 60 * 60 * 1000;
        const intervalId = setInterval(makeKeepAliveRequest, keepAliveInterval);

        console.log(`🕐 Keep-alive запущен, интервал: 24 часа`);

        // Возвращаем функцию очистки
        return () => {
            clearInterval(intervalId);
            console.log('🛑 Keep-alive остановлен');
        };
    };

    const loadTopDonaters = async () => {
        if (!supabase) {
            // Демо данные если Supabase не доступен
            setDonaters([
                { id: 1, username: 'DEMO_USER', total_amount: 1000 },
                { id: 2, username: 'TEST_USER', total_amount: 500 }
            ]);
            return;
        }

        try {
            const { data, error } = await supabase
                .from('donaters')
                .select('*')
                .order('total_amount', { ascending: false })
                .limit(20);

            if (error) {
                console.error('Ошибка загрузки:', error);
            } else {
                setDonaters(data || []);
            }
        } catch (err) {
            console.error('Ошибка:', err);
        }
    };

    // Аутентификация
    const handleLogin = (e) => {
        e.preventDefault();
        if (password === ADMIN_PASSWORD) {
            setIsAuthenticated(true);
            localStorage.setItem('admin_authenticated', 'true');
            setPassword('');
        } else {
            alert('Неверный пароль!');
        }
    };

    const handleLogout = () => {
        setIsAuthenticated(false);
        localStorage.removeItem('admin_authenticated');
        setPassword('');
    };

    // Добавление/обновление доната
    const handleAddDonation = async (e) => {
        e.preventDefault();

        if (!supabase) {
            alert('Supabase не настроен! Проверь environment variables.');
            return;
        }

        if (!username.trim() || !amount.trim()) {
            alert('Заполните имя и сумму!');
            return;
        }

        const donationAmount = parseFloat(amount.replace(',', '.'));
        if (isNaN(donationAmount) || donationAmount <= 0) {
            alert('Введите корректную сумму!');
            return;
        }

        setIsLoading(true);

        try {
            // Ищем существующего донатера
            const { data: existingDonater } = await supabase
                .from('donaters')
                .select('*')
                .eq('username', username.trim())
                .single();

            if (existingDonater) {
                // Обновляем существующего
                const newTotal = parseFloat(existingDonater.total_amount) + donationAmount;
                const { error } = await supabase
                    .from('donaters')
                    .update({
                        total_amount: newTotal,
                        donation_count: existingDonater.donation_count + 1,
                        last_donation: new Date().toISOString()
                    })
                    .eq('id', existingDonater.id);

                if (error) throw error;
            } else {
                // Добавляем нового
                const { error } = await supabase
                    .from('donaters')
                    .insert([{
                        username: username.trim(),
                        total_amount: donationAmount,
                        donation_count: 1
                    }]);

                if (error) throw error;
            }

            // Очищаем форму
            setUsername('');
            setAmount('');

        } catch (error) {
            console.error('Ошибка:', error);
            alert('Ошибка при добавлении доната: ' + error.message);
        } finally {
            setIsLoading(false);
        }
    };

    // Получение класса для ранга
    const getRankClass = (index) => {
        switch (index) {
            case 0: return 'rank-first';
            case 1: return 'rank-second';
            case 2: return 'rank-third';
            default: return 'rank-other';
        }
    };

    // ЭКРАН АУТЕНТИФИКАЦИИ
    if (isAdmin && !isAuthenticated) {
        return (
            <div className="App">
                <div className="widget-container">
                    <div className="login-screen">
                        <h1>🔐 Доступ к админке</h1>
                        <form onSubmit={handleLogin} className="login-form">
                            <input
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder="Введите пароль"
                                className="password-input"
                            />
                            <button type="submit" className="login-button">
                                Войти
                            </button>
                        </form>
                        <p className="login-hint">Или <a href="/?view=widget">перейти к виджету</a></p>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="App">
            <div className="widget-container">
                <header className="widget-header">
                    <div className="header-content">
                        <div className="header-icon">🏆</div>
                        <div className="header-text">
                            <div className="header-title">Топ Донерсов</div>
                            <div className="header-subtitle">COMXALT<span className='hs2'>'ы</span></div>
                        </div>
                    </div>
                    <div className="header-actions">
                        {isAuthenticated && (
                            <button onClick={handleLogout} className="logout-button">
                                🔓 Выйти
                            </button>
                        )}
                        <button
                            onClick={() => setIsAdmin(!isAdmin)}
                            className="admin-toggle"
                        >
                            {isAdmin ? '👁️ Показать виджет' : '⚙️ Редактировать'}
                        </button>
                    </div>
                </header>

                {isAdmin ? (
                    // АДМИНКА (только для авторизованных)
                    <div className="admin-panel">
                        <form onSubmit={handleAddDonation} className="donation-form">
                            <div className="form-row">
                                <div className="input-group">
                                    <label>Имя донатера:</label>
                                    <input
                                        type="text"
                                        value={username}
                                        onChange={(e) => setUsername(e.target.value)}
                                        placeholder="Введите имя"
                                        disabled={isLoading}
                                    />
                                </div>

                                <div className="input-group">
                                    <label>Сумма (руб):</label>
                                    <input
                                        type="text"
                                        value={amount}
                                        onChange={(e) => setAmount(e.target.value)}
                                        placeholder="1000"
                                        disabled={isLoading}
                                    />
                                </div>

                                <button
                                    type="submit"
                                    className="add-button"
                                    disabled={isLoading}
                                >
                                    {isLoading ? '⏳ Добавляем...' : 'Добавить'}
                                </button>
                            </div>
                        </form>

                        <div className="admin-actions">
                            <button onClick={loadTopDonaters} className="refresh-button">
                                🔄 Обновить список
                            </button>
                        </div>

                        <div className="preview-section">
                            <h3>Текущий топ ({donaters.length} донатеров):</h3>
                            <div className="preview-list">
                                {donaters.map((donater, index) => (
                                    <div key={donater.id} className={`preview-item ${getRankClass(index)}`}>
                                        <span className="preview-name">{donater.username}</span>
                                        <span className="preview-amount">— {donater.total_amount} руб.</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                ) : (
                    // ВИДЖЕТ (только просмотр)
                    <div className="widget-view">
                        <div className="donaters-list">
                            {donaters.length === 0 ? (
                                <p className="no-donaters">Пока нет донатов...</p>
                            ) : (
                                donaters.map((donater, index) => (
                                    <div key={donater.id} className={`donater-card ${getRankClass(index)}`}>
                                        <div className="donater-info">
                                            <span className="donater-name">{donater.username}</span>
                                            <span className="donater-separator"> — </span>
                                            <span className="donater-amount">{donater.total_amount} ₽</span>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

export default App;