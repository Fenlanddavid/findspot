import type { WorkflowState } from '../types/significantFind';
import { ActiveSessionGuideWorkspace } from '../components/session/ActiveSessionGuideWorkspace';

type FieldGuideControllerProps = {
  projectId: string;
  onSignificantFind?: (initialContext?: Partial<WorkflowState>) => void;
};

/**
 * Page boundary: composition and navigation ownership only. Scan orchestration,
 * persistence and interaction state live behind the FieldGuide workspace.
 */
export default function FieldGuideController(props: FieldGuideControllerProps) {
  return <ActiveSessionGuideWorkspace {...props} />;
}
