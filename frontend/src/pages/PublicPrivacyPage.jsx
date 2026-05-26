/**
 * Public Privacy Policy page.
 *
 * Anonymous-accessible page at /privacy. Linked from the registration forms
 * (Citizen + Authority) via the agreement checkbox. Static prose, no API
 * calls. Theme is mirrored from localStorage so the page matches the
 * surrounding public-site theme.
 *
 * Content is intentionally placeholder-grade — this is an academic project,
 * not a production legal instrument.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

/** Renders the Privacy Policy page with a Back-to-Home link. */
export default function PublicPrivacyPage() {
    const [theme, setTheme] = useState(() => localStorage.getItem("roadsense_theme") || "light");

    useEffect(() => {
        document.documentElement.setAttribute("data-theme", theme);
        localStorage.setItem("roadsense_theme", theme);
    }, [theme]);

    return (
        <div className="lp" style={{ minHeight: "100vh" }}>
            <div style={{ maxWidth: "780px", margin: "0 auto", padding: "2rem 1.25rem 4rem" }}>
                <Link
                    to="/"
                    style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "0.5rem",
                        color: "var(--text-muted)",
                        textDecoration: "none",
                        fontSize: "0.9rem",
                        marginBottom: "1.5rem",
                    }}
                >
                    <ArrowLeft size={16} /> Back to Home
                </Link>

                <article
                    className="card"
                    style={{
                        background: "var(--card)",
                        borderRadius: "16px",
                        padding: "2.5rem 2.25rem",
                        boxShadow: "0 1px 3px rgba(0,0,0,0.06), 0 4px 16px rgba(0,0,0,0.04)",
                    }}
                >
                    <h1 style={{ fontSize: "1.85rem", fontWeight: 700, marginBottom: "0.4rem", color: "var(--text-main)" }}>
                        Privacy Policy
                    </h1>
                    <p style={{ color: "var(--text-muted)", fontSize: "0.88rem", marginBottom: "2rem" }}>
                        Last updated: May 2026 — RoadSenseAI is an academic project; this policy
                        describes what is collected, how it is used, and how to ask for it to be
                        removed.
                    </p>

                    <section style={{ marginBottom: "1.5rem" }}>
                        <h2 style={{ fontSize: "1.15rem", fontWeight: 600, marginBottom: "0.5rem", color: "var(--text-main)" }}>
                            1. Information we collect
                        </h2>
                        <p style={{ color: "var(--text-main)", lineHeight: 1.65, marginBottom: "0.75rem" }}>
                            <strong>Account information.</strong> Email address, full name, and
                            password (stored as a bcrypt hash, never in plaintext). Authority
                            registrations additionally collect organisation name, jurisdiction
                            area, employee identifier, and phone number.
                        </p>
                        <p style={{ color: "var(--text-main)", lineHeight: 1.65, marginBottom: "0.75rem" }}>
                            <strong>Uploaded content.</strong> The MP4 video and GPX track you
                            submit, along with any notes or comments you add to a report.
                        </p>
                        <p style={{ color: "var(--text-main)", lineHeight: 1.65 }}>
                            <strong>Derived data.</strong> Pothole events with geo-coordinates,
                            severity classifications, and detection counts produced by the
                            automated pipeline from your uploaded material.
                        </p>
                    </section>

                    <section style={{ marginBottom: "1.5rem" }}>
                        <h2 style={{ fontSize: "1.15rem", fontWeight: 600, marginBottom: "0.5rem", color: "var(--text-main)" }}>
                            2. How we use it
                        </h2>
                        <p style={{ color: "var(--text-main)", lineHeight: 1.65 }}>
                            Account information identifies you across sessions and routes
                            notifications to you. Uploaded videos are processed by the detection
                            pipeline and then retained alongside the derived events to support
                            authority review. Derived events appear on the public hazard map and
                            on authority dashboards. Authority officials see only events in their
                            assigned zone; the public map shows aggregated severity and lifecycle
                            status only.
                        </p>
                    </section>

                    <section style={{ marginBottom: "1.5rem" }}>
                        <h2 style={{ fontSize: "1.15rem", fontWeight: 600, marginBottom: "0.5rem", color: "var(--text-main)" }}>
                            3. What we do not do
                        </h2>
                        <p style={{ color: "var(--text-main)", lineHeight: 1.65 }}>
                            We do not sell, lease, or otherwise share personal data with
                            advertisers. Raw uploaded videos are not exposed to the public — only
                            authorised authority officials and administrators can review them.
                            Citizen email addresses are not displayed on any public surface of the
                            platform.
                        </p>
                    </section>

                    <section style={{ marginBottom: "1.5rem" }}>
                        <h2 style={{ fontSize: "1.15rem", fontWeight: 600, marginBottom: "0.5rem", color: "var(--text-main)" }}>
                            4. Third-party services
                        </h2>
                        <p style={{ color: "var(--text-main)", lineHeight: 1.65 }}>
                            We use BigDataCloud's free reverse-geocoding API to convert pothole
                            coordinates into city / zone names. The query contains the latitude
                            and longitude of the detected event, but no personal identifier. No
                            other third-party processors handle your data.
                        </p>
                    </section>

                    <section style={{ marginBottom: "1.5rem" }}>
                        <h2 style={{ fontSize: "1.15rem", fontWeight: 600, marginBottom: "0.5rem", color: "var(--text-main)" }}>
                            5. Retention
                        </h2>
                        <p style={{ color: "var(--text-main)", lineHeight: 1.65 }}>
                            Uploads and derived events are retained while they are operationally
                            useful (typically until the underlying pothole has been marked
                            resolved and a reasonable retention window has passed). Account
                            information is retained for the lifetime of the account. To request
                            deletion, contact a platform administrator from within the Help
                            Center.
                        </p>
                    </section>

                    <section style={{ marginBottom: "1.5rem" }}>
                        <h2 style={{ fontSize: "1.15rem", fontWeight: 600, marginBottom: "0.5rem", color: "var(--text-main)" }}>
                            6. Cookies and local storage
                        </h2>
                        <p style={{ color: "var(--text-main)", lineHeight: 1.65 }}>
                            The platform stores a JWT access token in the browser's localStorage
                            to keep you signed in across page reloads, plus your light/dark theme
                            preference. No third-party tracking cookies are used.
                        </p>
                    </section>

                    <section>
                        <h2 style={{ fontSize: "1.15rem", fontWeight: 600, marginBottom: "0.5rem", color: "var(--text-main)" }}>
                            7. Contact
                        </h2>
                        <p style={{ color: "var(--text-main)", lineHeight: 1.65 }}>
                            For privacy questions, please use the Help Center after signing in
                            and submit a ticket to the Admin team. We respond within a reasonable
                            time frame consistent with this being a graduation-stage academic
                            project.
                        </p>
                    </section>
                </article>
            </div>
        </div>
    );
}
