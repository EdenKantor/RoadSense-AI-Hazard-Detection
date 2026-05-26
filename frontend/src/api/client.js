/**
 * Axios-based API client and convenience namespaces.
 *
 * Exports a default `api` instance plus six grouped namespaces:
 *   - authApi        : login, register, current user, avatar
 *   - uploadsApi     : citizen upload submission, status, comments, notes
 *   - supportApi     : help-center support tickets
 *   - eventsApi      : public events list (used by the shared map)
 *   - authorityApi   : authority-side event management, analytics, team
 *   - adminApi       : admin stats, users, approvals, zones, teams
 *
 * All requests share two interceptors:
 *   1. Request: attach `Authorization: Bearer <token>` if access_token is
 *      present in localStorage.
 *   2. Response: on 401, clear the token and redirect to /login — except when
 *      the failing call is /auth/login itself (so wrong-credential errors
 *      stay on the login form instead of triggering a reload).
 */
import axios from "axios";

const api = axios.create({
    baseURL: "/api",
});

// Attach token if present
api.interceptors.request.use((config) => {
    const token = localStorage.getItem("access_token");
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
});

// Auto-redirect on 401 — but ONLY for token-bearing requests whose token has
// expired. A 401 from the login endpoint itself means "wrong credentials" and
// should be displayed in-form by the LoginPage, not trigger a page reload that
// wipes the error message.
api.interceptors.response.use(
    (res) => res,
    (err) => {
        if (err.response?.status === 401) {
            const url = err.config?.url || "";
            const isLoginAttempt = url.includes("/auth/login");
            if (!isLoginAttempt) {
                localStorage.removeItem("access_token");
                window.location.href = "/login";
            }
        }
        return Promise.reject(err);
    }
);

export default api;

// Convenience methods

/**
 * Auth endpoints: login (form-encoded per OAuth2 password flow), current
 * user lookup, profile patch, registration, and avatar upload.
 */
export const authApi = {
    login: (email, password) => {
        const form = new URLSearchParams();
        form.append("username", email);
        form.append("password", password);
        return api.post("/auth/login", form, {
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
        });
    },
    me: () => api.get("/auth/me"),
    updateMe: (data) => api.patch("/auth/me", data),
    register: (data) => api.post("/auth/register", data),
    uploadAvatar: (file) => {
        const form = new FormData();
        form.append("file", file);
        return api.post("/auth/avatar", form);
    },
};

/**
 * Citizen-side upload endpoints: submit MP4+GPX pair, poll status, fetch
 * detail, list own uploads, and manage notes / comments / visibility.
 */
export const uploadsApi = {
    create: (mp4File, gpxFile) => {
        const form = new FormData();
        form.append("mp4_file", mp4File);
        form.append("gpx_file", gpxFile);
        return api.post("/uploads/", form);
    },
    status: (uploadId) => api.get(`/uploads/${uploadId}/status`),
    detail: (uploadId) => api.get(`/uploads/${uploadId}/detail`),
    mine: () => api.get("/uploads/mine"),
    updateNotes: (uploadId, notes) => api.patch(`/uploads/${uploadId}/notes`, { notes }),
    addComment: (uploadId, text) => api.post(`/uploads/${uploadId}/comments`, { text }),
    editComment: (uploadId, commentId, text) => api.patch(`/uploads/${uploadId}/comments/${commentId}`, { text }),
    deleteComment: (uploadId, commentId) => api.delete(`/uploads/${uploadId}/comments/${commentId}`),
    getComments: (uploadId) => api.get(`/uploads/${uploadId}/comments`),
    hideReport: (uploadId) => api.patch(`/uploads/${uploadId}/hide`),
    markSeen: (uploadId) => api.patch(`/uploads/${uploadId}/seen`),
};

/**
 * Custom DOM event fired whenever notification read-state changes (via
 * `markAsRead` or `markAsUnread`). The bell badge in the Topbar and the red
 * dot in the Sidebar listen for this event so they can refresh without
 * waiting for the next route change. The event payload is empty — listeners
 * always re-fetch the canonical set from the server.
 */
export const NOTIFICATIONS_READS_CHANGED = "notifications:reads-changed";

function _emitReadsChanged() {
    if (typeof window === "undefined") return;
    try { window.dispatchEvent(new CustomEvent(NOTIFICATIONS_READS_CHANGED)); }
    catch { /* non-browser environments (SSR, tests) */ }
}

/**
 * Notification read-state endpoints. The notification list itself is computed
 * client-side from uploads / events / tickets / approvals; only the read-state
 * is server-persisted (per user, keyed by an opaque page-defined string).
 *
 * `markAsRead` / `markAsUnread` dispatch a `NOTIFICATIONS_READS_CHANGED` DOM
 * event after the request settles so other notification surfaces (Sidebar
 * dot, Topbar bell) refresh in lockstep.
 */
export const notificationsApi = {
    getReads: () => api.get("/notifications/reads"),
    markAsRead: (notificationKeys) =>
        api.post("/notifications/reads", { notification_keys: notificationKeys })
            .finally(_emitReadsChanged),
    markAsUnread: (notificationKey) =>
        api.delete(`/notifications/reads/${encodeURIComponent(notificationKey)}`)
            .finally(_emitReadsChanged),
};

/**
 * Help-center support tickets: create, list-mine (citizen), list-all
 * (admin/authority), get, status update, and threaded responses.
 */
export const supportApi = {
    create: (payload) => api.post("/support/tickets", payload),
    listMine: () => api.get("/support/tickets/mine"),
    list: () => api.get("/support/tickets"),
    get: (ticketId) => api.get(`/support/tickets/${ticketId}`),
    updateStatus: (ticketId, status, note) => api.patch(`/support/tickets/${ticketId}/status`, { status, note }),
    addResponse: (ticketId, text) => api.post(`/support/tickets/${ticketId}/responses`, { text }),
};

/**
 * Public events endpoint used by the shared (anonymous) hazard map.
 */
export const eventsApi = {
    list: (params) => api.get("/events/", { params }),
};

/**
 * Authority-side endpoints: event listing, lifecycle status updates,
 * history note edits, analytics, team membership, and event assignment.
 */
export const authorityApi = {
    events: (params) => api.get("/authority/events", { params }),
    eventDetail: (eventId) => api.get(`/authority/events/${eventId}`),
    updateStatus: (eventId, payload) =>
        api.patch(`/authority/events/${eventId}/status`, payload),
    updateHistoryNote: (historyId, note) =>
        api.patch(`/authority/events/history/${historyId}/note`, { note }),
    deleteHistoryEntry: (historyId) =>
        api.delete(`/authority/events/history/${historyId}`),
    analytics: (params) => api.get("/authority/analytics", { params }),
    myTeam: () => api.get("/authority/my-team"),
    assignEvent: (eventId, userId) =>
        api.post(`/authority/events/${eventId}/assign`, { user_id: userId }),
    // Self-service authority profile (department/designation/zone). Backed by
    // authority_profiles in MongoDB — replaces the previous localStorage state.
    getMyAuthorityProfile: () => api.get("/authority/profile"),
    updateMyAuthorityProfile: (updates) => api.patch("/authority/profile", updates),
};

/**
 * Admin endpoints: platform stats, user management (suspend/reactivate),
 * authority approvals, upload pipeline review, plus zone and team CRUD.
 */
export const adminApi = {
    stats: (params) => api.get("/admin/stats", { params }),
    listUsers: (params) => api.get("/admin/users", { params }),
    pendingAuthorities: () => api.get("/admin/pending-authorities"),
    approve: (userId, payload) => api.post(`/admin/approve/${userId}`, payload),
    listUploads: () => api.get("/admin/uploads"),
    processingReview: (uploadId) => api.get(`/admin/uploads/${uploadId}/processing-review`),
    suspendUser: (userId, reason) => api.post(`/admin/users/${userId}/suspend`, { reason }),
    reactivateUser: (userId) => api.post(`/admin/users/${userId}/reactivate`),
    // Zones
    listZones: () => api.get("/admin/zones"),
    createZone: (data) => api.post("/admin/zones", data),
    updateZone: (zoneId, data) => api.patch(`/admin/zones/${zoneId}`, data),
    deleteZone: (zoneId) => api.delete(`/admin/zones/${zoneId}`),
    // Teams
    listTeams: () => api.get("/admin/teams"),
    createTeam: (data) => api.post("/admin/teams", data),
    deleteTeam: (teamId) => api.delete(`/admin/teams/${teamId}`),
    addTeamMember: (teamId, userId) => api.post(`/admin/teams/${teamId}/members`, { user_id: userId }),
    removeTeamMember: (teamId, userId) => api.delete(`/admin/teams/${teamId}/members/${userId}`),
    setTeamLeader: (teamId, userId) => api.post(`/admin/teams/${teamId}/leader`, { user_id: userId }),
};

