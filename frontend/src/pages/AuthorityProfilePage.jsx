/**
 * Authority profile / account-settings page.
 *
 * Authority/Admin self-service profile editor. Standard user fields
 * (full_name, phone_number, employee_id) are saved via authApi.updateMe
 * against the `users` collection. Authority-specific fields (department,
 * designation, zone preference) are saved via
 * authorityApi.updateMyAuthorityProfile against the `authority_profiles`
 * collection. The displayed "Zone Assignment" field is read-only and reflects
 * the canonical team-zone from authorityApi.myTeam(); the editable `zone`
 * preference on the profile is a fallback label that survives when no team
 * exists. The Change Password form is intentionally a stub in this version.
 */

import { useEffect, useRef, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { authApi, authorityApi } from "../api/client";
import { Camera, CheckCircle2, Eye, EyeOff } from "lucide-react";

/** Authority profile and account-settings page. */
export default function AuthorityProfilePage() {
    const { user, refreshUser } = useAuth();

    const [fullName, setFullName] = useState("");
    const [phone, setPhone] = useState("");
    const [employeeId, setEmployeeId] = useState("");
    const [department, setDepartment] = useState("Public Works Department");
    const [designation, setDesignation] = useState("Field Officer");
    const [zone, setZone] = useState("");
    const [message, setMessage] = useState("");
    const [avatarPreview, setAvatarPreview] = useState(null);
    const [saving, setSaving] = useState(false);
    // Inline "Saved!" indicator next to the Save button. The card-style
    // message at the top of the page is easy to miss because the Save button
    // sits at the bottom of a long form, so this gives the user immediate
    // feedback right where they clicked. Auto-clears after 4 s.
    const [savedIndicator, setSavedIndicator] = useState(false);
    const savedTimerRef = useRef(null);

    // Password
    const [currentPassword, setCurrentPassword] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [showPwd, setShowPwd] = useState(false);

    // Team info
    const [teamInfo, setTeamInfo] = useState(null);

    useEffect(() => {
        // user fields (full_name / phone_number / employee_id) come from the
        // auth context; authority-specific fields (department / designation /
        // zone preference) come from the authority_profiles collection.
        setFullName(user?.full_name || "Authority");
        setPhone(user?.phone_number || "");
        setEmployeeId(user?.employee_id || "");

        authorityApi.getMyAuthorityProfile()
            .then((res) => {
                const p = res.data || {};
                setDepartment(p.department || "Public Works Department");
                setDesignation(p.designation || "Field Officer");
                setZone(p.zone || "");
            })
            .catch(() => {
                // Non-Authority users (Admin) have no authority_profile; keep defaults.
            });

        authorityApi.myTeam().then((res) => setTeamInfo(res.data)).catch(() => {});
    }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

    const flashSavedIndicator = () => {
        setSavedIndicator(true);
        if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
        savedTimerRef.current = setTimeout(() => setSavedIndicator(false), 4000);
    };

    const saveProfile = async (e) => {
        e.preventDefault();
        if (!fullName.trim()) { setMessage("Full name cannot be empty."); return; }
        setSaving(true);
        setMessage("");
        try {
            // Update standard user fields first (must succeed).
            await authApi.updateMe({
                full_name: fullName.trim(),
                phone_number: phone.trim(),
                employee_id: employeeId.trim(),
            });
            // Authority-specific fields are best-effort: Admin users hitting
            // this page have no authority_profile (404) and that's fine.
            try {
                await authorityApi.updateMyAuthorityProfile({
                    department, designation, zone,
                });
            } catch { /* 404 for non-Authority users; not a save failure */ }

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
        if (newPassword !== confirmPassword) { setMessage("Passwords do not match."); return; }
        if (newPassword.length < 8) { setMessage("Password must be at least 8 characters."); return; }
        setMessage("Password change is not available in this version.");
        setCurrentPassword(""); setNewPassword(""); setConfirmPassword("");
    };

    return (
        <div className="page" style={{ maxWidth: "none", margin: 0 }}>
            <style>{`
                .auth-profile-inner { max-width: 700px; }
                .auth-profile-section { overflow: visible !important; }
                .auth-profile-section .btn-block {
                    max-width: none !important;
                    width: auto !important;
                    display: inline-block !important;
                    padding: 14px 28px !important;
                    border-radius: 32px !important;
                }
            `}</style>
            <div className="page-banner" style={{ background: "#eaf0fa", color: "#1e293b", marginBottom: "1rem" }}>
                <h1 className="banner-title" style={{ color: "#1e293b" }}>My Profile</h1>
                <p className="banner-subtitle" style={{ color: "#64748b" }}>Manage your account settings and preferences</p>
            </div>

            {message && (
                <div className="card" style={{ marginBottom: "1rem" }}>
                    <div className="card-content" style={{ color: "#1d4ed8", fontWeight: 600 }}>{message}</div>
                </div>
            )}

            {/* Profile Picture */}
            <div className="card auth-profile-section" style={{ marginBottom: "1rem" }}>
                <div className="card-content">
                    <h2 style={{ marginTop: 0 }}>Profile Picture</h2>
                    <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
                        <label style={{ cursor: "pointer", position: "relative" }}>
                            {avatarPreview || user?.avatar_path ? (
                                <img src={avatarPreview || user.avatar_path} alt="" style={{ width: 72, height: 72, borderRadius: "50%", objectFit: "cover" }} />
                            ) : (
                                <div className="topbar-avatar" style={{ width: 72, height: 72, fontSize: "1.5rem" }}>
                                    {(fullName || "A").charAt(0).toUpperCase()}
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
                            <div style={{ fontWeight: 700, fontSize: "1.1rem" }}>{fullName}</div>
                            <div className="text-muted">{user?.email}</div>
                            {teamInfo && (
                                <div className="text-muted" style={{ fontSize: "0.82rem", marginTop: "0.2rem" }}>
                                    {teamInfo.team?.name} · {teamInfo.zone} {teamInfo.is_leader && "· Team Leader"}
                                </div>
                            )}
                            <div className="text-muted" style={{ fontSize: "0.78rem", marginTop: "0.15rem" }}>Click photo to change. JPG, PNG or WEBP (max 10MB)</div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Personal Information */}
            <div className="card auth-profile-section" style={{ marginBottom: "1rem" }}>
                <div className="card-content">
                    <div className="auth-profile-inner">
                    <h2 style={{ marginTop: 0 }}>Personal Information</h2>
                    <form onSubmit={saveProfile}>
                        <div className="grid grid-cols-2" style={{ gap: "1rem" }}>
                            <div className="form-group">
                                <label className="form-label">Full Name</label>
                                <input className="form-control" value={fullName} onChange={(e) => setFullName(e.target.value)} />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Email Address</label>
                                <input className="form-control" value={user?.email || ""} disabled />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Phone Number</label>
                                <input className="form-control" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Enter phone number" />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Employee ID</label>
                                <input className="form-control" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} placeholder="Enter employee ID" />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Department</label>
                                <input className="form-control" value={department} onChange={(e) => setDepartment(e.target.value)} />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Designation</label>
                                <input className="form-control" value={designation} onChange={(e) => setDesignation(e.target.value)} />
                            </div>
                            <div className="form-group" style={{ gridColumn: "1 / -1" }}>
                                <label className="form-label">Zone Assignment</label>
                                <input className="form-control" value={teamInfo?.zone || zone} disabled style={{ background: "var(--surface)" }} />
                                <div className="form-hint">Zone is assigned by Admin.</div>
                            </div>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: "1rem", marginTop: "1rem", flexWrap: "wrap" }}>
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
            <div className="card auth-profile-section">
                <div className="card-content">
                    <div className="auth-profile-inner">
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
