import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react';

export function useActiveSessionGuideCalm(input: {
  embedded: boolean;
  hasScanned: boolean;
  analyzing: boolean;
  setSheetExpanded: Dispatch<SetStateAction<boolean>>;
}) {
  const collapsedRef = useRef(false);
  useEffect(() => {
    if (!input.embedded || !input.hasScanned || input.analyzing || collapsedRef.current) return;
    collapsedRef.current = true;
    input.setSheetExpanded(false);
  }, [input.analyzing, input.embedded, input.hasScanned, input.setSheetExpanded]);
}
