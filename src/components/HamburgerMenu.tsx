import React, { useState, useRef, useEffect } from 'react';
import { useCurrencyStore } from '../store/useCurrencyStore';
import { useTranslationStore } from '../store/useTranslationStore';
import { getExchangeRate } from '../utils/currency';
import { supportedLanguages } from '../i18n/translations';

const THINKING_LEVELS = [
    { value: 'minimal', label: 'Minimal' },
    { value: 'low', label: 'Low' },
    { value: 'medium', label: 'Medium' },
    { value: 'high', label: 'High' },
] as const;

interface HamburgerMenuProps {
    currencyOptions: string[];
}

export const HamburgerMenu: React.FC<HamburgerMenuProps> = ({ currencyOptions }) => {
    const [isOpen, setIsOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);

    const {
        homeCurrency,
        localCurrency,
        setHomeCurrency,
        setLocalCurrency,
        rates,
        thinkingLevel,
        setThinkingLevel,
        localToHomeRate,
        homeToLocalRate,
        setCalculatedRates,
        saveUserSettings,
        status,
    } = useCurrencyStore();
    const { language, setLanguage, t } = useTranslationStore();

    // 為替レートの計算（初期化完了後のみ）
    useEffect(() => {
        if (status === 'loading') return;
        if (!rates || !localCurrency || !homeCurrency || localCurrency === homeCurrency) {
            setCalculatedRates({ localToHome: null, homeToLocal: null });
            return;
        }
        const localToHome = getExchangeRate(localCurrency, homeCurrency, rates);
        if (localToHome) {
            setCalculatedRates({ localToHome: localToHome.ask, homeToLocal: 1 / localToHome.ask });
        } else {
            setCalculatedRates({ localToHome: null, homeToLocal: null });
        }
    }, [rates, localCurrency, homeCurrency, setCalculatedRates, status]);

    // 設定変更時にFirestoreに保存
    useEffect(() => {
        if (status !== 'loading') {
            saveUserSettings();
        }
    }, [homeCurrency, language, saveUserSettings, status]);

    // メニュー外クリックで閉じる
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                setIsOpen(false);
            }
        };
        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
        }
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isOpen]);

    const handleLanguageChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const selected = supportedLanguages.find(lang => lang.code === e.target.value);
        if (selected) setLanguage(selected.code);
    };

    const getAdjustedRate = (rate: number) => {
        if (rate < 0.01) return { unit: 100, value: (rate * 100).toFixed(4) };
        return { unit: 1, value: rate.toFixed(4) };
    };

    return (
        <div className="hamburger-menu-wrapper" ref={menuRef}>
            {/* ハンバーガーボタン */}
            <button
                className={`hamburger-button ${isOpen ? 'active' : ''}`}
                onClick={() => setIsOpen(!isOpen)}
                aria-label="Settings menu"
            >
                <span className="hamburger-line" />
                <span className="hamburger-line" />
                <span className="hamburger-line" />
            </button>

            {/* メニューパネル */}
            {isOpen && <div className="hamburger-overlay" onClick={() => setIsOpen(false)} />}
            <div className={`hamburger-panel ${isOpen ? 'open' : ''}`}>
                <div className="menu-section">
                    <label className="menu-label">{t('homeCurrencyLabel')}</label>
                    <select
                        value={homeCurrency}
                        onChange={(e) => setHomeCurrency(e.target.value)}
                        className="menu-select"
                    >
                        {currencyOptions.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                </div>

                <div className="menu-section">
                    <label className="menu-label">{t('localCurrencyLabel')}</label>
                    <select
                        value={localCurrency}
                        onChange={(e) => setLocalCurrency(e.target.value)}
                        className="menu-select"
                    >
                        {currencyOptions.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                </div>

                {/* 為替レート表示 */}
                {localToHomeRate !== null && homeToLocalRate !== null && (
                    <div className="menu-section menu-rates">
                        <span>{getAdjustedRate(localToHomeRate).unit} {localCurrency} ≈ {getAdjustedRate(localToHomeRate).value} {homeCurrency}</span>
                        <span>{getAdjustedRate(homeToLocalRate).unit} {homeCurrency} ≈ {getAdjustedRate(homeToLocalRate).value} {localCurrency}</span>
                    </div>
                )}

                <div className="menu-divider" />

                <div className="menu-section">
                    <label className="menu-label">Language</label>
                    <select
                        value={language}
                        onChange={handleLanguageChange}
                        className="menu-select"
                    >
                        {supportedLanguages.map(lang => (
                            <option key={lang.code} value={lang.code}>{lang.name}</option>
                        ))}
                    </select>
                </div>

                <div className="menu-section">
                    <label className="menu-label">Thinking Level</label>
                    <select
                        value={thinkingLevel}
                        onChange={(e) => setThinkingLevel(e.target.value)}
                        className="menu-select"
                    >
                        {THINKING_LEVELS.map(level => (
                            <option key={level.value} value={level.value}>{level.label}</option>
                        ))}
                    </select>
                </div>
            </div>
        </div>
    );
};
