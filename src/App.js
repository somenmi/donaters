import React, { useState, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';
import './App.css';

// Безопасное получение переменных окружения
const supabaseUrl = process.env.REACT_APP_SUPABASE_URL;
const supabaseKey = process.env.REACT_APP_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase environment variables');
}

const supabase = createClient(supabaseUrl, supabaseKey);

function App() {
    const [donaters, setDonaters] = useState([]);
    const [username, setUsername] = useState('');
    const [amount, setAmount] = useState('');
    const [isAdmin, setIsAdmin] = useState(true); // По умолчанию админка
    const [isLoading, setIsLoading] = useState(false);

    // Загружаем топ донатеров
    useEffect(() => {
        loadTopDonaters();
        setupRealtimeSubscription();
        startKeepAlive(); // Запускаем поддержку активности БД
    }, []);

    // Realtime подписка
    const setupRealtimeSubscription = () => {
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
            supabase.removeChannel(channel);
        };
    };

    // Функция для поддержания активности БД
    const startKeepAlive = () => {
        // Каждые 30 дней делаем запрос чтобы БД не удалилась
        setInterval(async () => {
            try {
                await supabase
                    .from('donaters')
                    .select('count')
                    .limit(1);
                console.log('Keep-alive запрос выполнен');
            } catch (error) {
                console.log('Keep-alive ошибка:', error);
            }
        }, 25 * 24 * 60 * 60 * 1000); // 25 дней

        // Также делаем запрос при каждой загрузке страницы
        supabase
            .from('donaters')
            .select('count')
            .limit(1);
    };

    const loadTopDonaters = async () => {
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

    // Добавление/обновление доната
    const handleAddDonation = async (e) => {
        e.preventDefault();

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

    // Очистка всех данных
    const clearAllData = async () => {
        if (!window.confirm('Точно очистить ВСЕ данные? Это нельзя отменить!')) {
            return;
        }

        try {
            const { error } = await supabase
                .from('donaters')
                .delete()
                .neq('id', '');

            if (error) throw error;
            setDonaters([]);
            alert('Все данные очищены!');
        } catch (error) {
            console.error('Ошибка очистки:', error);
            alert('Ошибка при очистке: ' + error.message);
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

    return (
        <div className="App">
            <div className="widget-container">
                <header className="widget-header">
                    <h1>🏆 ТОП ДОНАТЕРЫ</h1>
                    <button
                        onClick={() => setIsAdmin(!isAdmin)}
                        className="admin-toggle"
                    >
                        {isAdmin ? '👁️ Показать виджет' : '⚙️ Редактировать'}
                    </button>
                </header>

                {isAdmin ? (
                    // АДМИНКА
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
                                    {isLoading ? '⏳ Добавляем...' : '✅ Добавить'}
                                </button>
                            </div>
                        </form>

                        <div className="admin-actions">
                            <button onClick={clearAllData} className="clear-button">
                                🗑️ Очистить ВСЕ данные
                            </button>
                            <button onClick={loadTopDonaters} className="refresh-button">
                                🔄 Обновить список
                            </button>
                        </div>

                        <div className="preview-section">
                            <h3>Текущий топ ({donaters.length} донатеров):</h3>
                            <div className="preview-list">
                                {donaters.map((donater, index) => (
                                    <div key={donater.id} className={`preview-item ${getRankClass(index)}`}>
                                        <span className="preview-rank">#{index + 1}</span>
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
                                        <div className="donater-rank">#{index + 1}</div>
                                        <div className="donater-info">
                                            <span className="donater-name">{donater.username}</span>
                                            <span className="donater-separator"> — </span>
                                            <span className="donater-amount">{donater.total_amount} руб.</span>
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