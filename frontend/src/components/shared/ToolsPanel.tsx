import React, { useState, useEffect, useCallback, useRef } from 'react';
import '../../styles/tools-panel.css';

import {
    StegoMethod,
    STEGO_METHODS,
    getSupportedMethods
} from '../../api/medical';

const STORAGE_KEY = 'selectedStegoMethod';

export interface ToolsPanelProps {
    isOpen?: boolean;
    onToggle?: (isOpen: boolean) => void;
    onMethodChange?: (method: StegoMethod) => void;
    defaultMethod?: StegoMethod;
}

interface StatusMessage {
    type: 'success' | 'error' | 'info' | null;
    message: string | null;
}

interface RecentAction {
    id: number;
    action: string;
    success: boolean;
    time: string;
}

const ToolsIcon: React.FC = () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
        <circle cx="12" cy="12" r="3"/>
    </svg>
);

const CloseIcon: React.FC = () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
        <path d="M18 6L6 18M6 6l12 12"/>
    </svg>
);

const getStoredMethod = (defaultMethod: StegoMethod): StegoMethod => {
    try {
        const stored = localStorage.getItem(STORAGE_KEY) as StegoMethod;
        if (stored && STEGO_METHODS.some(m => m.value === stored)) return stored;
    } catch {}
    return defaultMethod;
};

const storeMethod = (method: StegoMethod): void => {
    try { localStorage.setItem(STORAGE_KEY, method); } catch {}
};

const getMethodLabel = (methodValue: StegoMethod): string =>
    STEGO_METHODS.find(m => m.value === methodValue)?.label || methodValue;

const getMethodDescription = (methodValue: StegoMethod): string => {
    const descriptions: Record<StegoMethod, string> = {
        stegoshield: 'LSB RONI + AES-128 encryption. Aman, terenkripsi, kapasitas sedang.',
        dwt_pso: 'DWT + Particle Swarm Optimization + LDPC. Kapasitas tinggi, kualitas baik.',
        ebs3: 'Edge Based dengan 3-layer transformasi. Cepat dan efisien.',
        ebs5: 'Edge Based dengan 5-layer transformasi. Keamanan lebih tinggi.',
        ebs9: 'Edge Based dengan 9-layer transformasi. Paling kompleks dan aman.'
    };
    return descriptions[methodValue];
};

const ToolsPanel: React.FC<ToolsPanelProps> = ({
    isOpen: externalIsOpen,
    onToggle,
    onMethodChange,
    defaultMethod = 'stegoshield'
}) => {
    const [isOpen, setIsOpen] = useState<boolean>(externalIsOpen !== undefined ? externalIsOpen : false);
    const [selectedMethod, setSelectedMethod] = useState<StegoMethod>(() => getStoredMethod(defaultMethod));
    const [status, setStatus] = useState<StatusMessage>({ type: null, message: null });
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [recentActions, setRecentActions] = useState<RecentAction[]>([]);
    const [supportedMethods, setSupportedMethods] = useState<StegoMethod[]>([]);
    const [isSaved, setIsSaved] = useState<boolean>(false);

    const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    useEffect(() => {
        const loadMethods = async () => {
            try {
                const response = await getSupportedMethods();
                setSupportedMethods(response.methods);
            } catch {
                setSupportedMethods(STEGO_METHODS.map(m => m.value));
            }
        };
        loadMethods();
    }, []);

    useEffect(() => {
        if (externalIsOpen !== undefined) setIsOpen(externalIsOpen);
    }, [externalIsOpen]);

    useEffect(() => {
        return () => {
            if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
        };
    }, []);

    const showSavedIndicator = useCallback(() => {
        setIsSaved(true);
        if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = setTimeout(() => setIsSaved(false), 1500);
    }, []);

    const handleToggle = (): void => {
        const newState = !isOpen;
        setIsOpen(newState);
        if (onToggle) onToggle(newState);
    };

    const addRecentAction = (action: string, success: boolean): void => {
        setRecentActions(prev => [{
            id: Date.now(),
            action,
            success,
            time: new Date().toLocaleTimeString()
        }, ...prev].slice(0, 5));
    };

    const showStatus = (type: StatusMessage['type'], message: string): void => {
        setStatus({ type, message });
        setTimeout(() => setStatus({ type: null, message: null }), 3000);
    };

    const handleMethodChange = (e: React.ChangeEvent<HTMLSelectElement>): void => {
        const newMethod = e.target.value as StegoMethod;
        setSelectedMethod(newMethod);
        storeMethod(newMethod);
        showSavedIndicator();
        if (onMethodChange) onMethodChange(newMethod);
        addRecentAction(`Metode → ${getMethodLabel(newMethod)}`, true);
    };

    const handleTestConnection = async (): Promise<void> => {
        setIsLoading(true);
        showStatus('info', 'Menguji koneksi...');
        try {
            const response = await getSupportedMethods();
            showStatus('success', `Terhubung. ${response.methods.length} metode tersedia.`);
            addRecentAction('Test koneksi', true);
        } catch (error) {
            const msg = error instanceof Error ? error.message : 'Unknown error';
            showStatus('error', `Gagal: ${msg}`);
            addRecentAction('Test koneksi', false);
        } finally {
            setIsLoading(false);
        }
    };

    const isMethodAvailable = supportedMethods.includes(selectedMethod);

    return (
        <div className="tp-container">
            <button className="tp-fab" onClick={handleToggle} aria-label="Tools" type="button">
                <ToolsIcon />
            </button>

            {isOpen && (
                <div className="tp-panel">
                    <div className="tp-header">
                        <span className="tp-header-title">Metode Steganografi</span>
                        <button className="tp-close" onClick={handleToggle} type="button">
                            <CloseIcon />
                        </button>
                    </div>

                    <div className="tp-body">
                        {/* Active Method Badge */}
                        <div className="tp-badge">
                            <span className="tp-badge-label">Aktif</span>
                            <div className="tp-badge-row">
                                <span className="tp-badge-value">{getMethodLabel(selectedMethod)}</span>
                                <span className={`tp-badge-dot ${isMethodAvailable ? 'available' : 'unavailable'}`} />
                            </div>
                            {isSaved && <span className="tp-badge-saved">✓ Tersimpan</span>}
                        </div>

                        {/* Method Selector */}
                        <div className="tp-field">
                            <label className="tp-label" htmlFor="tp-method-select">Pilih Metode</label>
                            <select
                                id="tp-method-select"
                                className="tp-select"
                                value={selectedMethod}
                                onChange={handleMethodChange}
                                disabled={isLoading}
                            >
                                {STEGO_METHODS.map(method => (
                                    <option key={method.value} value={method.value}>
                                        {method.label}
                                    </option>
                                ))}
                            </select>
                            <p className="tp-desc">{getMethodDescription(selectedMethod)}</p>
                        </div>

                        {/* Status */}
                        {status.type && status.message && (
                            <div className={`tp-status tp-status-${status.type}`}>
                                {status.message}
                            </div>
                        )}

                        {/* Action */}
                        <button
                            className="tp-btn"
                            onClick={handleTestConnection}
                            disabled={isLoading}
                            type="button"
                        >
                            {isLoading ? 'Memproses...' : 'Test Koneksi'}
                        </button>

                        {/* Recent Actions */}
                        {recentActions.length > 0 && (
                            <div className="tp-recent">
                                <span className="tp-recent-title">Riwayat</span>
                                {recentActions.map(action => (
                                    <div key={action.id} className="tp-recent-item">
                                        <span className={`tp-recent-dot ${action.success ? 'ok' : 'fail'}`} />
                                        <span className="tp-recent-action">{action.action}</span>
                                        <span className="tp-recent-time">{action.time}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default ToolsPanel;