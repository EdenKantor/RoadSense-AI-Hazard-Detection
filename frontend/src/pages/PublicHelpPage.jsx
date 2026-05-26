/**
 * Public Help Center page.
 *
 * Anonymous-accessible page at /help that provides role-based onboarding
 * (Citizen vs Authority cards linking to the appropriate /register routes), a
 * "How it works" four-step explainer, and an accordion FAQ. Honors a #faq URL
 * hash to scroll directly to the FAQ section. Theme toggle is persisted to
 * localStorage. Static content only — no API calls.
 */
import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import {
    ShieldCheck,
    Cpu,
    Users,
    UserCheck,
    MapPin,
    Upload,
    BarChart3,
    HelpCircle,
    ChevronDown,
    ChevronUp,
    ArrowRight,
    Zap,
    FileText,
    BellRing,
    CheckCircle,
} from "lucide-react";
import logoImg from "../assets/logo.png";

const FAQ_DATA = [
    { q: "What is RoadSenseAI?", a: "RoadSenseAI is an AI-powered road reporting platform that automatically detects potholes from dashcam footage using advanced machine learning (YOLOv8) and GPS alignment. Citizens can report road issues and authorities can track, assign, and resolve them in real-time." },
    { q: "How does the pothole detection work?", a: "When you upload a dashcam video along with a GPX file, our pipeline samples frames, runs YOLO object detection, aligns detections with GPS coordinates using DBSCAN clustering, and publishes verified pothole events to the map." },
    { q: "Is RoadSenseAI free to use?", a: "Yes! Citizens can register for free and start uploading reports immediately. There are no fees for reporting or tracking road issues." },
    { q: "What file formats are supported?", a: "We accept MP4 video files and GPX files for GPS tracking data. Most dashcams output MP4, and most GPS loggers export GPX." },
    { q: "How do I register as an Authority official?", a: "On the registration page, select 'Authority / Official' as your role. Your account will need to be approved by an Admin before you can access the Authority dashboard." },
    { q: "What happens after I upload a report?", a: "Your video goes through our AI pipeline: frame sampling, pothole detection, GPS alignment, clustering, severity scoring, and map publishing. You can track the progress in real-time on the Upload Tracker page." },
    { q: "Can I see reports from other users?", a: "Yes! The Public Map shows all verified pothole events. You can view it without logging in." },
    { q: "How are reports assigned to authorities?", a: "Reports are automatically routed to the correct authority team based on the geographic zone of the detected pothole using reverse geocoding." },
    { q: "What is the difference between Citizen and Authority roles?", a: "Citizens upload reports and track their status. Authority officials review, assign, and resolve reports in their zone." },
    { q: "How can I contact support?", a: "Once logged in, use the Help Center in your dashboard to submit a support ticket." },
];

/** Renders the public Help Center page (onboarding + FAQ accordion). */
export default function PublicHelpPage() {
    const [scrolled, setScrolled] = useState(false);
    const [openFaq, setOpenFaq] = useState(null);
    const [theme, setTheme] = useState(() => localStorage.getItem("roadsense_theme") || "light");
    const location = useLocation();

    // Empty deps: scroll listener attached once on mount.
    useEffect(() => {
        const handler = () => setScrolled(window.scrollY > 20);
        window.addEventListener("scroll", handler);
        return () => window.removeEventListener("scroll", handler);
    }, []);

    // Sync theme to <html data-theme> and persist for cross-page consistency.
    useEffect(() => {
        document.documentElement.setAttribute("data-theme", theme);
        localStorage.setItem("roadsense_theme", theme);
    }, [theme]);

    // Smooth-scroll to the FAQ anchor when navigated with #faq. The 100ms
    // delay gives the section enough time to mount before scrollIntoView runs.
    useEffect(() => {
        if (location.hash === "#faq") {
            setTimeout(() => document.getElementById("faq")?.scrollIntoView({ behavior: "smooth" }), 100);
        }
    }, [location]);

    return (
        <div className="lp">
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
                    <Link to="/about" className="lp-link">About</Link>
                    <Link to="/map" className="lp-link">Public Map</Link>
                    <Link to="/help" className="lp-link lp-link-on">Help Center</Link>
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
            <section className="ph-hero">
                <h1>Help Center</h1>
                <p>Everything you need to know about using RoadSenseAI</p>
            </section>

            {/* ── Getting Started ── */}
            <section className="ph-section">
                <div className="ph-inner">
                    <h2>Getting Started</h2>
                    <p className="ph-sub">Choose your role and start making roads safer.</p>

                    <div className="ph-roles">
                        <div className="ph-role-card">
                            <div className="ph-role-icon ph-role-blue"><Users size={24} /></div>
                            <h3>Citizen</h3>
                            <p>Report road issues and track their resolution.</p>
                            <ul>
                                <li><Upload size={14} /> Upload dashcam video + GPX file</li>
                                <li><Cpu size={14} /> AI automatically detects potholes</li>
                                <li><MapPin size={14} /> Track reports on the interactive map</li>
                                <li><BellRing size={14} /> Get notified when issues are resolved</li>
                            </ul>
                            <Link to="/register" className="ph-role-btn">Register as Citizen</Link>
                        </div>

                        <div className="ph-role-card">
                            <div className="ph-role-icon ph-role-purple"><UserCheck size={24} /></div>
                            <h3>Authority Official</h3>
                            <p>Manage and resolve pothole reports in your zone.</p>
                            <ul>
                                <li><BarChart3 size={14} /> View assigned events dashboard</li>
                                <li><Users size={14} /> Manage your field team</li>
                                <li><ShieldCheck size={14} /> Update lifecycle statuses</li>
                                <li><HelpCircle size={14} /> Handle citizen support tickets</li>
                            </ul>
                            <Link to="/register/official" className="ph-role-btn ph-role-btn-purple">Register as Official</Link>
                        </div>
                    </div>
                </div>
            </section>

            {/* ── How It Works ── */}
            <section className="ph-section ph-section-alt">
                <div className="ph-inner">
                    <h2>How RoadSenseAI Works</h2>
                    <p className="ph-sub">From upload to verified pothole events in four steps</p>

                    <div className="ph-steps">
                        {[
                            { n: "1", t: "Upload Video", d: "Record road footage and submit through the citizen portal.", ic: Upload, c: "#3b82f6" },
                            { n: "2", t: "AI Detection", d: "YOLO model and DBSCAN clustering analyze the footage.", ic: Cpu, c: "#8b5cf6" },
                            { n: "3", t: "Team Routing", d: "Reports are assigned to the correct authority team.", ic: Users, c: "#f59e0b" },
                            { n: "4", t: "Resolution", d: "Issues are resolved and citizens are notified.", ic: CheckCircle, c: "#10b981" },
                        ].map((s) => (
                            <div key={s.n} className="ph-step-card">
                                <div className="ph-step-num" style={{ background: s.c }}>{s.n}</div>
                                <div className="ph-step-icon"><s.ic size={28} style={{ color: s.c }} /></div>
                                <h3>{s.t}</h3>
                                <p>{s.d}</p>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* ── FAQ ── */}
            <section id="faq" className="ph-section">
                <div className="ph-inner">
                    <h2>Frequently Asked Questions</h2>
                    <p className="ph-sub">Find answers to common questions.</p>

                    <div className="ph-faq-list">
                        {FAQ_DATA.map((item, i) => (
                            <div key={i} className={`ph-faq-item ${openFaq === i ? "ph-faq-open" : ""}`}>
                                <button className="ph-faq-q" onClick={() => setOpenFaq(openFaq === i ? null : i)}>
                                    <span>{item.q}</span>
                                    {openFaq === i ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                                </button>
                                {openFaq === i && <div className="ph-faq-a">{item.a}</div>}
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* ── CTA ── */}
            <section className="ph-section ph-cta">
                <h2>Ready to get started?</h2>
                <p className="ph-sub">Join RoadSenseAI and help make our roads safer.</p>
                <div className="ph-cta-row">
                    <Link to="/register" className="lp-cta-hero">Get Started Free <ArrowRight size={16} /></Link>
                    <Link to="/login" className="lp-cta-ghost">Login to Dashboard</Link>
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
