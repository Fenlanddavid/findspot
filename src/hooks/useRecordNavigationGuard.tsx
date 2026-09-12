import { useCallback, useEffect, useRef, type RefObject } from 'react';
import { useBeforeUnload, useBlocker } from 'react-router';
import { useConfirmDialog } from '../components/ConfirmModal';

export function useRecordNavigationGuard(dirty: boolean, saving: RefObject<boolean>, onDiscard: () => void) {
  const discardRef = useRef(onDiscard);
  discardRef.current = onDiscard;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const blocker = useBlocker(() => dirtyRef.current || saving.current);
  const { confirm, dialog } = useConfirmDialog();
  const asking = useRef(false);
  useBeforeUnload(useCallback((event: BeforeUnloadEvent) => {
    if (dirtyRef.current || saving.current) { event.preventDefault(); event.returnValue = ''; }
  }, [saving]));
  useEffect(() => {
    if (blocker.state !== 'blocked' || asking.current) return;
    if (saving.current) { blocker.reset(); return; }
    asking.current = true;
    void confirm({ title: 'Leave this record?', message: 'Your latest changes and selected photos have not been saved. Save this record to keep them.', confirmLabel: 'Discard changes', cancelLabel: 'Keep editing', danger: true }).then(discard => {
      if (discard) { discardRef.current(); blocker.proceed(); } else blocker.reset();
      asking.current = false;
    });
  }, [blocker, confirm, saving]);
  return { dialog, committed: () => { dirtyRef.current = false; } };
}
