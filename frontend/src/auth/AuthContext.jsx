/**
 * Auth state context.
 *
 * Provides: { user, role, login, logout, refreshUser, loading }.
 * Wrap the app in <AuthProvider> and consume via useAuth().
 *
 * Role normalization: the backend historically returned "Official" for
 * municipal users. The UI is built around the new "Authority" terminology,
 * so every user object passing through this provider has its role mapped
 * (Official → Authority) before being stored. RoleRoute applies the same
 * mapping defensively, but normalising at the source keeps downstream
 * components role-stable.
 */
import React, { createContext, useContext, useState, useEffect } from "react";
import { authApi } from "../api/client";

const AuthContext = createContext(null);

const ROLE_ALIAS = {
    Official: "Authority",
    official: "Authority",
    authority: "Authority",
    admin: "Admin",
    citizen: "Citizen",
};

function normalizeRole(role) {
    return ROLE_ALIAS[role] || role;
}

function normalizeUser(user) {
    if (!user) return user;
    return {
        ...user,
        role: normalizeRole(user.role),
    };
}

/**
 * Auth context provider. On mount, if an access_token exists in localStorage
 * it calls /auth/me to rehydrate the user. Exposes login / logout /
 * refreshUser actions plus a `loading` flag for the initial bootstrap.
 *
 * @param {Object} props
 * @param {React.ReactNode} props.children - The subtree that will read auth state.
 */
export function AuthProvider({ children }) {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const token = localStorage.getItem("access_token");
        if (!token) {
            setLoading(false);
            return;
        }
        authApi
            .me()
            .then((res) => setUser(normalizeUser(res.data)))
            .catch(() => localStorage.removeItem("access_token"))
            .finally(() => setLoading(false));
    }, []);

    const login = async (email, password) => {
        const res = await authApi.login(email, password);
        localStorage.setItem("access_token", res.data.access_token);
        const meRes = await authApi.me();
        const normalized = normalizeUser(meRes.data);
        setUser(normalized);
        return normalized;
    };

    const logout = () => {
        localStorage.removeItem("access_token");
        setUser(null);
    };

    const refreshUser = async () => {
        const meRes = await authApi.me();
        const normalized = normalizeUser(meRes.data);
        setUser(normalized);
        return normalized;
    };

    return (
        <AuthContext.Provider value={{ user, role: user?.role, login, logout, refreshUser, loading }}>
            {children}
        </AuthContext.Provider>
    );
}

/**
 * Hook to read auth context. Returns null if used outside <AuthProvider>.
 *
 * @returns {{ user, role, login, logout, refreshUser, loading } | null}
 */
export function useAuth() {
    return useContext(AuthContext);
}
