import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { safeExternalHttpUrl } from '../../../src/utils/safeExternalUrl';

const payloads = ['<script>alert(1)</script>', '<img src=x onerror=alert(1)>', '\"><svg onload=alert(1)>'];
const fields = ['permission name', 'field name', 'landowner name', 'find description', 'note', 'saved point', 'surface observation', 'undug signal', 'event name', 'organiser name', 'public notes'];

describe('hostile rendering', () => {
  it.each(fields)('renders hostile %s values as text', field => {
    const markup = renderToStaticMarkup(<div data-field={field}>{payloads.join(' ')}</div>);
    expect(markup).not.toContain('<script>');
    expect(markup).not.toContain('<img');
    expect(markup).not.toContain('<svg');
    expect(markup).toContain('&lt;script&gt;');
  });

  it('rejects executable and credential-bearing external URLs', () => {
    expect(safeExternalHttpUrl('javascript:alert(1)')).toBeNull();
    expect(safeExternalHttpUrl('data:text/html,<script>alert(1)</script>')).toBeNull();
    expect(safeExternalHttpUrl('https://user:pass@example.test/path')).toBeNull();
    expect(safeExternalHttpUrl('https://example.test/path')).toBe('https://example.test/path');
  });
});
