import React from "react";
import { WorkflowState, WorkflowStep, WorkflowPath, initialWorkflowState } from "../types/significantFind";

type OpenOptions = {
  triggeredBy?: "auto" | "manual";
  initialContext?: Partial<WorkflowState>;
};

type UseSignificantFindWorkflowReturn = {
  isOpen: boolean;
  workflowState: WorkflowState;
  open: (opts?: OpenOptions) => void;
  close: () => void;
  updateState: (patch: Partial<WorkflowState>) => void;
  goToStep: (step: WorkflowStep) => void;
  setPath: (path: WorkflowPath) => void;
};

export function useSignificantFindWorkflow(projectId: string): UseSignificantFindWorkflowReturn {
  const [isOpen, setIsOpen] = React.useState(false);
  const [workflowState, setWorkflowState] = React.useState<WorkflowState>(() =>
    initialWorkflowState(projectId)
  );

  const open = React.useCallback(
    (opts?: OpenOptions) => {
      const base = initialWorkflowState(projectId);
      setWorkflowState({
        ...base,
        triggeredBy: opts?.triggeredBy ?? "manual",
        ...opts?.initialContext,
      });
      setIsOpen(true);
    },
    [projectId]
  );

  const close = React.useCallback(() => {
    setIsOpen(false);
  }, []);

  const updateState = React.useCallback((patch: Partial<WorkflowState>) => {
    setWorkflowState(prev => ({ ...prev, ...patch }));
  }, []);

  const goToStep = React.useCallback((step: WorkflowStep) => {
    setWorkflowState(prev => ({ ...prev, currentStep: step }));
  }, []);

  const setPath = React.useCallback((path: WorkflowPath) => {
    setWorkflowState(prev => ({ ...prev, path }));
  }, []);

  return { isOpen, workflowState, open, close, updateState, goToStep, setPath };
}
