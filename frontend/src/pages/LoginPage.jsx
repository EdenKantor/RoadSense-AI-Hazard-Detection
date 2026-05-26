/**
 * Login page.
 *
 * Public-facing sign-in form at /login for any registered user (Citizen,
 * Authority, Admin). Submits credentials through AuthContext.login (which
 * stores the JWT and hydrates the user) and then role-routes the user:
 * Admin → /admin/dashboard, Authority → /authority/dashboard, otherwise
 * → /uploads/mine. Surfaces backend "detail" error strings inline and
 * supports a show/hide password toggle. Also links to the citizen and
 * official registration pages.
 */
import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { Eye, EyeOff } from "lucide-react";

/** Renders the credentials form and handles role-based post-login redirect. */
export default function LoginPage() {
    const { login } = useAuth();
    const navigate = useNavigate();
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [showPassword, setShowPassword] = useState(false);
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (event) => {
        event.preventDefault();
        setError("");
        setLoading(true);
        try {
            const user = await login(email, password);
            if (user.role === "Admin") navigate("/admin/dashboard");
            else if (user.role === "Authority") navigate("/authority/dashboard");
            else navigate("/uploads/mine");
        } catch (err) {
            setError(err.response?.data?.detail || "Login failed.");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="login-page">
            <div className="login-card">
                <div className="login-card-body">
                    <Link to="/" className="login-back">
                        Back to Home
                    </Link>

                    <div className="login-icon">A</div>
                    <h1 className="login-title">RoadSenseAI Portal</h1>
                    <p className="login-subtitle">Enter your credentials to access the dashboard</p>

                    <form onSubmit={handleSubmit}>
                        <div className="form-group">
                            <label className="form-label">Email</label>
                            <input
                                className="form-control"
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                required
                                placeholder="user@example.com"
                            />
                        </div>
                        <div className="form-group mb-6">
                            <label className="form-label">Password</label>
                            <div className="pwd-wrap">
                                <input
                                    className="form-control"
                                    type={showPassword ? "text" : "password"}
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    required
                                    placeholder="********"
                                />
                                <button type="button" className="pwd-toggle" onClick={() => setShowPassword(s => !s)} aria-label={showPassword ? "Hide password" : "Show password"}>
                                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                                </button>
                            </div>
                        </div>

                        {error && (
                            <div className="badge badge-danger mb-4" style={{ width: "100%", justifyContent: "center", padding: "0.625rem", fontSize: "0.85rem" }}>
                                {error}
                            </div>
                        )}

                        <button type="submit" className="btn btn-primary btn-block" disabled={loading} style={{ padding: "0.75rem", fontSize: "1rem", background: "linear-gradient(135deg, #10b981, #059669)", borderColor: "transparent" }}>
                            {loading ? "Signing in..." : "Sign In"}
                        </button>
                    </form>

                    <div className="login-footer">
                        <div style={{ marginBottom: "0.5rem" }}>
                            Don't have an account? <Link to="/register" style={{ color: "#059669", fontWeight: 600 }}>Create Account</Link>
                        </div>
                        <div>
                            Government official? <Link to="/register/official" style={{ color: "#059669", fontWeight: 600 }}>Register here</Link>
                        </div>
                    </div>
                </div>
            </div>

            <p style={{ position: "fixed", bottom: "1.5rem", left: "50%", transform: "translateX(-50%)", color: "rgba(255,255,255,0.5)", fontSize: "0.8rem" }}>
                This area is restricted to authorized personnel only
            </p>
        </div>
    );
}
