import { Link, NavLink, Route, Routes } from 'react-router-dom';
import { LogoutButton } from '@queuepass/shared/web';
import { EventList } from './pages/EventList';
import { EventDetail } from './pages/EventDetail';
import { MyTickets } from './pages/MyTickets';
import { VenueList } from './pages/VenueList';
import { VenueDetail } from './pages/VenueDetail';

/**
 * QueuePass for customers: every venue and event (spec 003), getting tickets and My tickets
 * (spec 006). main.tsx puts this behind sign-in and the customer role (spec 001), so no route
 * renders without both.
 */
export function App() {
  return (
    <>
      <header>
        <p>QueuePass</p>
        <nav>
          <NavLink to="/events">Events</NavLink> <NavLink to="/venues">Venues</NavLink>{' '}
          <NavLink to="/my-tickets">My tickets</NavLink>
        </nav>
        <LogoutButton />
      </header>
      <main>
        <Routes>
          {/* The event list is the landing page; it replaces 001's hello page (spec 003). */}
          <Route path="/" element={<EventList />} />
          <Route path="/events" element={<EventList />} />
          <Route path="/events/:id" element={<EventDetail />} />
          <Route path="/venues" element={<VenueList />} />
          <Route path="/venues/:id" element={<VenueDetail />} />
          <Route path="/my-tickets" element={<MyTickets />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
    </>
  );
}

function NotFound() {
  return (
    <section>
      <p>Page not found.</p>
      <Link to="/events">Events</Link> <Link to="/venues">Venues</Link>
    </section>
  );
}
