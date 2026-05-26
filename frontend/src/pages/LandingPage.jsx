/**
 * Public landing page.
 *
 * Marketing entry point shown to anonymous (logged-out) visitors at "/". Renders
 * a sticky navbar, a hero section over a road photo background with primary
 * CTAs to /register and /map, plus three feature cards highlighting real-time
 * tracking, AI detection, and fast resolution. Drives top-of-funnel signup and
 * navigation into the public map / about / help pages — there are no API calls
 * or forms here.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
    ShieldCheck,
    Cpu,
    MapPin,
    Clock,
    Brain,
    ArrowRight,
    Zap,
    BellRing,
} from "lucide-react";
import logoImg from "../assets/logo.png";
import heroRoad from "../assets/hero-road.jpg";

/** Renders the public landing page with hero + feature cards. */
export default function LandingPage() {
    const [scrolled, setScrolled] = useState(false);

    // Empty deps: listener is attached once on mount and torn down on unmount.
    useEffect(() => {
        const handler = () => setScrolled(window.scrollY > 20);
        window.addEventListener("scroll", handler);
        return () => window.removeEventListener("scroll", handler);
    }, []);

    // Force light theme on the landing page regardless of the user's stored
    // preference — the hero photo + gradient brand styling are designed for it.
    useEffect(() => {
        document.documentElement.setAttribute("data-theme", "light");
    }, []);

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
                    <Link to="/" className="lp-link lp-link-on">Home</Link>
                    <Link to="/about" className="lp-link">About</Link>
                    <Link to="/map" className="lp-link">Public Map</Link>
                    <Link to="/help" className="lp-link">Help Center</Link>
                </div>
                <div className="lp-nav-right">
                    <Link to="/login" className="lp-login">Login</Link>
                    <Link to="/register" className="lp-cta-nav">Sign Up</Link>
                </div>
            </nav>

            {/* ── Hero ── */}
            <section className="lp-hero" style={{ backgroundImage: `url(${heroRoad})` }}>
                <div className="lp-hero-overlay" />
                <div className="lp-hero-inner">
                    <div className="lp-hero-left">
                        <span className="lp-pill"><Zap size={13} /> AI-Powered Infrastructure</span>
                        <h1>Smart Pothole<br />Detection for<br /><span className="lp-grad">Safer Roads</span></h1>
                        <p className="lp-desc">
                            AI-powered road reporting platform that enables quick and efficient pothole detection, tracking, and resolution.
                        </p>
                        <div className="lp-hero-actions">
                            <Link to="/register" className="lp-cta-hero">Discover Platform <ArrowRight size={16} /></Link>
                            <Link to="/map" className="lp-cta-ghost">View Public Map</Link>
                        </div>
                        <div className="lp-trust-row">
                            <span><ShieldCheck size={14} /> Government Verified</span>
                            <span><Cpu size={14} /> AI-Powered</span>
                            <span><Clock size={14} /> Real-Time Monitoring</span>
                        </div>
                    </div>
                </div>

                {/* Feature Cards */}
                <div className="lp-hero-cards">
                    <div className="lp-card">
                        <div className="lp-card-icon-wrap lp-ci-green"><MapPin size={24} /></div>
                        <h3>Real-Time Tracking</h3>
                        <p>Monitor road issues as they are reported and resolved.</p>
                    </div>
                    <div className="lp-card">
                        <div className="lp-card-icon-wrap lp-ci-blue"><Brain size={24} /></div>
                        <h3>Automatic Detection</h3>
                        <p>AI identifies and reports potholes with high accuracy.</p>
                    </div>
                    <div className="lp-card">
                        <div className="lp-card-icon-wrap lp-ci-purple"><BellRing size={24} /></div>
                        <h3>Fast Resolution</h3>
                        <p>Get notified and resolve road issues quickly and efficiently.</p>
                    </div>
                </div>
            </section>

        </div>
    );
}
