import React, { useState, useEffect, useCallback, useRef } from 'react';
import '../../styles/tools-panel.css';

// Import dari medical.ts
import { 
    StegoMethod, 
    STEGO_METHODS, 
    getSupportedMethods 
} from '../../api/medical';

// Storage key untuk menyimpan metode yang dipilih
const STORAGE_KEY = 'selectedStegoMethod';

// Props interface
export interface ToolsPanelProps {
    isOpen?: boolean;
    onToggle?: (isOpen: boolean) => void;
    onMethodChange?: (method: StegoMethod) => void;
    defaultMethod?: StegoMethod;
}

// Status message interface
interface StatusMessage {
    type: 'success' | 'error' | 'info' | null;
    message: string | null;
}

// Recent action interface
interface RecentAction {
    id: number;
    action: string;
    success: boolean;
    time: string;
}

// Icons
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

const CheckIcon: React.FC = () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
        <path d="M20 6L9 17l-5-5"/>
    </svg>
);

const ErrorIcon: React.FC = () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
        <circle cx="12" cy="12" r="10"/>
        <path d="M12 8v4M12 16h.01"/>
    </svg>
);

const InfoIcon: React.FC = () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
        <circle cx="12" cy="12" r="10"/>
        <path d="M12 16v-4M12 8h.01"/>
    </svg>
);

// Helper: ambil metode tersimpan dari localStorage
const getStoredMethod = (defaultMethod: StegoMethod): StegoMethod => {
    try {
        const stored = localStorage.getItem(STORAGE_KEY) as StegoMethod;
        if (stored && STEGO_METHODS.some(m => m.value === stored)) {
            return stored;
        }
    } catch {
        // localStorage error, ignore
    }
    return defaultMethod;
};

// Helper: simpan metode ke localStorage
const storeMethod = (method: StegoMethod): void => {
    try {
        localStorage.setItem(STORAGE_KEY, method);
    } catch {
        // localStorage error, ignore
    }
};

// Get method label
const getMethodLabel = (methodValue: StegoMethod): string => {
    const method = STEGO_METHODS.find(m => m.value === methodValue);
    return method?.label || methodValue;
};

// Get method description
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
    // State
    const [isOpen, setIsOpen] = useState<boolean>(externalIsOpen !== undefined ? externalIsOpen : false);
    const [selectedMethod, setSelectedMethod] = useState<StegoMethod>(() => getStoredMethod(defaultMethod));
    const [status, setStatus] = useState<StatusMessage>({ type: null, message: null });
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [progress, setProgress] = useState<number>(0);
    const [recentActions, setRecentActions] = useState<RecentAction[]>([]);
    const [supportedMethods, setSupportedMethods] = useState<StegoMethod[]>([]);
    const [isSaved, setIsSaved] = useState<boolean>(false);
    
    const progressIntervalRef = useRef<NodeJS.Timeout | null>(null);
    const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    // Load supported methods from backend
    useEffect(() => {
        const loadMethods = async () => {
            try {
                const response = await getSupportedMethods();
                setSupportedMethods(response.methods);
            } catch (error) {
                console.error('Failed to load methods:', error);
                setSupportedMethods(STEGO_METHODS.map(m => m.value));
            }
        };
        loadMethods();
    }, []);

    // Sync with external control
    useEffect(() => {
        if (externalIsOpen !== undefined) {
            setIsOpen(externalIsOpen);
        }
    }, [externalIsOpen]);

    // Cleanup intervals on unmount
    useEffect(() => {
        return () => {
            if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
            if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
        };
    }, []);

    // Show saved indicator briefly
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
        const newAction: RecentAction = {
            id: Date.now(),
            action,
            success,
            time: new Date().toLocaleTimeString()
        };
        setRecentActions(prev => [newAction, ...prev].slice(0, 8));
    };

    const showStatus = (type: StatusMessage['type'], message: string, autoClear: boolean = true): void => {
        setStatus({ type, message });
        if (autoClear) {
            setTimeout(() => {
                setStatus(prev => prev.message === message ? { type: null, message: null } : prev);
            }, 3000);
        }
    };

    const startProgress = (): void => {
        setProgress(0);
        progressIntervalRef.current = setInterval(() => {
            setProgress(prev => {
                if (prev >= 90) {
                    if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
                    return 90;
                }
                return prev + 10;
            });
        }, 200);
    };

    const stopProgress = (): void => {
        if (progressIntervalRef.current) {
            clearInterval(progressIntervalRef.current);
            progressIntervalRef.current = null;
        }
        setProgress(100);
        setTimeout(() => setProgress(0), 500);
    };

    // Handle method change from dropdown
    const handleMethodChange = (e: React.ChangeEvent<HTMLSelectElement>): void => {
        const newMethod = e.target.value as StegoMethod;
        setSelectedMethod(newMethod);
        storeMethod(newMethod);
        showSavedIndicator();
        
        if (onMethodChange) {
            onMethodChange(newMethod);
        }
        
        showStatus('info', `Metode diubah ke ${newMethod.toUpperCase()}`, true);
        addRecentAction(`Ganti metode ke ${newMethod.toUpperCase()}`, true);
    };

    // Test connection to backend
    const handleTestConnection = async (): Promise<void> => {
        setIsLoading(true);
        startProgress();
        showStatus('info', 'Menguji koneksi ke backend...', false);

        try {
            const response = await getSupportedMethods();
            stopProgress();
            showStatus('success', `✅ Backend terhubung! Metode: ${response.methods.join(', ')}`);
            addRecentAction('Test koneksi backend', true);
        } catch (error) {
            stopProgress();
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            showStatus('error', `❌ Gagal koneksi: ${errorMessage}`);
            addRecentAction('Test koneksi backend', false);
        } finally {
            setIsLoading(false);
        }
    };

    // Get current status of selected method
    const isMethodAvailable = supportedMethods.includes(selectedMethod);
    const methodLabel = getMethodLabel(selectedMethod);
    const methodDesc = getMethodDescription(selectedMethod);

    return (
        <div className="tools-panel-container">
            <button 
                className="tools-toggle-btn" 
                onClick={handleToggle} 
                aria-label="Tools"
                type="button"
            >
                <ToolsIcon />
            </button>

            <div className={`tools-panel ${!isOpen ? 'closed' : ''}`}>
                <div className="tools-header">
                    <h3>🛠️ Pilih Metode Steganografi</h3>
                    <button className="close-btn" onClick={handleToggle} type="button">
                        <CloseIcon />
                    </button>
                </div>

                <div className="tools-body">
                    {/* Current Method Badge */}
                    <div className="current-method-badge">
                        <span className="label">Metode Aktif</span>
                        <span className="value">{methodLabel}</span>
                        {isSaved && <span className="saved">✓ Tersimpan</span>}
                    </div>

                    {/* Method Selector */}
                    <div className="method-selector">
                        <label htmlFor="method-select">Pilih Metode</label>
                        <select 
                            id="method-select"
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
                        <div className="method-desc">
                            {methodDesc}
                        </div>
                    </div>

                    {/* Status Message */}
                    {status.type && status.message && (
                        <div className={`status-message ${status.type}`}>
                            <span className="status-icon">
                                {status.type === 'success' && <CheckIcon />}
                                {status.type === 'error' && <ErrorIcon />}
                                {status.type === 'info' && <InfoIcon />}
                            </span>
                            <span className="status-text">{status.message}</span>
                        </div>
                    )}

                    {/* Progress Bar */}
                    {isLoading && progress > 0 && (
                        <div className="progress-bar">
                            <div className="progress-track">
                                <div className="progress-fill" style={{ width: `${progress}%` }}></div>
                            </div>
                            <div className="progress-text">{progress}%</div>
                        </div>
                    )}

                    {/* Action Buttons */}
                    <div className="action-buttons">
                        <button 
                            className="btn-primary" 
                            onClick={handleTestConnection}
                            disabled={isLoading}
                            type="button"
                        >
                            {isLoading ? 'Memproses...' : '🔌 Test Koneksi'}
                        </button>
                    </div>

                    {/* Info Panel */}
                    <div className="recent-actions">
                        <h4>ℹ️ Informasi</h4>
                        <div style={{ background: '#f8f9fa', padding: '10px', borderRadius: '8px', fontSize: '12px' }}>
                            <p style={{ margin: '0 0 8px 0' }}>
                                <strong>Status:</strong>{' '}
                                {isMethodAvailable ? '✅ Metode tersedia di backend' : '⚠️ Metode tidak tersedia'}
                            </p>
                            <p style={{ margin: '0' }}>
                                <strong>Catatan:</strong> Metode yang dipilih akan otomatis tersimpan dan digunakan saat upload data medis baru.
                            </p>
                        </div>
                    </div>

                    {/* Recent Actions */}
                    {recentActions.length > 0 && (
                        <div className="recent-actions">
                            <h4>Riwayat Aksi</h4>
                            <div className="recent-list">
                                {recentActions.map(action => (
                                    <div key={action.id} className="recent-item">
                                        <span>{action.success ? '✅' : '❌'} {action.action}</span>
                                        <span className="time">{action.time}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default ToolsPanel;