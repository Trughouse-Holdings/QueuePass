import { NavLink, Outlet, useMatch, useRoutes, type RouteObject } from 'react-router-dom';
import { HelloPage, LogoutButton, useAuth } from '@queuepass/shared/web';
import { connectAuth } from './api/client';
import { LocationList } from './pages/LocationList';
import { LocationForm } from './pages/LocationForm';
import { LocationDetail } from './pages/LocationDetail';
import { EventList } from './pages/EventList';
import { EventForm } from './pages/EventForm';
import { EventDetail } from './pages/EventDetail';
import { Attendees } from './pages/Attendees';
import { Reports } from './pages/Reports';
import { LayoutEditorPage } from './layout-editor/LayoutEditor';

const navClass = ({ isActive }: { isActive: boolean }): string =>
  `navlink${isActive ? ' navlink--active' : ''}`;

/** The top bar and the page under it: every route's layout. */
function AppShell(): React.ReactElement {
  // Connect synchronously during render, not in an effect: child pages fire their first
  // request in their own effects, which run before a parent's.
  const { accessToken, signIn } = useAuth();
  connectAuth({ accessToken, signIn: () => void signIn() });
  // Spec 039 research R14: the layout editor is full width under the top bar.
  const editing = useMatch('/locations/:id/layouts/*');

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar__inner">
          <NavLink to="/locations" className="brand">
            <span className="brand__mark" aria-hidden="true">
              Q
            </span>
            QueuePass Admin
          </NavLink>
          <nav className="navlinks">
            <NavLink to="/locations" className={navClass}>
              Venues
            </NavLink>
            <NavLink to="/events" className={navClass}>
              Events
            </NavLink>
            <NavLink to="/reports" className={navClass}>
              Reports
            </NavLink>
          </nav>
          <LogoutButton />
        </div>
      </header>

      <main className={editing ? 'main main--full' : 'main'}>
        <Outlet />
      </main>
    </div>
  );
}

/** The pages that export what they show name the signed-in admin as its maker. */
function AttendeesPage(): React.ReactElement {
  return <Attendees username={useAuth().username} />;
}
function ReportsPage(): React.ReactElement {
  return <Reports username={useAuth().username} />;
}

/**
 * The Admin app's routes. Spec 039 research R13: `main.tsx` serves them from a data router
 * (`createBrowserRouter`), so the layout editor can confirm before leaving with unsaved changes
 * (`useBlocker`); `<App />` serves the same routes under any router, as the page tests use.
 */
export const routes: RouteObject[] = [
  {
    element: <AppShell />,
    children: [
      { path: '/', element: <HelloPage greetingPath="/hello/admin" /> },
      { path: '/locations', element: <LocationList /> },
      { path: '/locations/new', element: <LocationForm /> },
      // After /locations/new, so "new" is never read as an id.
      { path: '/locations/:id', element: <LocationDetail /> },
      { path: '/locations/:id/edit', element: <LocationForm /> },
      // Spec 039 (R14): the layout editor, for a new layout or an existing one.
      { path: '/locations/:id/layouts/new', element: <LayoutEditorPage /> },
      { path: '/locations/:id/layouts/:layoutId/edit', element: <LayoutEditorPage /> },
      { path: '/events', element: <EventList /> },
      { path: '/events/new', element: <EventForm /> },
      // After /events/new, so "new" is never read as an id.
      { path: '/events/:id', element: <EventDetail /> },
      { path: '/events/:id/edit', element: <EventForm /> },
      { path: '/events/:id/attendees', element: <AttendeesPage /> },
      { path: '/reports', element: <ReportsPage /> },
    ],
  },
];

export function App(): React.ReactElement | null {
  return useRoutes(routes);
}
