import React from "react";
import { useLocation } from "react-router-dom";
import QuickFindFab from "./QuickFindFab";
import type { WorkflowState } from "../types/significantFind";

export default function GlobalActions({ projectId, onSignificantFind }: { projectId: string; onSignificantFind?: (initialContext?: Partial<WorkflowState>) => void }) {
  const location = useLocation();
  const [homeFabVisible, setHomeFabVisible] = React.useState(() => location.pathname !== "/" || window.scrollY > 180);

  React.useEffect(() => {
    if (location.pathname !== "/") {
      setHomeFabVisible(true);
      return;
    }
    const update = () => setHomeFabVisible(window.scrollY > 180);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, [location.pathname]);

  const hideOn = ["/settings", "/finds-box", "/fieldguide"];
  if (hideOn.includes(location.pathname)) return null;
  if (location.pathname.startsWith("/find")) return null;
  if (location.pathname === "/permission" || location.pathname.startsWith("/permission/")) return null;
  if (location.pathname.startsWith("/session/")) return null;

  return (
    <QuickFindFab
      projectId={projectId}
      showPendingBadge
      onSignificantFind={onSignificantFind}
      containerClassName={`fixed bottom-[calc(5.25rem+env(safe-area-inset-bottom))] right-4 z-40 flex-col items-end gap-3 pointer-events-none sm:bottom-6 sm:right-6 sm:flex ${homeFabVisible ? "flex" : "hidden"}`}
    />
  );
}
