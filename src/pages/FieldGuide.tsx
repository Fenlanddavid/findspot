import type { WorkflowState } from '../types/significantFind';
import FieldGuideController from './FieldGuideController';

interface FieldGuideProps {
    projectId: string;
    onSignificantFind?: (initialContext?: Partial<WorkflowState>) => void;
}

export default function FieldGuide(props: FieldGuideProps) {
    return <FieldGuideController {...props} />;
}
