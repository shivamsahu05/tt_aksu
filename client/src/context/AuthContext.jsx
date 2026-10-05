import React, { createContext, useState, useEffect } from 'react';
import api from '../utils/api';
import { toast } from 'react-toastify';

export const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const checkAuth = async () => {
            try {
                const res = await api.get('/auth/me');
                if (res.data.success) {
                    const u = res.data.user;
                    setUser(u);
                    sessionStorage.setItem('tt_session_active', 'true');
                    localStorage.setItem('tt_last_active_time', Date.now().toString());
                    localStorage.setItem('tt_last_role', u.role);
                }
            } catch (error) {
                // Not authenticated
                setUser(null);
                localStorage.removeItem('tt_last_active_time');
                localStorage.removeItem('tt_last_role');
                sessionStorage.removeItem('tt_session_active');
            } finally {
                setLoading(false);
            }
        };
        
        checkAuth();
    }, []);

    // Keep last active timestamp updated while user is logged in
    useEffect(() => {
        if (!user) return;

        const updateTimestamp = () => {
            localStorage.setItem('tt_last_active_time', Date.now().toString());
            localStorage.setItem('tt_last_role', user.role);
            sessionStorage.setItem('tt_session_active', 'true');
        };

        updateTimestamp();

        // Update every 15 seconds while app is open
        const interval = setInterval(updateTimestamp, 15000);

        // Also update when user interacts or before closing tab
        const handleActivity = () => updateTimestamp();
        window.addEventListener('click', handleActivity);
        window.addEventListener('keydown', handleActivity);
        window.addEventListener('beforeunload', handleActivity);

        return () => {
            clearInterval(interval);
            window.removeEventListener('click', handleActivity);
            window.removeEventListener('keydown', handleActivity);
            window.removeEventListener('beforeunload', handleActivity);
        };
    }, [user]);

    const login = async (username, password) => {
        try {
            const res = await api.post('/auth/login', { username, password });
            if (res.data.success) {
                if (res.data.requiresOtp) {
                    return { requiresOtp: true, username: res.data.username, email: res.data.email, availableChannels: res.data.availableChannels };
                }
                const u = res.data.user;
                setUser(u);
                sessionStorage.setItem('tt_session_active', 'true');
                localStorage.setItem('tt_last_active_time', Date.now().toString());
                localStorage.setItem('tt_last_role', u.role);
                toast.success('Logged in successfully!');
                return { success: true };
            }
        } catch (error) {
            if (!error.isDbTimeout) {
                const msg = error.response?.data?.message || 'Login failed';
                toast.error(msg);
            }
            return { success: false };
        }
    };

    const sendOtp = async (username, channel) => {
        try {
            const res = await api.post('/auth/send-otp', { username, channel });
            if (res.data.success) {
                toast.success(res.data.message);
                return { success: true, message: res.data.message };
            }
        } catch (error) {
            const msg = error.response?.data?.message || 'Failed to send OTP';
            toast.error(msg);
            return { success: false, message: msg };
        }
    };

    const verifyOtp = async (username, otp) => {
        try {
            const res = await api.post('/auth/verify-otp', { username, otp });
            if (res.data.success) {
                const u = res.data.user;
                setUser(u);
                sessionStorage.setItem('tt_session_active', 'true');
                localStorage.setItem('tt_last_active_time', Date.now().toString());
                localStorage.setItem('tt_last_role', u.role);
                toast.success('OTP verified. Logged in successfully!');
                return true;
            }
        } catch (error) {
            const msg = error.response?.data?.message || 'OTP Verification failed';
            toast.error(msg);
            return false;
        }
    };

    const resendOtp = async (username) => {
        try {
            const res = await api.post('/auth/resend-otp', { username });
            if (res.data.success) {
                toast.success(res.data.message || 'OTP resent successfully!');
                return true;
            }
        } catch (error) {
            const msg = error.response?.data?.message || 'Failed to resend OTP';
            toast.error(msg);
            return false;
        }
    };

    const logout = async () => {
        try {
            localStorage.removeItem('tt_last_active_time');
            localStorage.removeItem('tt_last_role');
            sessionStorage.removeItem('tt_session_active');
            await api.post('/auth/logout');
            setUser(null);
            toast.info('Logged out successfully');
        } catch (error) {
            console.error('Logout error', error);
        }
    };

    return (
        <AuthContext.Provider value={{ user, loading, login, sendOtp, verifyOtp, resendOtp, logout }}>
            {children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => React.useContext(AuthContext);

