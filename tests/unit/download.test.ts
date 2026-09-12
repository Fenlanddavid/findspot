import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { triggerDownload } from '../../src/utils/download';

describe('browser download lifetime', () => {
  const anchors: Array<{ href: string; download: string; rel: string; connected: boolean; click: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> }> = [];
  beforeEach(() => {
    vi.useFakeTimers();
    anchors.length = 0;
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:download-${anchors.length}`);
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.stubGlobal('document', {
      createElement: vi.fn((tag: string) => {
        expect(tag).toBe('a');
        const anchor = { href: '', download: '', rel: '', connected: false, click: vi.fn(), remove: vi.fn() };
        anchor.click.mockImplementation(() => {
          expect(anchor.connected).toBe(true);
          expect(anchor.rel).toBe('noopener');
        });
        anchor.remove.mockImplementation(() => { anchor.connected = false; });
        anchors.push(anchor);
        return anchor;
      }),
      body: { appendChild: vi.fn(anchor => { anchor.connected = true; }) },
    });
  });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it('attaches the download link and retains its URL for 60 seconds', async () => {
    const blob = new Blob(['backup']);
    triggerDownload(blob, 'full backup.zip');
    expect(URL.createObjectURL).toHaveBeenCalledWith(blob);
    expect(anchors[0]).toMatchObject({ href: 'blob:download-1', download: 'full backup.zip', connected: false });
    expect(anchors[0].click).toHaveBeenCalledOnce();
    await Promise.resolve();
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(59_999);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:download-1');
  });

  it('keeps separate lifetimes for consecutive downloads', () => {
    triggerDownload(new Blob(['one']), 'one.json');
    vi.advanceTimersByTime(30_000);
    triggerDownload(new Blob(['two']), 'two.pdf');
    vi.advanceTimersByTime(30_000);
    expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:download-1');
    vi.advanceTimersByTime(30_000);
    expect(URL.revokeObjectURL).toHaveBeenLastCalledWith('blob:download-2');
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
  });

  it('propagates activation failure while cleaning up the link and URL', () => {
    vi.mocked(document.body.appendChild).mockImplementationOnce(() => { throw new Error('DOM unavailable'); });
    expect(() => triggerDownload(new Blob(['backup']), 'backup.zip')).toThrow('DOM unavailable');
    expect(anchors[0].remove).toHaveBeenCalledOnce();
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60_000);
    expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:download-1');
  });
});
