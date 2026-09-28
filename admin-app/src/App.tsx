import { NavLink, Route, Routes } from 'react-router-dom';
import { HelloPage, LogoutButton, useAuth } from '@queuepass/shared/web';
import { connectAuth } from './api/client';
import { LocationList } from './pages/LocationList';
import { LocationForm } from './pages/LocationForm';
import { LocationDetail } from './pages/LocationDetail';
import { EventList } from './pages/EventList';
import { EventForm } from './pages/EventForm';
import { EventDetail } from './pages/EventDetail';

const navClass = ({ isActive }: { isActive: boolean }): string =>
  `navlink${isActive ? ' navlink--active' : ''}`;

export function App(): React.ReactElement {
  // Connect synchronously during render, not in an effect: child pages fire their first
  // request in their own effects, which run before a parent's.
  const { accessToken, signIn } = useAuth();
  connectAuth({ accessToken, signIn: () => void signIn() });

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
          </nav>
          <LogoutButton />
        </div>
      </header>

      <main className="main">
        <Routes>
          <Route path="/" element={<HelloPage greetingPath="/hello/admin" />} />
          <Route path="/locations" element={<LocationList />} />
          <Route path="/locations/new" element={<LocationForm />} />
          {/* After /locations/new, so "new" is never read as an id. */}
          <Route path="/locations/:id" element={<LocationDetail />} />
          <Route path="/locations/:id/edit" element={<LocationForm />} />
          <Route path="/events" element={<EventList />} />
          <Route path="/events/new" element={<EventForm />} />
          {/* After /events/new, so "new" is never read as an id. */}
          <Route path="/events/:id" element={<EventDetail />} />
          <Route path="/events/:id/edit" element={<EventForm />} />
        </Routes>
      </main>
    </div>
  );
}
