import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { NoticeState } from '../hooks/use-delete';
import { SuccessState } from './SuccessState';

/**
 * Shows a one-time message handed over by navigation, such as `Deleted "Freedom Hall".`
 * (spec 002 research R5). The message is kept in component state, then cleared from history,
 * so a reload does not show it again.
 */
export function Notice(): React.ReactElement | null {
  const location = useLocation();
  const navigate = useNavigate();
  const [notice] = useState(() => (location.state as NoticeState | null)?.notice ?? null);

  useEffect(() => {
    if (notice) navigate(location.pathname, { replace: true, state: null });
    // Run once, on arrival.
  }, []);

  if (!notice) return null;
  if (notice.kind === 'success') return <SuccessState message={notice.text} />;
  return (
    <div role="status" className="banner">
      <div className="banner__body">
        <p>{notice.text}</p>
      </div>
    </div>
  );
}
