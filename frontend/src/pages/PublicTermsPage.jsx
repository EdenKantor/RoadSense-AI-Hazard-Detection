/**
 * Public Terms of Service page.
 *
 * Anonymous-accessible page at /terms. Linked from the registration forms
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

/** Renders the Terms of Service page with a Back-to-Home link. */
export default function PublicTermsPage() {
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
                        Terms of Service
                    </h1>
                    <p style={{ color: "var(--text-muted)", fontSize: "0.88rem", marginBottom: "2rem" }}>
                        Last updated: May 2026 — RoadSenseAI is an academic project; these terms cover
                        your use of the demonstration platform.
                    </p>

                    <section style={{ marginBottom: "1.5rem" }}>
                        <h2 style={{ fontSize: "1.15rem", fontWeight: 600, marginBottom: "0.5rem", color: "var(--text-main)" }}>
                            1. Acceptance
                        </h2>
                        <p style={{ color: "var(--text-main)", lineHeight: 1.65 }}>
                            By creating an account, uploading content, or otherwise using the
                            RoadSenseAI platform, you agree to these Terms of Service. If you do
                            not agree, please do not register or upload any material.
                        </p>
                    </section>

                    <section style={{ marginBottom: "1.5rem" }}>
                        <h2 style={{ fontSize: "1.15rem", fontWeight: 600, marginBottom: "0.5rem", color: "var(--text-main)" }}>
                            2. Account responsibilities
                        </h2>
                        <p style={{ color: "var(--text-main)", lineHeight: 1.65 }}>
                            You are responsible for maintaining the confidentiality of your
                            credentials and for any activity carried out under your account. If you
                            register as an Authority official, you certify that the organisation
                            and jurisdiction information you provide is accurate.
                        </p>
                    </section>

                    <section style={{ marginBottom: "1.5rem" }}>
                        <h2 style={{ fontSize: "1.15rem", fontWeight: 600, marginBottom: "0.5rem", color: "var(--text-main)" }}>
                            3. Acceptable use
                        </h2>
                        <p style={{ color: "var(--text-main)", lineHeight: 1.65 }}>
                            Uploaded videos and GPS tracks must depict public roads and the
                            uploader's own driving footage. Do not upload content that infringes
                            another person's privacy (for example, identifiable faces or licence
                            plates as the primary subject) or that violates local law. The platform
                            is intended for road-hazard reporting, not surveillance of individuals.
                        </p>
                    </section>

                    <section style={{ marginBottom: "1.5rem" }}>
                        <h2 style={{ fontSize: "1.15rem", fontWeight: 600, marginBottom: "0.5rem", color: "var(--text-main)" }}>
                            4. Content ownership
                        </h2>
                        <p style={{ color: "var(--text-main)", lineHeight: 1.65 }}>
                            You retain ownership of the videos and GPS tracks you upload. By
                            uploading, you grant the platform a non-exclusive, royalty-free
                            licence to process the material through the detection pipeline, store
                            derived pothole events with geo-coordinates, and display the resulting
                            events on public maps. Raw videos are not shown publicly.
                        </p>
                    </section>

                    <section style={{ marginBottom: "1.5rem" }}>
                        <h2 style={{ fontSize: "1.15rem", fontWeight: 600, marginBottom: "0.5rem", color: "var(--text-main)" }}>
                            5. Service availability
                        </h2>
                        <p style={{ color: "var(--text-main)", lineHeight: 1.65 }}>
                            RoadSenseAI is provided "as is" for demonstration and academic use. We
                            make no warranty of uptime, accuracy, or fitness for any particular
                            purpose. Pothole detection is a probabilistic process and may produce
                            false positives or miss real defects.
                        </p>
                    </section>

                    <section style={{ marginBottom: "1.5rem" }}>
                        <h2 style={{ fontSize: "1.15rem", fontWeight: 600, marginBottom: "0.5rem", color: "var(--text-main)" }}>
                            6. Account termination
                        </h2>
                        <p style={{ color: "var(--text-main)", lineHeight: 1.65 }}>
                            You may stop using the service at any time by ceasing to log in.
                            Administrators may suspend accounts that violate these terms. If your
                            account is suspended, the suspension reason will be shown when you
                            attempt to sign in.
                        </p>
                    </section>

                    <section>
                        <h2 style={{ fontSize: "1.15rem", fontWeight: 600, marginBottom: "0.5rem", color: "var(--text-main)" }}>
                            7. Changes to these terms
                        </h2>
                        <p style={{ color: "var(--text-main)", lineHeight: 1.65 }}>
                            These terms may be revised periodically. Significant changes will be
                            communicated via the registered email address on the account. Continued
                            use after a revision constitutes acceptance of the updated terms.
                        </p>
                    </section>
                </article>
            </div>
        </div>
    );
}
