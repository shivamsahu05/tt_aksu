import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { Helmet } from 'react-helmet-async';
import logoImg from '../../assets/logo.png';

const maskEmail = (email) => {
    if (!email || !email.includes('@')) return email || '';
    const [local, domain] = email.split('@');
    if (local.length <= 2) {
        return `${local[0] || ''}...@${domain}`;
    }
    if (local.length <= 4) {
        return `${local.slice(0, 1)}...${local.slice(-1)}@${domain}`;
    }
    return `${local.slice(0, 2)}.....${local.slice(-3)}@${domain}`;
};

const Login = () => {
    const { login, verifyOtp, resendOtp, sendOtp } = useAuth();
    const navigate = useNavigate();
    const [formData, setFormData] = useState({ username: '', password: '' });
    const [loading, setLoading] = useState(false);
    const [showPassword, setShowPassword] = useState(false);
    
    const [step, setStep] = useState('LOGIN'); // 'LOGIN' | 'CHOOSE_CHANNEL' | 'OTP'
    const [otp, setOtp] = useState('');
    const [otpEmail, setOtpEmail] = useState('');
    const [otpMessage, setOtpMessage] = useState('');
    const [availableChannels, setAvailableChannels] = useState([]);
    const [selectedChannel, setSelectedChannel] = useState('');
    const [timeLeft, setTimeLeft] = useState(600); // 10 minutes (600s)
    const [resendCooldown, setResendCooldown] = useState(60); // 60s cooldown

    useEffect(() => {
        let timer;
        if (step === 'OTP' && timeLeft > 0) {
            timer = setInterval(() => setTimeLeft(prev => prev - 1), 1000);
        } else if (timeLeft <= 0) {
            clearInterval(timer);
        }
        return () => clearInterval(timer);
    }, [step, timeLeft]);

    useEffect(() => {
        let cooldownTimer;
        if (step === 'OTP' && resendCooldown > 0) {
            cooldownTimer = setInterval(() => setResendCooldown(prev => prev - 1), 1000);
        } else if (resendCooldown <= 0) {
            clearInterval(cooldownTimer);
        }
        return () => clearInterval(cooldownTimer);
    }, [step, resendCooldown]);

    const formatTime = (seconds) => {
        const m = Math.floor(seconds / 60);
        const s = seconds % 60;
        return `${m}:${s < 10 ? '0' : ''}${s}`;
    };

    const handleResendOtp = async () => {
        if (resendCooldown > 0) return;
        setLoading(true);
        // Resend to the selected channel
        const result = await sendOtp(formData.username, selectedChannel);
        setLoading(false);
        if (result && result.success) {
            setTimeLeft(600);
            setResendCooldown(60);
        }
    };

    const handleSendOtp = async (e) => {
        e.preventDefault();
        if (!selectedChannel) return;
        setLoading(true);
        const result = await sendOtp(formData.username, selectedChannel);
        setLoading(false);
        if (result && result.success) {
            setOtpMessage(result.message);
            setStep('OTP');
            setTimeLeft(600);
            setResendCooldown(60);
        }
    };

    const handleChange = (e) => {
        setFormData({ ...formData, [e.target.name]: e.target.value });
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        
        if (step === 'LOGIN') {
            const result = await login(formData.username, formData.password);
            setLoading(false);
            
            if (result && result.requiresOtp) {
                if (result.availableChannels && result.availableChannels.length > 0) {
                    setAvailableChannels(result.availableChannels);
                    setSelectedChannel(result.availableChannels[0]);
                    setStep('CHOOSE_CHANNEL');
                } else {
                    setStep('OTP');
                }
                if (result.email) setOtpEmail(result.email);
                if (result.message) setOtpMessage(result.message);
                setFormData(prev => ({ ...prev, password: '' })); // clear password for security
            } else if (result && result.success) {
                navigate('/dashboard');
            }
        } else if (step === 'OTP') {
            const success = await verifyOtp(formData.username, otp);
            setLoading(false);
            if (success) {
                navigate('/dashboard');
            }
        }
    };

    return (
        <div style={{ 
            minHeight: '100vh', 
            display: 'flex',
            background: 'var(--app-bg)'
        }}>
            <Helmet>
                <title>Login - TTMS | AKS University by Hackvitrasec Solutions</title>
                <meta name="description" content="Login to the AKS University Timetable Management System. Developed and secured by Hackvitrasec Solutions." />
                <meta name="keywords" content="Hackvitrasec, Hackvitrasec Solutions, AKS time table login, AKSU timetable login, AKS University login, Timetable Management System, Shivam Sahu" />
            </Helmet>
            {/* Left Panel - Branding */}
            <div style={{
                flex: '0 0 44%',
                background: 'linear-gradient(135deg, #1e1b4b 0%, #312e81 40%, #4c1d95 80%, #6366f1 100%)',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                padding: '40px',
                position: 'relative',
                overflow: 'hidden'
            }} className="d-none d-lg-flex">
                {/* Decorative circles */}
                <div style={{
                    position: 'absolute', top: '-60px', right: '-60px',
                    width: '280px', height: '280px', borderRadius: '50%',
                    background: 'rgba(255,255,255,0.04)'
                }}/>
                <div style={{
                    position: 'absolute', bottom: '-80px', left: '-40px',
                    width: '320px', height: '320px', borderRadius: '50%',
                    background: 'rgba(255,255,255,0.04)'
                }}/>
                <div style={{
                    position: 'absolute', top: '45%', right: '10%',
                    width: '120px', height: '120px', borderRadius: '50%',
                    background: 'rgba(255,255,255,0.03)'
                }}/>

                {/* Logo */}
                <div style={{ position: 'relative', zIndex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <div style={{
                            width: '48px', height: '48px',
                            background: '#fff',
                            borderRadius: '12px',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
                        }}>
                            <img src={logoImg} alt="AKS Logo" style={{ width: '36px', height: '36px', objectFit: 'contain' }} />
                        </div>
                        <div>
                            <div style={{ fontFamily: 'Outfit, sans-serif', fontWeight: 700, fontSize: '20px', color: '#fff' }}>AKS University</div>
                            <div style={{ fontSize: '11.5px', color: 'rgba(255,255,255,0.7)', marginTop: '1px' }}>Timetable Management System</div>
                        </div>
                    </div>
                </div>

                {/* Center Content */}
                <div style={{ position: 'relative', zIndex: 1 }}>
                    <div style={{
                        display: 'inline-flex', alignItems: 'center', gap: '6px',
                        background: 'rgba(255,255,255,0.1)',
                        border: '1px solid rgba(255,255,255,0.15)',
                        borderRadius: '6px',
                        padding: '4px 12px',
                        marginBottom: '20px'
                    }}>
                        <div style={{ width: '6px', height: '6px', background: '#4ade80', borderRadius: '50%' }}/>
                        <span style={{ fontSize: '11.5px', color: 'rgba(255,255,255,0.8)', fontWeight: 500 }}>Enterprise Grade</span>
                    </div>
                    <h1 style={{
                        fontFamily: 'Outfit, sans-serif',
                        fontSize: '36px', fontWeight: 700, color: '#fff',
                        lineHeight: 1.2, marginBottom: '16px'
                    }}>
                        Smarter Timetable<br/>
                        <span style={{ color: 'rgba(196, 181, 253, 1)' }}>Management</span>
                    </h1>
                    <p style={{ color: 'rgba(255,255,255,0.65)', fontSize: '14px', lineHeight: 1.7, maxWidth: '340px' }}>
                        A powerful platform for colleges and universities to manage schedules, teachers, rooms, and academic sessions—all in one place.
                    </p>

                    {/* Feature pills */}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '28px' }}>
                        {['Auto Schedule', 'Leave Management', 'Faculty Portal', 'Reports & Export'].map(f => (
                            <div key={f} style={{
                                background: 'rgba(255,255,255,0.08)',
                                border: '1px solid rgba(255,255,255,0.12)',
                                borderRadius: '6px',
                                padding: '4px 12px',
                                fontSize: '12px', color: 'rgba(255,255,255,0.8)'
                            }}>
                                <i className="bi bi-check-circle-fill me-1" style={{ color: '#818cf8', fontSize: '10px' }}/>
                                {f}
                            </div>
                        ))}
                    </div>
                </div>

                {/* Bottom */}
                <div style={{ position: 'relative', zIndex: 1, color: 'rgba(255,255,255,0.4)', fontSize: '12px' }}>
                    Designed & Developed by <a href="https://hackvitrasec.com/" target="_blank" rel="noopener noreferrer" style={{ color: 'rgba(255,255,255,0.8)', textDecoration: 'none', fontWeight: '500' }}>HackVitraSec Solution</a>
                </div>
            </div>

            {/* Right Panel - Login Form */}
            <div style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '40px 24px'
            }}>
                <div style={{ width: '100%', maxWidth: '400px' }}>
                    {/* Mobile logo */}
                    <div className="d-lg-none text-center mb-4">
                        <div style={{
                            width: '50px', height: '50px',
                            background: 'linear-gradient(135deg, #6366f1, #4338ca)',
                            borderRadius: '14px',
                            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                            marginBottom: '12px',
                            boxShadow: '0 8px 24px rgba(99,102,241,0.35)'
                        }}>
                            <i className="bi bi-calendar3-week" style={{ fontSize: '22px', color: '#fff' }}/>
                        </div>
                        <div style={{ fontFamily: 'Outfit, sans-serif', fontWeight: 700, fontSize: '20px', color: 'var(--text-primary)' }}>TTMS Admin</div>
                    </div>

                    {/* Header */}
                    <div style={{ marginBottom: '32px' }}>
                        <h2 style={{
                            fontFamily: 'Outfit, sans-serif',
                            fontSize: '26px', fontWeight: 700,
                            color: 'var(--text-primary)', marginBottom: '6px'
                        }}>
                            {step === 'OTP' ? 'Verify Your Identity' : 'Welcome back'}
                        </h2>
                        <p style={{ color: 'var(--text-muted)', fontSize: '14px', whiteSpace: 'pre-line' }}>
                            {step === 'OTP'
                                ? (otpMessage || `Enter the 6-digit OTP sent to your registered contact.`)
                                : 'Sign in to your account to continue'}
                        </p>
                    </div>

                    {/* Form */}
                    <form onSubmit={handleSubmit}>
                        {step === 'LOGIN' ? (
                            <>
                                {/* Username */}
                                <div style={{ marginBottom: '16px' }}>
                                    <label className="form-label" style={{ display: 'block', marginBottom: '6px' }}>
                                        Username
                                    </label>
                                    <div style={{ position: 'relative' }}>
                                        <i className="bi bi-person" style={{
                                            position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)',
                                            color: 'var(--text-muted)', fontSize: '15px', pointerEvents: 'none'
                                        }}/>
                                        <input
                                            type="text"
                                            className="form-control"
                                            name="username"
                                            placeholder="Enter your username"
                                            value={formData.username}
                                            onChange={handleChange}
                                            required
                                            autoFocus
                                            style={{ paddingLeft: '36px', height: '42px' }}
                                        />
                                    </div>
                                </div>

                                {/* Password */}
                                <div style={{ marginBottom: '24px' }}>
                                    <label className="form-label" style={{ display: 'block', marginBottom: '6px' }}>
                                        Password
                                    </label>
                                    <div style={{ position: 'relative' }}>
                                        <i className="bi bi-lock" style={{
                                            position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)',
                                            color: 'var(--text-muted)', fontSize: '15px', pointerEvents: 'none'
                                        }}/>
                                        <input
                                            type={showPassword ? 'text' : 'password'}
                                            className="form-control"
                                            name="password"
                                            placeholder="Enter your password"
                                            value={formData.password}
                                            onChange={handleChange}
                                            required
                                            style={{ paddingLeft: '36px', paddingRight: '40px', height: '42px' }}
                                        />
                                        <button
                                            type="button"
                                            onClick={() => setShowPassword(!showPassword)}
                                            style={{
                                                position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)',
                                                background: 'none', border: 'none', cursor: 'pointer',
                                                color: 'var(--text-muted)', padding: '4px', fontSize: '15px'
                                            }}
                                        >
                                            <i className={`bi ${showPassword ? 'bi-eye-slash' : 'bi-eye'}`}/>
                                        </button>
                                    </div>
                                </div>

                                {/* Submit Button */}
                                <button
                                    type="submit"
                                    className="btn btn-primary"
                                    disabled={loading}
                                    style={{ width: '100%', height: '42px', fontSize: '14px', justifyContent: 'center' }}
                                >
                                    {loading ? (
                                        <>
                                            <span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"/>
                                            Signing in...
                                        </>
                                    ) : (
                                        <>
                                            Sign In
                                            <i className="bi bi-arrow-right-short" style={{ fontSize: '16px' }}/>
                                        </>
                                    )}
                                </button>
                            </>
                        ) : step === 'CHOOSE_CHANNEL' ? (
                            <>
                                <div className="mb-4">
                                    <label className="form-label fw-bold mb-3">How would you like to receive your OTP?</label>
                                    <div className="d-flex flex-column gap-2">
                                        {availableChannels.includes('email') && (
                                            <button
                                                type="button"
                                                className={`btn text-start p-3 border rounded-3 d-flex align-items-center gap-3 ${selectedChannel === 'email' ? 'btn-primary bg-opacity-10 border-primary' : 'btn-light'}`}
                                                onClick={() => setSelectedChannel('email')}
                                            >
                                                <i className={`bi bi-envelope-check fs-4 ${selectedChannel === 'email' ? 'text-primary' : 'text-muted'}`}></i>
                                                <div>
                                                    <div className={`fw-bold ${selectedChannel === 'email' ? 'text-primary' : 'text-dark'}`}>Email OTP</div>
                                                    <div className="small text-muted" style={{ fontSize: '12px' }}>Receive the code via your registered email</div>
                                                </div>
                                            </button>
                                        )}
                                        {availableChannels.includes('sms') && (
                                            <button
                                                type="button"
                                                className={`btn text-start p-3 border rounded-3 d-flex align-items-center gap-3 ${selectedChannel === 'sms' ? 'btn-primary bg-opacity-10 border-primary' : 'btn-light'}`}
                                                onClick={() => setSelectedChannel('sms')}
                                            >
                                                <i className={`bi bi-chat-text fs-4 ${selectedChannel === 'sms' ? 'text-primary' : 'text-muted'}`}></i>
                                                <div>
                                                    <div className={`fw-bold ${selectedChannel === 'sms' ? 'text-primary' : 'text-dark'}`}>SMS OTP</div>
                                                    <div className="small text-muted" style={{ fontSize: '12px' }}>Receive the code via standard SMS</div>
                                                </div>
                                            </button>
                                        )}
                                        {availableChannels.includes('whatsapp') && (
                                            <button
                                                type="button"
                                                className={`btn text-start p-3 border rounded-3 d-flex align-items-center gap-3 ${selectedChannel === 'whatsapp' ? 'btn-success bg-opacity-10 border-success' : 'btn-light'}`}
                                                onClick={() => setSelectedChannel('whatsapp')}
                                            >
                                                <i className={`bi bi-whatsapp fs-4 ${selectedChannel === 'whatsapp' ? 'text-success' : 'text-muted'}`}></i>
                                                <div>
                                                    <div className={`fw-bold ${selectedChannel === 'whatsapp' ? 'text-success' : 'text-dark'}`}>WhatsApp OTP</div>
                                                    <div className="small text-muted" style={{ fontSize: '12px' }}>Receive the code via WhatsApp message</div>
                                                </div>
                                            </button>
                                        )}
                                    </div>
                                </div>
                                <div className="d-flex gap-2">
                                    <button
                                        type="button"
                                        className="btn btn-light"
                                        disabled={loading}
                                        onClick={() => setStep('LOGIN')}
                                        style={{ height: '42px', fontSize: '14px', flex: 1 }}
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleSendOtp}
                                        className="btn btn-primary"
                                        disabled={loading || !selectedChannel}
                                        style={{ height: '42px', fontSize: '14px', flex: 2, justifyContent: 'center' }}
                                    >
                                        {loading ? (
                                            <><span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"/>Sending...</>
                                        ) : (
                                            <>Send OTP <i className="bi bi-send ms-1"/></>
                                        )}
                                    </button>
                                </div>
                            </>
                        ) : (
                            <>
                                <div className="alert alert-info border-0 bg-info bg-opacity-10 py-2 px-3 mb-4 d-flex flex-column gap-2">
                                            <div className="d-flex align-items-center">
                                                <i className="bi bi-shield-check fs-4 me-3 text-info"></i>
                                                <div className="small">
                                                    {otpMessage || 'An OTP has been sent to your registered contact.'}
                                                </div>
                                            </div>
                                            <div className="d-flex justify-content-between align-items-center mt-1">
                                                <span className="badge bg-white text-dark border">
                                                    <i className="bi bi-clock me-1"></i>
                                                    Expires in: {formatTime(timeLeft)}
                                                </span>
                                                <button 
                                                    type="button"
                                                    className="btn btn-sm btn-link text-decoration-none p-0"
                                                    onClick={handleResendOtp}
                                                    disabled={resendCooldown > 0 || loading}
                                                >
                                                    {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend OTP'}
                                                </button>
                                            </div>
                                        </div>
                                        {/* OTP */}
                                        <div style={{ marginBottom: '24px' }}>
                                            <label className="form-label" style={{ display: 'block', marginBottom: '6px' }}>
                                                Enter 6-digit OTP
                                            </label>
                                            <div style={{ position: 'relative' }}>
                                                <i className="bi bi-shield-lock" style={{
                                                    position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)',
                                                    color: 'var(--text-muted)', fontSize: '15px', pointerEvents: 'none'
                                                }}/>
                                                <input
                                                    type="text"
                                                    className="form-control"
                                                    placeholder="e.g. 123456"
                                                    value={otp}
                                                    onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').substring(0, 6))}
                                                    required
                                                    autoFocus
                                                    style={{ paddingLeft: '36px', height: '42px', fontSize: '18px', letterSpacing: '4px' }}
                                                />
                                            </div>
                                        </div>

                                <div className="d-flex gap-2">
                                    <button
                                        type="button"
                                        className="btn btn-light"
                                        disabled={loading}
                                        onClick={() => setStep('LOGIN')}
                                        style={{ height: '42px', fontSize: '14px', flex: 1 }}
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        type="submit"
                                        className="btn btn-primary"
                                        disabled={loading || otp.length !== 6}
                                        style={{ height: '42px', fontSize: '14px', flex: 2, justifyContent: 'center' }}
                                    >
                                        {loading ? (
                                            <>
                                                <span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"/>
                                                Verifying...
                                            </>
                                        ) : (
                                            <>
                                                Verify & Login
                                                <i className="bi bi-arrow-right-short" style={{ fontSize: '16px' }}/>
                                            </>
                                        )}
                                    </button>
                                </div>
                            </>
                        )}

                        {/* Footer */}
                        <div style={{ marginTop: '24px', textAlign: 'center' }}>
                            <div style={{
                                display: 'inline-flex', alignItems: 'center', gap: '6px',
                                fontSize: '12px', color: 'var(--text-muted)',
                                background: 'var(--gray-100)',
                                border: '1px solid var(--app-border)',
                                borderRadius: '6px',
                                padding: '6px 12px'
                            }}>
                                <i className="bi bi-shield-check" style={{ color: 'var(--success)' }}/>
                                Secure, encrypted connection
                            </div>
                            <div className="d-lg-none mt-3" style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                                Developed by <a href="https://hackvitrasec.com/" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--primary-600)', textDecoration: 'none', fontWeight: '500' }}>Hackvitrasec Solutions</a>
                            </div>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    );
};

export default Login;
