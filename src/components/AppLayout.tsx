import { NavLink, Outlet } from "react-router-dom";
import { signOutCurrentUser } from "../firebase/auth";

interface AppLayoutProps {
  userEmail: string;
  syncError: string;
}

function AppLayout({ userEmail, syncError }: AppLayoutProps) {
  return (
    <div className="app-shell">
      <aside className="sidebar no-print">
        <h1>IM Rounding</h1>
        <p className="privacy-warning">Use de-identified data only.</p>
        <p className="signed-in-user">{userEmail}</p>
        <nav>
          <NavLink to="/patients">Patient Board</NavLink>
          <NavLink to="/tasks">Today Tasks</NavLink>
          <NavLink to="/archive">Archive</NavLink>
          <NavLink to="/print">Print List</NavLink>
        </nav>
        <button type="button" className="secondary sign-out-button" onClick={signOutCurrentUser}>
          Sign out
        </button>
      </aside>

      <main className="main-content">
        {syncError && <p className="error-message no-print">{syncError}</p>}
        <Outlet />
      </main>
    </div>
  );
}

export default AppLayout;
