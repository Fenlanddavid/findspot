import { afterEach, describe, expect, it, vi } from 'vitest';
import { triggerDownload } from '../../src/utils/download';
import { downloadShareCard, shareOrDownloadBlob, shareOrDownloadBlobs } from '../../src/services/share';

vi.mock('../../src/utils/download', () => ({ triggerDownload: vi.fn() }));
vi.mock('html2canvas', () => ({ default: vi.fn(async () => ({
  toBlob: (callback: (blob: Blob) => void) => callback(new Blob(['card'], { type: 'image/png' })),
})) }));
afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); });

describe('shared download filenames and native sharing', () => {
  it('keeps the PNG extension on share-card downloads', async () => {
    await downloadShareCard({} as HTMLElement, 'findspot-card');
    expect(triggerDownload).toHaveBeenCalledWith(expect.any(Blob), 'findspot-card.png');
  });
  it('keeps supplied extensions and infers photo extensions for single and multiple fallbacks', async () => {
    vi.stubGlobal('navigator', {});
    const blob = new Blob(['photo'], { type: 'image/png' });
    await shareOrDownloadBlob(blob, 'original.png');
    await shareOrDownloadBlobs([{ blob, filename: 'first' }, { blob, filename: 'second.png' }]);
    expect(vi.mocked(triggerDownload).mock.calls.map(([, filename]) => filename)).toEqual(['original.png', 'first.png', 'second.png']);
  });
  it('uses native sharing when supported without also downloading', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { share, canShare: () => true });
    await shareOrDownloadBlob(new Blob(['photo'], { type: 'image/png' }), 'photo');
    expect(share).toHaveBeenCalledOnce();
    expect(triggerDownload).not.toHaveBeenCalled();
  });
});
