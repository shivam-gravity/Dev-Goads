import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";

/**
 * Thin top-of-page loading bar shown on every route change — the same UX the Polluxa CRM ships
 * (react-top-loading-bar, color #1b9cde, 5px tall) so navigating between the CRM and this app
 * feels continuous. Pure CSS/state, no dependency: on each pathname change it animates a bar from
 * 0 → ~90% while the new view mounts, then snaps to 100% and fades out. Styles: .route-progress-bar.
 */
export default function RouteProgressBar() {
  const location = useLocation();
  const [progress, setProgress] = useState(0);
  const [visible, setVisible] = useState(false);
  const timers = useRef<number[]>([]);

  useEffect(() => {
    // clear any in-flight timers from a rapid navigation
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];

    setVisible(true);
    setProgress(8);
    // ease up toward 90% while the route's view mounts/hydrates
    timers.current.push(window.setTimeout(() => setProgress(45), 60));
    timers.current.push(window.setTimeout(() => setProgress(72), 180));
    timers.current.push(window.setTimeout(() => setProgress(90), 380));
    // complete + fade
    timers.current.push(window.setTimeout(() => setProgress(100), 520));
    timers.current.push(window.setTimeout(() => setVisible(false), 760));
    timers.current.push(window.setTimeout(() => setProgress(0), 900));

    return () => {
      timers.current.forEach((t) => window.clearTimeout(t));
      timers.current = [];
    };
  }, [location.pathname]);

  return (
    <div className="route-progress" aria-hidden="true">
      <div
        className="route-progress-bar"
        style={{ width: `${progress}%`, opacity: visible ? 1 : 0 }}
      />
    </div>
  );
}
