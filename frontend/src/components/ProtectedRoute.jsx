/**
 * ProtectedRoute - redirects to /login if user is not authenticated.
 */
import { Navigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

export default function ProtectedRoute({ children }) {
    const { user, loading } = useAuth();
    if (loading) return <div style={{ padding: "2rem" }}>Loading...</div>;
    if (!user) return <Navigate to="/login" replace />;
    return children;
}
