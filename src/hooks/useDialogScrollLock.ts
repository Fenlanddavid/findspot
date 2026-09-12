import { useEffect } from 'react';

let locks = 0;
let previousOverflow = '';

/** Nested dialogs retain the lock until the last dialog closes. */
export function useDialogScrollLock() {
  useEffect(() => {
    if (locks++ === 0) {
      previousOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    return () => {
      if (--locks === 0) document.body.style.overflow = previousOverflow;
    };
  }, []);
}
