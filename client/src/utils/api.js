import axios from 'axios';
import { toast } from 'react-toastify';

const baseURL = import.meta.env.MODE === 'production' ? '/api' : 'http://localhost:5000/api';

const api = axios.create({
    baseURL, // Dynamic baseURL based on environment
    withCredentials: true, // Allow sending cookies
});

// Response interceptor to handle errors globally
api.interceptors.response.use(
    (response) => {
        return response;
    },
    (error) => {
        // We can handle 401 Unauthorized globally here
        if (error.response && error.response.status === 401) {
            // Optional: redirect to login or dispatch logout
            // We'll handle state clear in the AuthContext itself
        }
        
        // Show specific toast for DB Connection delays
        if (error.response && error.response.data && error.response.data.message) {
            const msg = error.response.data.message;
            if (msg.includes('Database Connection')) {
                toast.warning(msg, { autoClose: 8000, toastId: 'db-timeout' });
                error.isDbTimeout = true;
            }
        }
        
        return Promise.reject(error);
    }
);

export default api;
