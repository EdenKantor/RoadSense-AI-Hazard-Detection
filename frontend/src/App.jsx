/**
 * Application root and route table.
 *
 * Wraps the app in <AuthProvider> + <BrowserRouter> and declares every route.
 * Route protection is layered via three role-shell helpers (CitizenShell,
 * AuthorityShell, AdminShell) that compose <MainLayout> + <RoleRoute>. The
 * /map route uses <MapRouteProxy> to render different pages based on auth
 * state. Legacy /official/* paths redirect to /authority/* for backwards
 * compatibility with older bookmarks/links.
 */
import { BrowserRouter, Routes, Route, Navigate, Link, useParams } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth/AuthContext";

import ProtectedRoute from "./components/ProtectedRoute";
import RoleRoute from "./components/RoleRoute";
import MainLayout from "./components/layout/MainLayout";

import LandingPage from "./pages/LandingPage";
import PublicHelpPage from "./pages/PublicHelpPage";
import PublicAboutPage from "./pages/PublicAboutPage";
import PublicTermsPage from "./pages/PublicTermsPage";
import PublicPrivacyPage from "./pages/PublicPrivacyPage";
import LoginPage from "./pages/LoginPage";
import SharedHazardMapPage from "./pages/SharedHazardMapPage";
import InteractiveMapPage from "./pages/InteractiveMapPage";
import UploadPage from "./pages/UploadPage";
import MyUploadsPage from "./pages/MyUploadsPage";
import CitizenReportsPage from "./pages/CitizenReportsPage";
import UploadStatusPage from "./pages/UploadStatusPage";

import CitizenNotificationsPage from "./pages/CitizenNotificationsPage";
import CitizenProfilePage from "./pages/CitizenProfilePage";
import CitizenHelpCenterPage from "./pages/CitizenHelpCenterPage";

import AuthorityDashboardPage from "./pages/AuthorityDashboardPage";
import AuthorityEventsPage from "./pages/AuthorityEventsPage";
import AuthorityStatusUpdatePage from "./pages/AuthorityStatusUpdatePage";
import AuthorityAnalyticsPage from "./pages/AuthorityAnalyticsPage";
import AuthorityProfilePage from "./pages/AuthorityProfilePage";
import AuthorityTeamPage from "./pages/AuthorityTeamPage";
import AuthorityHelpCenterPage from "./pages/AuthorityHelpCenterPage";

import AdminDashboardPage from "./pages/AdminDashboardPage";
import AdminUsersPage from "./pages/AdminUsersPage";
import AdminApprovalPage from "./pages/AdminApprovalPage";
import AdminUploadsPage from "./pages/AdminUploadsPage";
import AdminHelpCenterPage from "./pages/AdminHelpCenterPage";
import AdminProcessingReviewPage from "./pages/AdminProcessingReviewPage";
import AdminZoneManagementPage from "./pages/AdminZoneManagementPage";
import AdminTeamManagementPage from "./pages/AdminTeamManagementPage";
import AdminReportMapPage from "./pages/AdminReportMapPage";
import AdminNotificationsPage from "./pages/AdminNotificationsPage";
import AuthorityNotificationsPage from "./pages/AuthorityNotificationsPage";
import CitizenRegisterPage from "./pages/CitizenRegisterPage";
import OfficialRegisterPage from "./pages/OfficialRegisterPage";
import PipelineMonitorPage from "./pages/dev/PipelineMonitorPage";

/**
 * Renders the map page in two flavors depending on auth state:
 * - Logged-in users see the interactive map inside the standard MainLayout.
 * - Anonymous visitors get the public SharedHazardMapPage (no chrome).
 */
function MapRouteProxy() {
    const { user } = useAuth();
    if (user) {
        return (
            <MainLayout>
                <InteractiveMapPage />
            </MainLayout>
        );
    }
    return <SharedHazardMapPage />;
}

/**
 * Wraps a route element in MainLayout + RoleRoute(["Citizen"]).
 * Used to gate /citizen/* routes to the Citizen role.
 *
 * @param {Object} props
 * @param {React.ReactNode} props.children - The page component to render.
 */
function CitizenShell({ children }) {
    return (
        <MainLayout>
            <RoleRoute allowedRoles={["Citizen"]}>{children}</RoleRoute>
        </MainLayout>
    );
}

/**
 * Wraps a route element in MainLayout + RoleRoute(["Authority", "Admin"]).
 * Admins are intentionally allowed through so they can preview Authority pages.
 *
 * @param {Object} props
 * @param {React.ReactNode} props.children - The page component to render.
 */
function AuthorityShell({ children }) {
    return (
        <MainLayout>
            <RoleRoute allowedRoles={["Authority", "Admin"]}>{children}</RoleRoute>
        </MainLayout>
    );
}

/**
 * Wraps a route element in MainLayout + RoleRoute(["Admin"]).
 * Used to gate /admin/* routes to the Admin role only.
 *
 * @param {Object} props
 * @param {React.ReactNode} props.children - The page component to render.
 */
function AdminShell({ children }) {
    return (
        <MainLayout>
            <RoleRoute allowedRoles={["Admin"]}>{children}</RoleRoute>
        </MainLayout>
    );
}

/**
 * Legacy redirect for the parameterised /official/events/:eventId/update path.
 * Preserved so existing email links / bookmarks keep working after the
 * Official → Authority rename. Static legacy paths are handled inline below
 * via <Navigate>; this component exists only because we need useParams().
 */
function LegacyOfficialEventUpdateRedirect() {
    const { eventId } = useParams();
    return <Navigate to={eventId ? `/authority/events/${eventId}/update` : "/authority/events"} replace />;
}

/**
 * Top-level App component: declares the full route table.
 * Public, citizen, authority and admin route groups are kept visually separated
 * to make the routing surface easy to audit.
 */
export default function App() {
    return (
        <AuthProvider>
            <BrowserRouter>
                <Routes>
                    <Route path="/" element={<LandingPage />} />
                    {/* Dev-only observability dashboard. NOT wrapped in ProtectedRoute
                        or RoleRoute — anyone can view it. The page itself probes the
                        backend SSE endpoint and shows a "dev mode disabled" banner
                        when DEV_MODE=false on the backend. */}
                    <Route path="/dev/pipeline-monitor" element={<PipelineMonitorPage />} />
                    <Route path="/help" element={<PublicHelpPage />} />
                    <Route path="/about" element={<PublicAboutPage />} />
                    <Route path="/terms" element={<PublicTermsPage />} />
                    <Route path="/privacy" element={<PublicPrivacyPage />} />
                    <Route path="/login" element={<LoginPage />} />
                    <Route path="/register" element={<CitizenRegisterPage />} />
                    <Route path="/register/official" element={<OfficialRegisterPage />} />
                    <Route path="/map" element={<MapRouteProxy />} />

                    <Route path="/upload" element={<CitizenShell><UploadPage /></CitizenShell>} />
                    <Route path="/citizen/report-issue" element={<Navigate to="/upload" replace />} />

                    <Route path="/uploads/mine" element={<MainLayout><ProtectedRoute><MyUploadsPage /></ProtectedRoute></MainLayout>} />
                    <Route path="/citizen/reports" element={<CitizenShell><CitizenReportsPage /></CitizenShell>} />

                    <Route path="/uploads/:uploadId/status" element={<MainLayout><ProtectedRoute><UploadStatusPage /></ProtectedRoute></MainLayout>} />
                    <Route path="/citizen/reports/:uploadId" element={<CitizenShell><UploadStatusPage /></CitizenShell>} />

                    <Route path="/citizen/map" element={<CitizenShell><InteractiveMapPage /></CitizenShell>} />
                    <Route path="/citizen/notifications" element={<CitizenShell><CitizenNotificationsPage /></CitizenShell>} />
                    <Route path="/citizen/profile" element={<CitizenShell><CitizenProfilePage /></CitizenShell>} />
                    <Route path="/citizen/help" element={<CitizenShell><CitizenHelpCenterPage /></CitizenShell>} />

                    <Route path="/authority/dashboard" element={<AuthorityShell><AuthorityDashboardPage /></AuthorityShell>} />
                    <Route path="/authority/events" element={<AuthorityShell><AuthorityEventsPage /></AuthorityShell>} />
                    <Route path="/authority/events/:eventId/update" element={<AuthorityShell><AuthorityStatusUpdatePage /></AuthorityShell>} />
                    <Route path="/authority/analytics" element={<AuthorityShell><AuthorityAnalyticsPage /></AuthorityShell>} />
                    <Route path="/authority/profile" element={<AuthorityShell><AuthorityProfilePage /></AuthorityShell>} />
                    <Route path="/authority/team" element={<AuthorityShell><AuthorityTeamPage /></AuthorityShell>} />
                    <Route path="/authority/notifications" element={<AuthorityShell><AuthorityNotificationsPage /></AuthorityShell>} />
                    <Route path="/authority/help" element={<AuthorityShell><AuthorityHelpCenterPage /></AuthorityShell>} />

                    {/* Legacy /official/* routes: preserved for backwards compatibility
                        with bookmarks and emailed links from before the role rename. */}
                    <Route path="/official/dashboard" element={<Navigate to="/authority/dashboard" replace />} />
                    <Route path="/official/events" element={<Navigate to="/authority/events" replace />} />
                    <Route path="/official/events/:eventId/update" element={<LegacyOfficialEventUpdateRedirect />} />
                    <Route path="/official/analytics" element={<Navigate to="/authority/analytics" replace />} />
                    <Route path="/official/profile" element={<Navigate to="/authority/profile" replace />} />

                    <Route path="/admin/dashboard" element={<AdminShell><AdminDashboardPage /></AdminShell>} />
                    <Route path="/admin/users" element={<AdminShell><AdminUsersPage /></AdminShell>} />
                    <Route path="/admin/approval" element={<AdminShell><AdminApprovalPage /></AdminShell>} />
                    <Route path="/admin/officials/verify" element={<AdminShell><AdminApprovalPage /></AdminShell>} />
                    <Route path="/admin/uploads" element={<AdminShell><AdminUploadsPage /></AdminShell>} />
                    <Route path="/admin/reports" element={<AdminShell><AdminUploadsPage /></AdminShell>} />
                    <Route path="/admin/uploads/:uploadId/review" element={<AdminShell><AdminProcessingReviewPage /></AdminShell>} />
                    <Route path="/admin/uploads/:uploadId/map" element={<AdminShell><AdminReportMapPage /></AdminShell>} />
                    <Route path="/admin/zones" element={<AdminShell><AdminZoneManagementPage /></AdminShell>} />
                    <Route path="/admin/teams" element={<AdminShell><AdminTeamManagementPage /></AdminShell>} />
                    <Route path="/admin/profile" element={<AdminShell><CitizenProfilePage /></AdminShell>} />
                    <Route path="/admin/notifications" element={<AdminShell><AdminNotificationsPage /></AdminShell>} />
                    <Route path="/admin/help" element={<AdminShell><AdminHelpCenterPage /></AdminShell>} />

                    <Route
                        path="*"
                        element={
                            <MainLayout>
                                <div className="card text-center" style={{ maxWidth: 400, margin: "4rem auto" }}>
                                    <div className="card-content">
                                        <h1 style={{ fontSize: "2rem", marginBottom: "1rem" }}>404</h1>
                                        <p className="text-muted mb-4">Page not found</p>
                                        <Link to="/map" className="btn btn-primary">Go to map</Link>
                                    </div>
                                </div>
                            </MainLayout>
                        }
                    />
                </Routes>
            </BrowserRouter>
        </AuthProvider>
    );
}




