/**
 * Admin authority approval page.
 *
 * Admin-only queue of pending Authority registrations awaiting approval.
 * Each row shows the applicant's organisation and jurisdiction; approve and
 * reject actions write to the authority profile's approval_status. Reachable
 * via /admin/approval and the legacy alias /admin/officials/verify.
 */
import { useState, useEffect, useMemo } from "react";
import { ShieldCheck, Eye, X, Check, ChevronLeft, ChevronRight } from "lucide-react";
import { adminApi } from "../api/client";

function timeAgo(dateStr) {
    if (!dateStr) return "";
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "Just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days} day${days !== 1 ? "s" : ""} ago`;
}

function getInitials(name) {
    if (!name) return "?";
    return name.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2);
}

export default function AdminApprovalPage() {
    const [profiles, setProfiles] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [selectedId, setSelectedId] = useState(null);
    const [actionStates, setActionStates] = useState({});
    const [currentPage, setCurrentPage] = useState(1);

    useEffect(() => {
        adminApi
            .pendingAuthorities()
            .then((res) => setProfiles(res.data || []))
            .catch(() => setError("Failed to load pending authorities."))
            .finally(() => setLoading(false));
    }, []);

    const PAGE_SIZE = 4;
    const selected = profiles.find(p => p.user_id === selectedId) || null;
    const totalPages = Math.max(1, Math.ceil(profiles.length / PAGE_SIZE));
    const paginatedProfiles = useMemo(() => {
        const start = (currentPage - 1) * PAGE_SIZE;
        return profiles.slice(start, start + PAGE_SIZE);
    }, [profiles, currentPage]);

    function getVisiblePages() {
        if (totalPages <= 3) return Array.from({ length: totalPages }, (_, i) => i + 1);
        if (currentPage <= 2) return [1, 2, 3];
        if (currentPage >= totalPages - 1) return [totalPages - 2, totalPages - 1, totalPages];
        return [currentPage - 1, currentPage, currentPage + 1];
    }

    const review = async (userId, approvalStatus) => {
        setActionStates((prev) => ({ ...prev, [userId]: "loading" }));
        try {
            await adminApi.approve(userId, { approval_status: approvalStatus });
            setProfiles((prev) => prev.filter((p) => p.user_id !== userId));
            setActionStates((prev) => ({ ...prev, [userId]: "done" }));
            if (selectedId === userId) setSelectedId(null);
        } catch {
            setActionStates((prev) => ({ ...prev, [userId]: "error" }));
        }
    };

    if (loading) {
        return <div className="page"><p>Loading...</p></div>;
    }

    return (
        <div className="vo-page">
            <div className="vo-header">
                <h1 className="vo-title"><ShieldCheck size={24} /> Official Verification</h1>
                <p className="vo-sub">Review and verify pending officials</p>
            </div>

            {error && <p className="error">{error}</p>}

            <div className="vo-layout">
                {/* ── Left: Pending Officials List ── */}
                <div className="vo-list-card">
                    <h2 className="vo-list-title">Pending Officials ({profiles.length})</h2>

                    {profiles.length === 0 && !error ? (
                        <div className="vo-empty">No pending official registrations</div>
                    ) : (
                        <>
                            <div className="vo-table-wrap">
                                <table className="vo-table">
                                    <thead>
                                        <tr>
                                            <th>Organisation</th>
                                            <th>Jurisdiction</th>
                                            <th>Submitted</th>
                                            <th></th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {paginatedProfiles.map((p) => (
                                            <tr key={p.user_id} className={`vo-row ${selectedId === p.user_id ? "vo-row-active" : ""}`}>
                                                <td>
                                                    <div className="vo-org-cell">
                                                        <div className="vo-org-avatar">{getInitials(p.organisation)}</div>
                                                        <div>
                                                            <strong>{p.organisation || "Unknown"}</strong>
                                                            <span>{p.email || ""}</span>
                                                            <span className="vo-org-id">ID: {p.user_id}</span>
                                                        </div>
                                                    </div>
                                                </td>
                                                <td><span className="vo-jurisdiction">{p.jurisdiction_area || "N/A"}</span></td>
                                                <td>
                                                    <div>
                                                        <strong>{p.submitted_at ? new Date(p.submitted_at).toLocaleDateString() : "—"}</strong>
                                                        <span className="vo-time-ago">{timeAgo(p.submitted_at)}</span>
                                                    </div>
                                                </td>
                                                <td>
                                                    <button className="vo-review-btn" onClick={() => setSelectedId(prev => prev === p.user_id ? null : p.user_id)}>
                                                        <Eye size={14} /> Review
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                            {totalPages > 1 && (
                                <div className="ref-pagination" style={{ margin: "1.25rem auto 1.5rem" }}>
                                    <button className="ref-page-link" disabled={currentPage === 1} onClick={() => setCurrentPage(p => p - 1)}>
                                        <ChevronLeft size={16} /> Prev
                                    </button>
                                    {getVisiblePages().map(p => (
                                        <button key={p} className={`ref-page-num${p === currentPage ? " active" : ""}`} onClick={() => setCurrentPage(p)}>{p}</button>
                                    ))}
                                    <button className="ref-page-link" disabled={currentPage === totalPages} onClick={() => setCurrentPage(p => p + 1)}>
                                        Next <ChevronRight size={16} />
                                    </button>
                                </div>
                            )}
                        </>
                    )}
                </div>

                {/* ── Right: Verification Details Panel ── */}
                {selected && (
                    <div className="vo-detail-card">
                        <div className="vo-detail-head">
                            <h2>Verification Details</h2>
                            <span className="vo-pending-badge">PENDING</span>
                        </div>

                        <div className="vo-detail-profile">
                            <div className="vo-detail-avatar">{getInitials(selected.organisation)}</div>
                            <div>
                                <strong className="vo-detail-org">{selected.organisation || "Unknown"}</strong>
                                <span className="vo-detail-email">{selected.email || ""}</span>
                                <div className="vo-detail-name">{selected.full_name || "—"}</div>
                                <span className="vo-detail-uid">User ID: {selected.user_id}</span>
                            </div>
                        </div>

                        <h3 className="vo-info-title">Information</h3>
                        <div className="vo-info-table">
                            <div className="vo-info-row">
                                <span>Full Name</span>
                                <strong>{selected.full_name || "N/A"}</strong>
                            </div>
                            <div className="vo-info-row">
                                <span>Organisation</span>
                                <strong>{selected.organisation || "N/A"}</strong>
                            </div>
                            <div className="vo-info-row">
                                <span>Jurisdiction</span>
                                <strong>{selected.jurisdiction_area || "N/A"}</strong>
                            </div>
                            {selected.full_name && (
                                <div className="vo-info-row">
                                    <span>Full Name</span>
                                    <strong>{selected.full_name}</strong>
                                </div>
                            )}
                            <div className="vo-info-row">
                                <span>Submitted</span>
                                <strong>{selected.submitted_at ? `${new Date(selected.submitted_at).toLocaleDateString()}, ${new Date(selected.submitted_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "—"}</strong>
                            </div>
                            <div className="vo-info-row">
                                <span>Contact Email</span>
                                <strong>{selected.email || "N/A"}</strong>
                            </div>
                        </div>

                        {actionStates[selected.user_id] === "error" && (
                            <p className="error" style={{ marginTop: "0.75rem" }}>Action failed. Please try again.</p>
                        )}

                        <div className="vo-detail-actions">
                            <button
                                className="vo-action-reject"
                                onClick={() => review(selected.user_id, "Rejected")}
                                disabled={actionStates[selected.user_id] === "loading"}
                            >
                                <X size={16} /> Reject
                            </button>
                            <button
                                className="vo-action-approve"
                                onClick={() => review(selected.user_id, "Approved")}
                                disabled={actionStates[selected.user_id] === "loading"}
                            >
                                <Check size={16} /> Approve
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
