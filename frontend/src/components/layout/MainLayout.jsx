/**
 * MainLayout — Sidebar + Topbar shell for logged-in pages.
 * Landing and Login pages render outside this layout (they have their own chrome).
 */
import Sidebar from "./Sidebar";
import Topbar from "./Topbar";

export default function MainLayout({ children }) {
    return (
        <div className="app-layout">
            <Sidebar />
            <div className="main-content">
                <Topbar />
                <main className="page-content">
                    {children}
                </main>
            </div>
        </div>
    );
}
