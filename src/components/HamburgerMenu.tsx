import React, { useState, useRef, useEffect } from 'react';
import { useCurrencyStore } from '../store/useCurrencyStore';
import { useTranslationStore } from '../store/useTranslationStore';
import { getExchangeRate } from '../utils/currency';
import { supportedLanguages } from '../i18n/translations';

const OVERLAY_MODELS = [
    { value: 'gemini-3-flash-preview', label: 'Gemini 3 Flash' },
    { value: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash' },
] as const;

const OVERLAY_THINKING_LEVELS = [
    { value: 'minimal', label: 'Minimal' },
    { value: 'low', label: 'Low' },
    { value: 'medium', label: 'Medium' },
    { value: 'high', label: 'High' },
] as const;

const IMAGE_MODELS = [
    { value: 'nanobanana2', label: 'Nano Banana 2 (Fast)' },
    { value: 'nanobanana-pro', label: 'Nano Banana Pro (Quality)' },
] as const;

// Image Thinking Levels are model-dependent
const IMAGE_THINKING_LEVELS: Record<string, { value: string; label: string }[]> = {
    'nanobanana2': [
        { value: 'minimal', label: 'Minimal' },
        { value: 'high', label: 'High' },
    ],
    'nanobanana-pro': [], // not supported
};

const IMAGE_SIZES = [
    { value: '1K', label: '1K (1024×1024)' },
    { value: '2K', label: '2K (2048×2048)' },
    { value: '4K', label: '4K (4096×4096)' },
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
        overlayModel,
        setOverlayModel,
        overlayThinkingLevel,
        setOverlayThinkingLevel,
        imageModel,
        setImageModel,
        imageThinkingLevel,
        setImageThinkingLevel,
        imageSize,
        setImageSize,
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

    // Image Model変更時にThinking Levelをリセット
    const handleImageModelChange = (model: 'nanobanana2' | 'nanobanana-pro') => {
        setImageModel(model);
        const levels = IMAGE_THINKING_LEVELS[model] || [];
        if (levels.length > 0) {
            // デフォルトで最後の選択肢（high）を選択
            setImageThinkingLevel(levels[levels.length - 1].value);
        }
    };

    const imageThinkingOptions = IMAGE_THINKING_LEVELS[imageModel] || [];

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
                {/* ── 通貨設定 ── */}
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

                {/* ── 言語 ── */}
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

                <div className="menu-divider" />

                {/* ── オーバーレイ設定 ── */}
                <div className="menu-section-header">Overlay</div>

                <div className="menu-section">
                    <label className="menu-label">Model</label>
                    <select
                        value={overlayModel}
                        onChange={(e) => setOverlayModel(e.target.value)}
                        className="menu-select"
                    >
                        {OVERLAY_MODELS.map(m => (
                            <option key={m.value} value={m.value}>{m.label}</option>
                        ))}
                    </select>
                </div>

                <div className="menu-section">
                    <label className="menu-label">Thinking Level</label>
                    <select
                        value={overlayThinkingLevel}
                        onChange={(e) => setOverlayThinkingLevel(e.target.value)}
                        className="menu-select"
                    >
                        {OVERLAY_THINKING_LEVELS.map(level => (
                            <option key={level.value} value={level.value}>{level.label}</option>
                        ))}
                    </select>
                </div>

                <div className="menu-divider" />

                {/* ── 画像翻訳設定 ── */}
                <div className="menu-section-header">Image Translation</div>

                <div className="menu-section">
                    <label className="menu-label">Model</label>
                    <select
                        value={imageModel}
                        onChange={(e) => handleImageModelChange(e.target.value as 'nanobanana2' | 'nanobanana-pro')}
                        className="menu-select"
                    >
                        {IMAGE_MODELS.map(model => (
                            <option key={model.value} value={model.value}>{model.label}</option>
                        ))}
                    </select>
                </div>

                {imageThinkingOptions.length > 0 && (
                    <div className="menu-section">
                        <label className="menu-label">Thinking Level</label>
                        <select
                            value={imageThinkingLevel}
                            onChange={(e) => setImageThinkingLevel(e.target.value)}
                            className="menu-select"
                        >
                            {imageThinkingOptions.map(level => (
                                <option key={level.value} value={level.value}>{level.label}</option>
                            ))}
                        </select>
                    </div>
                )}

                <div className="menu-section">
                    <label className="menu-label">Image Size</label>
                    <select
                        value={imageSize}
                        onChange={(e) => setImageSize(e.target.value as '1K' | '2K' | '4K')}
                        className="menu-select"
                    >
                        {IMAGE_SIZES.map(size => (
                            <option key={size.value} value={size.value}>{size.label}</option>
                        ))}
                    </select>
                </div>
            </div>
        </div>
    );
};
