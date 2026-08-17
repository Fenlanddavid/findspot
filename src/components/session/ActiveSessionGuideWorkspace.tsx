import { useNavigate, useSearchParams } from 'react-router';
import type { WorkflowState } from '../../types/significantFind';
import { FieldGuideWorkspace } from '../fieldGuide/FieldGuideWorkspace';
import { ActiveSessionShellHeader, ActiveSessionShellNav, type ActiveWorkspaceDestination } from './ActiveSessionWorkspace';
import { ephemeralSession } from '../../services/clientStorage';
import { useActiveSessionGuideContext } from '../../hooks/useActiveSessionGuideContext';

export function ActiveSessionGuideWorkspace(props: {
  projectId: string;
  onSignificantFind?: (initialContext?: Partial<WorkflowState>) => void;
}) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get('sessionId');
  const sessionContext = useActiveSessionGuideContext(sessionId);
  const { embeddedInSession } = sessionContext;
  const selectDestination = (destination: ActiveWorkspaceDestination) => {
    if (!sessionId || destination === 'guide') return;
    ephemeralSession.set(`fs_v5_workspace_tab:${sessionId}`, destination);
    navigate(`/session/${sessionId}`);
  };

  return (
    <div className={embeddedInSession ? 'fixed inset-0 z-[70] flex flex-col overflow-hidden bg-gray-950 text-white' : 'contents'}>
      {embeddedInSession && (
        <ActiveSessionShellHeader
          permissionName={sessionContext.permissionName}
          durationText={sessionContext.durationText}
          findCount={sessionContext.findCount}
          isTracking={sessionContext.isTracking}
          isCompanionTracking={sessionContext.isCompanionTracking}
          hasRecordedTrail={sessionContext.hasRecordedTrail}
          fieldName={sessionContext.fieldName} pendingCount={sessionContext.pendingCount} trackingStatus={sessionContext.trackingStatus} boundaryStatus={sessionContext.boundaryStatus}
          onPermission={() => navigate(sessionContext.permissionId ? `/permission/${sessionContext.permissionId}` : '/')}
          onFinish={() => navigate(`/session/${sessionId}?finish=1`)}
        />
      )}
      <main className={embeddedInSession ? 'min-h-0 flex-1 overflow-hidden pb-[calc(4rem+env(safe-area-inset-bottom))]' : ''}>
        <FieldGuideWorkspace key="field-guide-workspace" {...props} embeddedSessionShell={embeddedInSession} />
      </main>
      {embeddedInSession && <ActiveSessionShellNav active="guide" onSelect={selectDestination} />}
    </div>
  );
}
