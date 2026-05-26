/**
 * Citizen registration page.
 *
 * Public page at /register for self-service citizen signup. Validates the form
 * client-side (name/email present, password length >= 8, passwords match,
 * terms agreed) and calls authApi.register with role="Citizen". If an avatar
 * was selected, it follows the registration with a transient login → upload
 * avatar → drop the temp token, so the avatar is associated with the new
 * account before the user formally signs in. On success, swaps the form for a
 * confirmation card linking to /login. Avatar upload failures are swallowed —
 * registration is the primary outcome.
 */
import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { authApi } from "../api/client";
import { Camera, Eye, EyeOff } from "lucide-react";

/** Renders the citizen signup form (or success card after submission). */
export default function CitizenRegisterPage() {
    const navigate = useNavigate();
    const [form, setForm] = useState({ full_name: "", email: "", password: "", confirmPassword: "" });
    const [agreed, setAgreed] = useState(false);
    const [avatarFile, setAvatarFile] = useState(null);
    const [showPwd, setShowPwd] = useState(false);
    const [showConfirm, setShowConfirm] = useState(false);
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);
    const [success, setSuccess] = useState(false);

    const set = (field) => (e) => setForm((prev) => ({ ...prev, [field]: e.target.value }));

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError("");

        if (!form.full_name.trim()) { setError("Full name is required."); return; }
        if (!form.email.trim()) { setError("Email address is required."); return; }
        if (form.password.length < 8) { setError("Password must be at least 8 characters long."); return; }
        if (form.password !== form.confirmPassword) { setError("Passwords do not match."); return; }
        if (!agreed) { setError("You must agree to the Terms and Privacy Policy."); return; }

        setLoading(true);
        try {
            await authApi.register({
                full_name: form.full_name.trim(),
                email: form.email.trim(),
                password: form.password,
                role: "Citizen",
            });
            setSuccess(true);
            if (avatarFile) {
                try {
                    const loginRes = await authApi.login(form.email.trim(), form.password);
                    localStorage.setItem("access_token", loginRes.data.access_token);
                    await authApi.uploadAvatar(avatarFile);
                    localStorage.removeItem("access_token");
                } catch {
                    // Avatar upload failed — not critical, registration still succeeded
                }
            }
        } catch (err) {
            setError(err.response?.data?.detail || "Registration failed. Please try again.");
        } finally {
            setLoading(false);
        }
    };

    const handleClear = () => {
        setForm({ full_name: "", email: "", password: "", confirmPassword: "" });
        setAgreed(false);
        setError("");
    };

    if (success) {
        return (
            <div className="login-page">
                <div className="login-card">
                    <div className="login-card-body" style={{ textAlign: "center" }}>
                        <div className="login-icon" style={{ background: "#dcfce7", color: "#16a34a", fontSize: "1.5rem" }}>R</div>
                        <h1 className="login-title">Account Created</h1>
                        <p className="login-subtitle">Your citizen account has been created successfully. You can now sign in.</p>
                        <Link to="/login" className="btn btn-primary btn-block" style={{ padding: "0.75rem", fontSize: "1rem", background: "linear-gradient(135deg, #10b981, #059669)", borderColor: "transparent" }}>
                            Sign In
                        </Link>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="login-page">
            <div className="register-wrapper">
                <h1 className="register-heading">Create Account</h1>
                <p className="register-subheading">Join us to report and track road issues</p>

                <div className="login-card" style={{ maxWidth: "32rem" }}>
                    <div className="login-card-body">
                        <Link to="/" className="login-back">Back to Home</Link>
                        <form onSubmit={handleSubmit}>
                            <div className="form-group">
                                <label className="form-label">Full Name</label>
                                <input className="form-control" type="text" value={form.full_name} onChange={set("full_name")} placeholder="Your full name" />
                            </div>

                            <div className="form-group">
                                <label className="form-label">Email Address</label>
                                <input className="form-control" type="email" value={form.email} onChange={set("email")} placeholder="you@example.com" />
                            </div>

                            <div className="form-group">
                                <label className="form-label">Password</label>
                                <div className="pwd-wrap">
                                    <input className="form-control" type={showPwd ? "text" : "password"} value={form.password} onChange={set("password")} placeholder="Min. 8 characters" />
                                    <button type="button" className="pwd-toggle" onClick={() => setShowPwd(s => !s)}>{showPwd ? <EyeOff size={18} /> : <Eye size={18} />}</button>
                                </div>
                            </div>

                            <div className="form-group">
                                <label className="form-label">Confirm Password</label>
                                <div className="pwd-wrap">
                                    <input className="form-control" type={showConfirm ? "text" : "password"} value={form.confirmPassword} onChange={set("confirmPassword")} placeholder="Re-enter password" />
                                    <button type="button" className="pwd-toggle" onClick={() => setShowConfirm(s => !s)}>{showConfirm ? <EyeOff size={18} /> : <Eye size={18} />}</button>
                                </div>
                            </div>

                            <label className="register-checkbox-row">
                                <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
                                <span>I agree to the <Link to="/terms" target="_blank" rel="noopener noreferrer"><strong>Terms</strong></Link> and <Link to="/privacy" target="_blank" rel="noopener noreferrer"><strong>Privacy Policy</strong></Link></span>
                            </label>

                            {error && (
                                <div className="badge badge-danger mb-4" style={{ width: "100%", justifyContent: "center", padding: "0.625rem", fontSize: "0.85rem" }}>
                                    {error}
                                </div>
                            )}

                            <div style={{ textAlign: "center", marginBottom: "1rem" }}>
                                <label style={{ display: "inline-block", cursor: "pointer" }}>
                                    <div style={{ width: 72, height: 72, borderRadius: "50%", background: "#f1f5f9", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 0.5rem", border: "2px dashed #cbd5e1", overflow: "hidden" }}>
                                        {avatarFile ? (
                                            <img src={URL.createObjectURL(avatarFile)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                                        ) : (
                                            <Camera size={24} style={{ color: "#94a3b8" }} />
                                        )}
                                    </div>
                                    <span style={{ fontSize: "0.82rem", color: "#64748b" }}>Profile Photo (optional)</span>
                                    <input type="file" accept="image/jpeg,image/png,image/webp" style={{ display: "none" }} onChange={(e) => setAvatarFile(e.target.files?.[0] || null)} />
                                </label>
                            </div>

                            <div className="register-btn-row">
                                <button type="submit" className="btn btn-primary" disabled={loading} style={{ flex: 1, padding: "0.75rem", fontSize: "1rem", background: "linear-gradient(135deg, #10b981, #059669)", borderColor: "transparent" }}>
                                    {loading ? "Creating..." : "Create Account"}
                                </button>
                                <button type="button" className="btn btn-outline" onClick={handleClear} style={{ padding: "0.75rem" }}>
                                    Clear
                                </button>
                            </div>
                        </form>
                    </div>
                </div>

                <div className="register-footer-links">
                    <span>Already have an account? <Link to="/login"><strong>Sign in</strong></Link></span>
                    <span>Government official? <Link to="/register/official"><strong>Register here</strong></Link></span>
                </div>
            </div>
        </div>
    );
}
