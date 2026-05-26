/**
 * RoleRoute - renders children only if the current user has one of `allowedRoles`.
 * Otherwise shows an access denied state.
 */
import { Navigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

const ROLE_ALIAS = {
    Official: "Authority",
    official: "Authority",
};

function normalizeRole(role) {
    return ROLE_ALIAS[role] || role;
}

export default function RoleRoute({ allowedRoles, children }) {
    const { user, loading } = useAuth();
    if (loading) return <div style={{ padding: "2rem" }}>Loading...</div>;
    if (!user) return <Navigate to="/login" replace />;

    const userRole = normalizeRole(user.role);
    const allowed = new Set((allowedRoles || []).map(normalizeRole));

    if (!allowed.has(userRole)) {
        return (
            <div className="page">
                <h1>Access Denied</h1>
                <p>Your role ({userRole}) does not have access to this page.</p>
            </div>
        );
    }
    return children;
}
