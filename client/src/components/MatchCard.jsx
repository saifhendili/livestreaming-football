import { useState } from 'react';
import { Link } from 'react-router-dom';
import { STATUS_LABEL, formatTime } from '../format.js';

export function TeamLogo({ team, size = 48 }) {
  const [broken, setBroken] = useState(false);
  const style = { width: size, height: size };

  if (!team.logo || broken) {
    return (
      <span className="logo logo-fallback" style={style} aria-hidden="true">
        {[...team.name][0]}
      </span>
    );
  }
  return (
    <img
      className="logo"
      style={style}
      src={team.logo}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setBroken(true)}
    />
  );
}

export function Scoreboard({ match, large = false }) {
  const { status, score } = match;
  const hasScore = status !== 'upcoming' && score.home != null && score.away != null;

  return (
    <div className={`scoreboard ${large ? 'scoreboard-large' : ''}`}>
      {hasScore ? (
        <span className="score" dir="ltr">
          {score.home} – {score.away}
        </span>
      ) : (
        <span className="kickoff">{formatTime(match.startsAt, match.time)}</span>
      )}
      <span className={`badge badge-${status}`}>
        {status === 'live' && <span className="pulse" aria-hidden="true" />}
        {STATUS_LABEL[status]}
      </span>
      {hasScore && status !== 'live' && <span className="kickoff-small">{formatTime(match.startsAt, match.time)}</span>}
    </div>
  );
}

export default function MatchCard({ match }) {
  return (
    <Link to={`/watch/${match.id}`} className={`card card-${match.status}`}>
      <div className="card-teams">
        <div className="team">
          <TeamLogo team={match.home} />
          <span className="team-name" dir="auto">
            {match.home.name}
          </span>
        </div>
        <Scoreboard match={match} />
        <div className="team">
          <TeamLogo team={match.away} />
          <span className="team-name" dir="auto">
            {match.away.name}
          </span>
        </div>
      </div>
      {match.channel && (
        <div className="card-meta" dir="auto">
          📺 {match.channel}
        </div>
      )}
    </Link>
  );
}
