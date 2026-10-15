import { Link, NavLink, Route, Routes } from 'react-router-dom';
import InstallBanner from './components/InstallBanner.jsx';
import OfflineBanner from './components/OfflineBanner.jsx';
import ChannelWatch from './pages/ChannelWatch.jsx';
import Channels from './pages/Channels.jsx';
import Home from './pages/Home.jsx';
import TvHub from './pages/TvHub.jsx';
import Watch from './pages/Watch.jsx';

const navClass = ({ isActive }) => `nav-link ${isActive ? 'nav-link-active' : ''}`;

export default function App() {
  return (
    <>
      <header className="topbar">
        <Link to="/" className="brand">
          <span className="brand-dot" aria-hidden="true" />
          Kickoff Live
        </Link>
        <span className="tagline">Matches &amp; streams, no ads</span>
        <nav className="nav" aria-label="Sections">
          <NavLink to="/" end className={navClass}>
            Matches
          </NavLink>
          <NavLink to="/tv" className={navClass}>
            TV channels
          </NavLink>
        </nav>
      </header>
      <OfflineBanner />
      <InstallBanner />
      <main className="container">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/watch/:id" element={<Watch />} />
          <Route path="/tv" element={<TvHub />} />
          <Route path="/tv/:source" element={<Channels />} />
          <Route path="/tv/:source/:id" element={<ChannelWatch />} />
          <Route
            path="*"
            element={
              <p className="notice">
                Page not found. <Link to="/">Back to matches</Link>
              </p>
            }
          />
        </Routes>
      </main>
    </>
  );
}
