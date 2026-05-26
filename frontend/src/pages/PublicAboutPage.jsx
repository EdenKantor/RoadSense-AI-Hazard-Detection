/**
 * Public "About" marketing page.
 *
 * Anonymous-accessible page at /about that explains the platform's mission,
 * vision, feature set, and tech stack to prospective citizens and authority
 * officials. Static content only — no API calls. Includes a light/dark theme
 * toggle (persisted to localStorage under "roadsense_theme") and CTAs into
 * /register and /help. Reuses the shared landing-page navbar/footer styling.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
    ShieldCheck,
    Cpu,
    MapPin,
    Brain,
    Users,
    LayoutDashboard,
    Map,
    Zap,
    ArrowRight,
    Database,
    Server,
    Code2,
    Target,
    Eye,
    Sparkles,
    ChevronRight,
} from "lucide-react";
import logoImg from "../assets/logo.png";

/** Renders the public About page (mission, features, tech stack, CTA). */
export default function PublicAboutPage() {
    const [scrolled, setScrolled] = useState(false);
    const [theme, setTheme] = useState(() => localStorage.getItem("roadsense_theme") || "light");

    // Empty deps: scroll listener attached once on mount.
    useEffect(() => {
        const handler = () => setScrolled(window.scrollY > 20);
        window.addEventListener("scroll", handler);
        return () => window.removeEventListener("scroll", handler);
    }, []);

    // Sync the chosen theme to <html data-theme> and persist it so the choice
    // survives navigation across the public marketing pages.
    useEffect(() => {
        document.documentElement.setAttribute("data-theme", theme);
        localStorage.setItem("roadsense_theme", theme);
    }, [theme]);

    return (
        <div className="lp" style={{ background: "#f8fafc" }}>
            {/* ── Navbar ── */}
            <nav className={`lp-nav ${scrolled ? "lp-nav-s" : ""}`}>
                <Link to="/" className="lp-brand">
                    <img src={logoImg} alt="" className="lp-brand-img" />
                    <div>
                        <div className="lp-brand-name">RoadSenseAI</div>
                        <div className="lp-brand-tag">Report. Track. Resolve.</div>
                    </div>
                </Link>
                <div className="lp-nav-mid">
                    <Link to="/" className="lp-link">Home</Link>
                    <Link to="/about" className="lp-link lp-link-on">About</Link>
                    <Link to="/map" className="lp-link">Public Map</Link>
                    <Link to="/help" className="lp-link">Help Center</Link>
                </div>
                <div className="lp-nav-right">
                    <div className="theme-toggle">
                        <div className={`sun-wrapper${theme === "light" ? " active" : ""}`} onClick={() => setTheme("light")} title="Light mode">
                            <i className="fa-solid fa-sun" />
                        </div>
                        <div className={`moon-wrapper${theme === "dark" ? " active" : ""}`} onClick={() => setTheme("dark")} title="Dark mode">
                            <i className="fa-solid fa-moon" />
                        </div>
                    </div>
                    <Link to="/login" className="lp-login">Login</Link>
                    <Link to="/register" className="lp-cta-nav">Sign Up</Link>
                </div>
            </nav>

            {/* ── Hero ── */}
            <section className="pa-hero">
                <div className="pa-hero-inner">
                    <span className="pa-badge">About the Platform</span>
                    <h1>Smarter Road Maintenance<br />Powered by <span className="lp-grad">AI</span></h1>
                    <p>RoadSenseAI bridges the gap between citizens who report road issues and authorities who resolve them — using computer vision, GPS alignment, and real-time tracking.</p>
                </div>
            </section>

            {/* ── Mission Cards ── */}
            <section className="pa-sec">
                <div className="pa-w">
                    <div className="pa-mission-grid">
                        <div className="pa-m-card">
                            <div className="pa-m-ic" style={{ background: "#dbeafe", color: "#2563eb" }}><Target size={22} /></div>
                            <h3>Our Mission</h3>
                            <p>Empower communities to identify and resolve road hazards faster through AI-powered detection and seamless collaboration between citizens and local authorities.</p>
                        </div>
                        <div className="pa-m-card">
                            <div className="pa-m-ic" style={{ background: "#dcfce7", color: "#16a34a" }}><Eye size={22} /></div>
                            <h3>Our Vision</h3>
                            <p>A world where every pothole is detected, reported, and fixed automatically. Safer roads for everyone, everywhere.</p>
                        </div>
                        <div className="pa-m-card">
                            <div className="pa-m-ic" style={{ background: "#ede9fe", color: "#7c3aed" }}><Sparkles size={22} /></div>
                            <h3>Why AI?</h3>
                            <p>Manual reporting is slow and inconsistent. Our YOLOv8 pipeline detects potholes from dashcam video with high accuracy no manual annotation needed.</p>
                        </div>
                    </div>
                </div>
            </section>

            {/* ── Features ── */}
            <section className="pa-sec">
                <div className="pa-w">
                    <div className="pa-sec-header">
                        <h2>Platform Features</h2>
                        <p>Everything citizens and authorities need in one platform.</p>
                    </div>

                    <div className="pa-feat-grid">
                        {[
                            { ic: Brain, color: "#2563eb", bg: "#dbeafe", t: "AI-Powered Detection", d: "YOLO-based ML pipeline detects and classifies potholes from dashcam footage automatically." },
                            { ic: MapPin, color: "#16a34a", bg: "#dcfce7", t: "Real-Time Tracking", d: "Track pothole reports with live status updates on an interactive map." },
                            { ic: LayoutDashboard, color: "#7c3aed", bg: "#ede9fe", t: "Authority Dashboard", d: "Manage, prioritize, and resolve reports from a unified control panel." },
                            { ic: Users, color: "#d97706", bg: "#fef3c7", t: "Team Management", d: "Coordinate field teams and route tasks efficiently across zones." },
                            { ic: Map, color: "#0284c7", bg: "#e0f2fe", t: "Zone Routing", d: "Automatically assign reports to the correct authority zone." },
                            { ic: ShieldCheck, color: "#059669", bg: "#dcfce7", t: "Role-Based Access", d: "Citizen, Authority, and Admin roles with granular permissions." },
                        ].map((f, i) => (
                            <div key={i} className="pa-feat-item">
                                <div className="pa-feat-ic" style={{ background: f.bg, color: f.color }}><f.ic size={20} /></div>
                                <div>
                                    <h3>{f.t}</h3>
                                    <p>{f.d}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* ── Tech Stack ── */}
            <section className="pa-sec pa-sec-dark">
                <div className="pa-w">
                    <div className="pa-sec-header">
                        <h2>Built With</h2>
                        <p>Modern, production-grade technologies under the hood.</p>
                    </div>

                    <div className="pa-tech-strip">
                        {[
                            { ic: Code2, t: "Frontend", color: "#60a5fa", tags: [
                                { name: "React", icon: "https://cdn.jsdelivr.net/gh/devicons/devicon/icons/react/react-original.svg" },
                                { name: "Vite", icon: "https://cdn.jsdelivr.net/gh/devicons/devicon/icons/vitejs/vitejs-original.svg" },
                                { name: "Leaflet", icon: "https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/leaflet/leaflet-original.svg" },
                                { name: "Lucide", icon: null },
                            ]},
                            { ic: Server, t: "Backend", color: "#34d399", tags: [
                                { name: "FastAPI", icon: "https://cdn.jsdelivr.net/gh/devicons/devicon/icons/fastapi/fastapi-original.svg" },
                                { name: "Python", icon: "https://cdn.jsdelivr.net/gh/devicons/devicon/icons/python/python-original.svg" },
                                { name: "JWT", icon: null },
                                { name: "RBAC", icon: null },
                            ]},
                            { ic: Cpu, t: "AI Pipeline", color: "#fbbf24", tags: [
                                { name: "YOLOv8", icon: null },
                                { name: "DBSCAN", icon: null },
                                { name: "RQ", icon: null },
                            ]},
                            { ic: Database, t: "Database", color: "#a78bfa", tags: [
                                { name: "MongoDB", icon: "https://cdn.jsdelivr.net/gh/devicons/devicon/icons/mongodb/mongodb-original.svg" },
                                { name: "GeoJSON", icon: null },
                                { name: "Redis", icon: "https://cdn.jsdelivr.net/gh/devicons/devicon/icons/redis/redis-original.svg" },
                            ]},
                        ].map((s, i) => (
                            <div key={i} className="pa-tech-item">
                                <s.ic size={20} style={{ color: s.color }} />
                                <strong>{s.t}</strong>
                                <div className="pa-tech-tags-dark">
                                    {s.tags.map(t => (
                                        <span key={t.name}>
                                            {t.icon && <img src={t.icon} alt="" className="pa-tag-icon" />}
                                            {t.name}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* ── CTA ── */}
            <section className="pa-sec pa-sec-cta">
                <div className="pa-w" style={{ textAlign: "center" }}>
                    <h2>Ready to make roads safer?</h2>
                    <p style={{ color: "#64748b", marginBottom: "1.5rem" }}>Join citizens and authorities already using RoadSenseAI.</p>
                    <div style={{ display: "flex", gap: "0.75rem", justifyContent: "center", flexWrap: "wrap" }}>
                        <Link to="/register" className="lp-cta-hero">Get Started Free <ArrowRight size={16} /></Link>
                        <Link to="/help" className="lp-cta-ghost">Learn More <ChevronRight size={16} /></Link>
                    </div>
                </div>
            </section>

            {/* ── Footer ── */}
            <footer className="lp-footer">
                <div className="lp-footer-inner">
                    <div className="lp-footer-brand">
                        <img src={logoImg} alt="" className="lp-footer-logo" />
                        <div>
                            <div className="lp-footer-name">RoadSenseAI</div>
                            <p>Empowering citizens and authorities to collaborate on safer roads.</p>
                        </div>
                    </div>
                    <div className="lp-footer-col">
                        <h4><Zap size={13} /> Product</h4>
                        <Link to="/about">About</Link>
                        <Link to="/map">Public Map</Link>
                    </div>
                    <div className="lp-footer-col">
                        <h4><ShieldCheck size={13} /> Support</h4>
                        <Link to="/help">Help Center</Link>
                    </div>
                </div>
                <div className="lp-footer-bot">&copy; 2026 RoadSenseAI. All rights reserved.</div>
            </footer>
        </div>
    );
}
