import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { auth as authApi, setAuthToken } from '../services/api';
import { socketService } from '../services/socket';
import type { User } from '../types';

interface AuthContextType {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, displayName: string, email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('panoramix-token'));
  const [isLoading, setIsLoading] = useState(true);

  const isAuthenticated = !!user && !!token;

  // Set token in API client when it changes
  useEffect(() => {
    setAuthToken(token);
    if (token) {
      localStorage.setItem('panoramix-token', token);
    } else {
      localStorage.removeItem('panoramix-token');
    }
  }, [token]);

  // Connect/disconnect socket based on auth
  useEffect(() => {
    if (isAuthenticated && token) {
      socketService.connect(token);
      return () => socketService.disconnect();
    }
  }, [isAuthenticated, token]);

  // Restore session on mount
  useEffect(() => {
    if (token) {
      authApi.me()
        .then(({ user }) => setUser(user))
        .catch(() => {
          setToken(null);
          setUser(null);
        })
        .finally(() => setIsLoading(false));
    } else {
      setIsLoading(false);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const login = useCallback(async (username: string, password: string) => {
    const res = await authApi.login({ username, password });
    setAuthToken(res.token);
    localStorage.setItem('panoramix-token', res.token);
    setToken(res.token);
    setUser(res.user);
  }, []);

  const register = useCallback(async (username: string, displayName: string, email: string, password: string) => {
    const res = await authApi.register({ username, displayName, email, password });
    setAuthToken(res.token);
    localStorage.setItem('panoramix-token', res.token);
    setToken(res.token);
    setUser(res.user);
  }, []);

  const logout = useCallback(() => {
    socketService.disconnect();
    setToken(null);
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, token, isAuthenticated, isLoading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
