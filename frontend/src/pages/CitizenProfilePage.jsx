/**
 * Citizen profile / account-settings page.
 *
 * Citizen-only screen for viewing and editing the signed-in user's display
 * details: avatar (uploaded via authApi.uploadAvatar), full name, email
 * (read-only), and an optional phone number. Name and phone are persisted
 * server-side via authApi.updateMe (PATCH /api/auth/me) so they sync across
 * devices. The Change Password form is intentionally a stub — submission
 * shows "Password change is not available in this version" and never calls
 * the backend.
 */

import { useEffect, useRef, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { authApi } from "../api/client";
import { Camera, CheckCircle2, Eye, EyeOff } from "lucide-react";

/** Citizen profile and account-settings page. */
export default function CitizenProfilePage() {
    const { user, refreshUser } = useAuth();

    const [fullName, setFullName] = useState("");
    const [phone, setPhone] = useState("");
    const [currentPassword, setCurrentPassword] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [showPwd, setShowPwd] = useState(false);
    const [message, setMessage] = useState("");
    const [avatarPreview, setAvatarPreview] = useState(null);
    const [saving, setSaving] = useState(false);
    // Inline "Profile saved" indicator next to the Save button — matches the
    // Authority profile so the feedback pattern is consistent across roles
    // (Admin uses this page too, so the indicator lands there as well).
    const [savedIndicator, setSavedIndicator] = useState(false);
    const savedTimerRef = useRef(null);

    const flashSavedIndicator = () => {
        setSavedIndicator(true);
        if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
        savedTimerRef.current = setTimeout(() => setSavedIndicator(false), 4000);
    };

    useEffect(() => {
        // Seed the form from the authenticated user object. Both fields are
        // backed by `users` MongoDB columns (full_name and phone_number).
        setFullName(user?.full_name || "");
        setPhone(user?.phone_number || "");
    }, [user]);

    const saveProfile = async (e) => {
        e.preventDefault();
        if (!fullName.trim()) { setMessage("Full name cannot be empty."); return; }
        setSaving(true);
        setMessage("");
        try {
            await authApi.updateMe({
                full_name: fullName.trim(),
                phone_number: phone.trim(),
            });
            // Success feedback is the inline green indicator next to the
            // button only — the top blue card is reserved for errors so we
            // don't show the same "saved" status twice.
            flashSavedIndicator();
            if (refreshUser) refreshUser().catch(() => {});
        } catch (err) {
            setMessage(err.response?.data?.detail || "Failed to save profile.");
        } finally {
            setSaving(false);
        }
    };

    const changePassword = (e) => {
        e.preventDefault();
        if (!currentPassword || !newPassword || !confirmPassword) { setMessage("Fill all password fields first."); return; }
        if (newPassword !== confirmPassword) { setMessage("New password and confirmation do not match."); return; }
        setCurrentPassword(""); setNewPassword(""); setConfirmPassword("");
        setMessage("Password change is not available in this version.");
    };

    return (
        <div className="page" style={{ maxWidth: "none", margin: 0 }}>
            <style>{`
                .profile-inner { max-width: 700px; }
                .profile-card { overflow: visible !important; }
                .profile-card .btn-block {
                    max-width: none !important;
                    width: auto !important;
                    display: inline-block !important;
                    padding: 14px 28px !important;
                    border-radius: 32px !important;
                }
            `}</style>

            <div className="page-banner" style={{ background: "#eaf0fa", color: "#1e293b", marginBottom: "1rem" }}>
                <h1 className="banner-title" style={{ color: "#1e293b" }}>Profile Settings</h1>
                <p className="banner-subtitle" style={{ color: "#64748b" }}>Manage your account settings and preferences</p>
            </div>

            {message && (
                <div className="card" style={{ marginBottom: "1rem" }}>
                    <div className="card-content" style={{ color: "#1d4ed8", fontWeight: 600 }}>{message}</div>
                </div>
            )}

            {/* Profile Picture */}
            <div className="card profile-card" style={{ marginBottom: "1rem" }}>
                <div className="card-content">
                    <h2 style={{ marginTop: 0 }}>Profile Picture</h2>
                    <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
                        <label style={{ cursor: "pointer", position: "relative" }}>
                            {avatarPreview || user?.avatar_path ? (
                                <img src={avatarPreview || user.avatar_path} alt="" style={{ width: 72, height: 72, borderRadius: "50%", objectFit: "cover" }} />
                            ) : (
                                <div className="topbar-avatar" style={{ width: 72, height: 72, fontSize: "1.5rem" }}>
                                    {(user?.full_name || "U").charAt(0).toUpperCase()}
                                </div>
                            )}
                            <div style={{ position: "absolute", bottom: 0, right: 0, background: "#fff", borderRadius: "50%", padding: 4, boxShadow: "0 1px 3px rgba(0,0,0,0.2)" }}>
                                <Camera size={14} style={{ color: "#64748b" }} />
                            </div>
                            <input type="file" accept="image/jpeg,image/png,image/webp" style={{ display: "none" }} onChange={async (e) => {
                                const file = e.target.files?.[0];
                                if (!file) return;
                                setAvatarPreview(URL.createObjectURL(file));
                                try { await authApi.uploadAvatar(file); setMessage("Profile picture updated."); }
                                catch { setMessage("Failed to upload profile picture."); }
                            }} />
                        </label>
                        <div>
                            <div style={{ fontWeight: 700, fontSize: "1.1rem" }}>{user?.full_name || "Citizen"}</div>
                            <div className="text-muted">{user?.email}</div>
                            <div className="text-muted" style={{ fontSize: "0.78rem", marginTop: "0.15rem" }}>Click photo to change. JPG, PNG or WEBP (max 10MB)</div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Personal Information */}
            <div className="card profile-card" style={{ marginBottom: "1rem" }}>
                <div className="card-content">
                    <div className="profile-inner">
                        <h2 style={{ marginTop: 0 }}>Personal Information</h2>
                        <form onSubmit={saveProfile}>
                            <div className="form-group">
                                <label className="form-label">Full Name</label>
                                <input className="form-control" value={fullName} onChange={(e) => setFullName(e.target.value)} />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Email Address</label>
                                <input className="form-control" value={user?.email || ""} disabled />
                                <div className="form-hint">Email cannot be changed.</div>
                            </div>
                            <div className="form-group">
                                <label className="form-label">Phone Number (Optional)</label>
                                <input className="form-control" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Enter phone number" />
                            </div>
                            <div style={{ display: "flex", alignItems: "center", gap: "1rem", marginTop: "0.5rem", flexWrap: "wrap" }}>
                                <button type="submit" className="btn btn-primary btn-block" disabled={saving}>{saving ? "Saving..." : "Save Changes"}</button>
                                {savedIndicator && (
                                    <span style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", color: "#16a34a", fontWeight: 600 }}>
                                        <CheckCircle2 size={18} />
                                        Profile saved
                                    </span>
                                )}
                            </div>
                        </form>
                    </div>
                </div>
            </div>

            {/* Change Password */}
            <div className="card profile-card">
                <div className="card-content">
                    <div className="profile-inner">
                        <h2 style={{ marginTop: 0 }}>Change Password</h2>
                        <form onSubmit={changePassword}>
                            <div className="form-group">
                                <label className="form-label">Current Password</label>
                                <div className="pwd-wrap">
                                    <input type={showPwd ? "text" : "password"} className="form-control" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
                                    <button type="button" className="pwd-toggle" onClick={() => setShowPwd(s => !s)}>{showPwd ? <EyeOff size={18} /> : <Eye size={18} />}</button>
                                </div>
                            </div>
                            <div className="form-group">
                                <label className="form-label">New Password</label>
                                <input type="password" className="form-control" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Confirm New Password</label>
                                <input type="password" className="form-control" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
                            </div>
                            <button type="submit" className="btn btn-primary btn-block">Change Password</button>
                        </form>
                    </div>
                </div>
            </div>
        </div>
    );
}
