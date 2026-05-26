/**
 * Authority/Official registration page.
 *
 * Public page at /register/official for government-employee signup. Collects
 * the standard citizen fields plus employee_id, organisation, jurisdiction
 * area, and phone, and posts them via authApi.register with role="Authority".
 * The created account is non-active until an Admin approves it, so on success
 * the page shows a "pending approval" confirmation rather than auto-routing
 * to /login. Optional avatar upload follows the same temp-login-then-upload
 * pattern used by the citizen flow.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { authApi } from "../api/client";
import { Camera, Eye, EyeOff } from "lucide-react";

/** Renders the official signup form (or pending-approval card on success). */
export default function OfficialRegisterPage() {
    const [form, setForm] = useState({
        full_name: "",
        employee_id: "",
        email: "",
        phone_number: "",
        organisation: "",
        jurisdiction_area: "",
        password: "",
        confirmPassword: "",
    });
    const [certify, setCertify] = useState(false);
    const [avatarFile, setAvatarFile] = useState(null);
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);
    const [success, setSuccess] = useState(false);
    const [showPwd, setShowPwd] = useState(false);
    const [showConfirm, setShowConfirm] = useState(false);

    const set = (field) => (e) => setForm((prev) => ({ ...prev, [field]: e.target.value }));

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError("");

        if (!form.full_name.trim()) { setError("Full name is required."); return; }
        if (!form.employee_id.trim()) { setError("Employee ID is required."); return; }
        if (!form.email.trim()) { setError("Official email is required."); return; }
        if (!form.organisation.trim()) { setError("Organisation is required."); return; }
        if (!form.jurisdiction_area.trim()) { setError("Jurisdiction area is required."); return; }
        if (form.password.length < 8) { setError("Password must be at least 8 characters long."); return; }
        if (form.password !== form.confirmPassword) { setError("Passwords do not match."); return; }
        if (!certify) { setError("You must certify that you are a government official."); return; }

        setLoading(true);
        try {
            await authApi.register({
                full_name: form.full_name.trim(),
                email: form.email.trim(),
                password: form.password,
                role: "Authority",
                employee_id: form.employee_id.trim(),
                phone_number: form.phone_number.trim() || undefined,
                organisation: form.organisation.trim(),
                jurisdiction_area: form.jurisdiction_area.trim(),
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
        setForm({
            full_name: "", employee_id: "", email: "", phone_number: "",
            organisation: "", jurisdiction_area: "", password: "", confirmPassword: "",
        });
        setCertify(false);
        setError("");
    };

    if (success) {
        return (
            <div className="login-page">
                <div className="login-card" style={{ maxWidth: "32rem" }}>
                    <div className="login-card-body" style={{ textAlign: "center" }}>
                        <div className="login-icon" style={{ background: "#fef3c7", color: "#d97706", fontSize: "1.5rem" }}>R</div>
                        <h1 className="login-title">Registration Submitted</h1>
                        <p className="login-subtitle" style={{ marginBottom: "1rem" }}>
                            Your official account registration has been submitted and is pending admin approval.
                            You will be able to sign in once your account has been reviewed and approved.
                        </p>
                        <Link to="/login" className="btn btn-primary btn-block" style={{ padding: "0.75rem", fontSize: "1rem", background: "linear-gradient(135deg, #10b981, #059669)", borderColor: "transparent" }}>
                            Back to Sign In
                        </Link>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="login-page">
            <div className="register-wrapper">
                <h1 className="register-heading">Official Registration</h1>
                <p className="register-subheading">Register as a government official to manage road infrastructure</p>

                <div className="login-card" style={{ maxWidth: "36rem" }}>
                    <div className="login-card-body">
                        <Link to="/" className="login-back">Back to Home</Link>
                        <form onSubmit={handleSubmit}>
                            <div className="register-row">
                                <div className="form-group" style={{ flex: 1 }}>
                                    <label className="form-label">Full Name</label>
                                    <input className="form-control" type="text" value={form.full_name} onChange={set("full_name")} placeholder="Your full name" />
                                </div>
                                <div className="form-group" style={{ flex: 1 }}>
                                    <label className="form-label">Employee ID</label>
                                    <input className="form-control" type="text" value={form.employee_id} onChange={set("employee_id")} placeholder="e.g. GOV1234" />
                                </div>
                            </div>

                            <div className="register-row">
                                <div className="form-group" style={{ flex: 1 }}>
                                    <label className="form-label">Official Email</label>
                                    <input className="form-control" type="email" value={form.email} onChange={set("email")} placeholder="you@agency.gov" />
                                </div>
                                <div className="form-group" style={{ flex: 1 }}>
                                    <label className="form-label">Phone Number</label>
                                    <input className="form-control" type="tel" value={form.phone_number} onChange={set("phone_number")} placeholder="e.g. 0501234567" />
                                </div>
                            </div>

                            <div className="register-row">
                                <div className="form-group" style={{ flex: 1 }}>
                                    <label className="form-label">Organisation</label>
                                    <input className="form-control" type="text" value={form.organisation} onChange={set("organisation")} placeholder="e.g. Public Works Department" />
                                </div>
                                <div className="form-group" style={{ flex: 1 }}>
                                    <label className="form-label">Jurisdiction Area</label>
                                    <input className="form-control" type="text" value={form.jurisdiction_area} onChange={set("jurisdiction_area")} placeholder="e.g. North District" />
                                </div>
                            </div>

                            <div className="register-row">
                                <div className="form-group" style={{ flex: 1 }}>
                                    <label className="form-label">Password</label>
                                    <div className="pwd-wrap">
                                        <input className="form-control" type={showPwd ? "text" : "password"} value={form.password} onChange={set("password")} placeholder="Min. 8 characters" />
                                        <button type="button" className="pwd-toggle" onClick={() => setShowPwd(s => !s)}>{showPwd ? <EyeOff size={18} /> : <Eye size={18} />}</button>
                                    </div>
                                </div>
                                <div className="form-group" style={{ flex: 1 }}>
                                    <label className="form-label">Confirm Password</label>
                                    <div className="pwd-wrap">
                                        <input className="form-control" type={showConfirm ? "text" : "password"} value={form.confirmPassword} onChange={set("confirmPassword")} placeholder="Re-enter password" />
                                        <button type="button" className="pwd-toggle" onClick={() => setShowConfirm(s => !s)}>{showConfirm ? <EyeOff size={18} /> : <Eye size={18} />}</button>
                                    </div>
                                </div>
                            </div>

                            <label className="register-checkbox-row" style={{ whiteSpace: "nowrap" }}>
                                <input type="checkbox" checked={certify} onChange={(e) => setCertify(e.target.checked)} />
                                <span>I certify that I am a government official and agree to the <Link to="/terms" target="_blank" rel="noopener noreferrer"><strong>Terms</strong></Link> and <Link to="/privacy" target="_blank" rel="noopener noreferrer"><strong>Privacy Policy</strong></Link></span>
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
                                    {loading ? "Submitting..." : "Register as Official"}
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
                    <span>Are you a citizen? <Link to="/register"><strong>Register here</strong></Link></span>
                </div>
            </div>
        </div>
    );
}
