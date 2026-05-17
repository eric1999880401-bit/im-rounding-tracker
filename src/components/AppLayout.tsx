import { NavLink, Outlet } from "react-router-dom";
import { useEffect, useState, type ReactElement } from "react";
import { signOutCurrentUser } from "../firebase/auth";
import type { UserPreferences } from "../types";
import { useT } from "../i18n";

interface AppLayoutProps {
  userName: string;
  syncError: string;
  preferences: UserPreferences;
  isDemoMode?: boolean;
  onExitDemo?: () => void;
}

const SIDEBAR_STORAGE_KEY = "im-rounding-sidebar-collapsed";

function readInitialCollapsed() {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function IconPatients() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="4" y="3" width="16" height="18" rx="2.5" />
      <path d="M9 3v3h6V3" />
      <path d="M8 12h8M8 16h5" />
    </svg>
  );
}

function IconTasks() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 11l2 2 4-4" />
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
    </svg>
  );
}

function IconArchive() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="4" rx="1" />
      <path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8" />
      <path d="M10 13h4" />
    </svg>
  );
}

function IconPrinter() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M7 9V4h10v5" />
      <rect x="4" y="9" width="16" height="8" rx="2" />
      <rect x="7" y="14" width="10" height="6" rx="1" />
    </svg>
  );
}

function IconUtilities() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L4 17v3h3l5.3-5.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2-2 2.5-2.5z" />
    </svg>
  );
}

function IconAiDocuments() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 3h8l4 4v14H6z" />
      <path d="M14 3v5h4" />
      <path d="M9 13h6M9 17h4" />
      <path d="M9 8l.5 1.4L11 10l-1.5.6L9 12l-.5-1.4L7 10l1.5-.6z" />
    </svg>
  );
}

function IconSettings() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1A2 2 0 1 1 4.3 17l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1A2 2 0 1 1 7 4.3l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </svg>
  );
}

function IconSignOut() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="M16 17l5-5-5-5" />
      <path d="M21 12H9" />
    </svg>
  );
}

function IconChevron({ collapsed }: { collapsed: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ transform: collapsed ? "rotate(180deg)" : "none", transition: "transform 200ms ease" }}
    >
      <path d="M15 18l-6-6 6-6" />
    </svg>
  );
}

function AppLayout({ userName, syncError, isDemoMode = false, onExitDemo }: AppLayoutProps) {
  const t = useT();
  const [collapsed, setCollapsed] = useState<boolean>(readInitialCollapsed);

  useEffect(() => {
    try {
      window.localStorage.setItem(SIDEBAR_STORAGE_KEY, collapsed ? "1" : "0");
    } catch {
      // ignore storage errors (e.g. private mode)
    }
  }, [collapsed]);

  const navItems: Array<{ to: string; labelKey: string; icon: () => ReactElement }> = [
    { to: "/patients", labelKey: "nav.patientBoard", icon: IconPatients },
    { to: "/tasks", labelKey: "nav.todayTasks", icon: IconTasks },
    { to: "/archive", labelKey: "nav.archive", icon: IconArchive },
    { to: "/print", labelKey: "nav.printList", icon: IconPrinter },
    { to: "/ai-documents", labelKey: "nav.aiDocuments", icon: IconAiDocuments },
    { to: "/utilities", labelKey: "nav.utilities", icon: IconUtilities },
    { to: "/settings", labelKey: "nav.settings", icon: IconSettings },
  ];

  const sessionActionLabel = isDemoMode ? "Exit demo" : t("action.switchUser");
  const handleSessionAction = isDemoMode && onExitDemo ? onExitDemo : signOutCurrentUser;

  return (
    <div className={`app-shell${collapsed ? " app-shell-collapsed" : ""}`}>
      <aside className={`sidebar no-print${collapsed ? " sidebar-collapsed" : ""}`}>
        <div className="sidebar-header">
          <div className="sidebar-brand">
            <span className="sidebar-brand-mark">IM</span>
            <span className="sidebar-brand-text">
              <span className="sidebar-brand-title">IM Rounding</span>
              <span className="sidebar-brand-sub">Tracker</span>
            </span>
          </div>
          <button
            type="button"
            className="sidebar-toggle"
            onClick={() => setCollapsed((value) => !value)}
            aria-label={collapsed ? t("nav.expandSidebar") : t("nav.collapseSidebar")}
            title={collapsed ? t("nav.expandSidebar") : t("nav.collapseSidebar")}
          >
            <IconChevron collapsed={collapsed} />
          </button>
        </div>

        <div className="sidebar-user" title={userName}>
          <span className="sidebar-user-avatar">{userName ? userName.slice(0, 1).toUpperCase() : "?"}</span>
          <span className="sidebar-user-text">
            <span className="sidebar-user-greet">{t("app.currentUser")}</span>
            <span className="sidebar-user-name">{userName}</span>
          </span>
        </div>

        <nav>
          {navItems.map(({ to, labelKey, icon: Icon }) => (
            <NavLink key={to} to={to} title={t(labelKey)}>
              <span className="nav-icon">
                <Icon />
              </span>
              <span className="nav-label">{t(labelKey)}</span>
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-footer">
          <button
            type="button"
            className="secondary sign-out-button"
            onClick={handleSessionAction}
            title={sessionActionLabel}
          >
            <span className="nav-icon">
              <IconSignOut />
            </span>
            <span className="nav-label">{sessionActionLabel}</span>
          </button>
          <p className="sidebar-privacy">{t("app.privacyShort")}</p>
        </div>
      </aside>

      <main className="main-content">
        {isDemoMode && (
          <div className="demo-mode-banner no-print">
            <strong>Local demo mode</strong>
            <span>Fictional patients only. Edits stay in this browser session and do not read or write Firestore.</span>
          </div>
        )}
        {syncError && <p className="error-message no-print">{syncError}</p>}
        <Outlet />
      </main>
    </div>
  );
}

export default AppLayout;
