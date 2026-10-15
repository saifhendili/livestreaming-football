import { Link, Route, Routes } from 'react-router-dom';
import Home from './pages/Home.jsx';
import Watch from './pages/Watch.jsx';

export default function App() {
  return (
    <>
      <header className="topbar">
        <Link to="/" className="brand">
          <span className="brand-dot" aria-hidden="true" />
          Kickoff Live
        </Link>
        <span className="tagline">Matches &amp; streams, no ads</span>
      </header>
      <main className="container">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/watch/:id" element={<Watch />} />
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
