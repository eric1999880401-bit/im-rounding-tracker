import { NavLink, Outlet } from "react-router-dom";
import { signOutCurrentUser } from "../firebase/auth";
import type { UserPreferences } from "../types";
import { useT } from "../i18n";

interface AppLayoutProps {
  userName: string;
  syncError: string;
  preferences: UserPreferences;
}

function AppLayout({ userName, syncError }: AppLayoutProps) {
  const t = useT();

  return (
    <div className="app-shell">
      <aside className="sidebar no-print">
        <h1>IM Rounding</h1>
        <p className="signed-in-user">{t("app.greeting")}, {userName}</p>
        <nav>
          <NavLink to="/patients">{t("nav.patientBoard")}</NavLink>
          <NavLink to="/tasks">{t("nav.todayTasks")}</NavLink>
          <NavLink to="/archive">{t("nav.archive")}</NavLink>
          <NavLink to="/print">{t("nav.printList")}</NavLink>
          <NavLink to="/utilities">{t("nav.utilities")}</NavLink>
          <NavLink to="/settings">{t("nav.settings")}</NavLink>
        </nav>
        <button type="button" className="secondary sign-out-button" onClick={signOutCurrentUser}>
          {t("action.signOut")}
        </button>
        <p className="sidebar-privacy">De-identified data only.</p>
      </aside>

      <main className="main-content">
        {syncError && <p className="error-message no-print">{syncError}</p>}
        <Outlet />
      </main>
    </div>
  );
}

export default AppLayout;
