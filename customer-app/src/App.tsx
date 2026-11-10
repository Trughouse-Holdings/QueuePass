import { Link, NavLink, Route, Routes } from 'react-router-dom';
import { LogoutButton } from '@queuepass/shared/web';
import { Cart } from './pages/Cart';
import { EventList } from './pages/EventList';
import { EntryCode } from './pages/EntryCode';
import { EventDetail } from './pages/EventDetail';
import { MyTickets } from './pages/MyTickets';
import { PrintTicket } from './pages/PrintTicket';
import { VenueList } from './pages/VenueList';
import { VenueDetail } from './pages/VenueDetail';

/**
 * QueuePass for customers: every venue and event (spec 003), getting tickets and My tickets
 * (spec 006), and the cart of held seats (spec 033). main.tsx puts this behind sign-in and the customer role (spec 001), so no route
 * renders without both.
 */
/** Spec 008: the Admin app's nav classes, so the current page is marked (research R2). */
const navClass = ({ isActive }: { isActive: boolean }): string =>
  `navlink${isActive ? ' navlink--active' : ''}`;

export function App() {
  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar__inner">
          {/* Spec 021 FR-003: the name its sign-in screen shows (the seed's client name). */}
          <p className="brand">QueuePass Tickets</p>
          <nav className="navlinks">
            <NavLink to="/events" className={navClass}>
              Events
            </NavLink>
            <NavLink to="/venues" className={navClass}>
              Venues
            </NavLink>
            <NavLink to="/my-tickets" className={navClass}>
              My tickets
            </NavLink>
            {/* Spec 033 FR-012: the cart, the customer's active reservations. */}
            <NavLink to="/cart" className={navClass}>
              Cart
            </NavLink>
          </nav>
          <LogoutButton />
        </div>
      </header>
      <main className="main">
        <Routes>
          {/* The event list is the landing page; it replaces 001's hello page (spec 003). */}
          <Route path="/" element={<EventList />} />
          <Route path="/events" element={<EventList />} />
          <Route path="/events/:id" element={<EventDetail />} />
          <Route path="/venues" element={<VenueList />} />
          <Route path="/venues/:id" element={<VenueDetail />} />
          <Route path="/my-tickets" element={<MyTickets />} />
          {/* Spec 033 FR-012: held seats, bought from here. */}
          <Route path="/cart" element={<Cart />} />
          {/* Spec 017 FR-012: the printable ticket. */}
          <Route path="/my-tickets/:ticketId/print" element={<PrintTicket />} />
          {/* Spec 018 FR-001: the live entry code. */}
          <Route path="/my-tickets/:ticketId/entry-code" element={<EntryCode />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
    </div>
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
