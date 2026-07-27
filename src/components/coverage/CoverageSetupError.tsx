import React from 'react';

export function CoverageSetupError(): React.ReactElement {
  return (
    <p
      role="alert"
      className="rounded-xl bg-red-50 p-3 text-xs font-semibold text-red-600 dark:bg-red-950/20 dark:text-red-400"
    >
      Coverage sections could not be prepared.
    </p>
  );
}
