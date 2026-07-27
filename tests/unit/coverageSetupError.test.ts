import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CoverageSetupError } from '../../src/components/coverage/CoverageSetupError';

describe('coverage setup error', () => {
  it('uses the shared accessible preparation failure message', () => {
    const markup = renderToStaticMarkup(React.createElement(CoverageSetupError));

    expect(markup).toContain('role="alert"');
    expect(markup).toContain('Coverage sections could not be prepared.');
  });
});
