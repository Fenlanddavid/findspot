import { useState } from 'react';
import type { SessionMapLayerControl, SessionRasterOverlay } from '../../hooks/useSessionMapLayers';

const OVERLAYS: Array<{ key: SessionRasterOverlay; label: string; activeClass: string }> = [
  { key: 'lidar', label: 'LiDAR', activeClass: 'border-emerald-500/40 bg-emerald-500/20 text-emerald-300' },
  { key: 'lidar-wales', label: 'LiDAR Wales', activeClass: 'border-emerald-500/40 bg-emerald-500/20 text-emerald-300' },
  { key: 'relief', label: 'Multi-angle relief', activeClass: 'border-cyan-500/40 bg-cyan-500/20 text-cyan-300' },
  { key: 'os1880', label: 'OS 1895', activeClass: 'border-amber-500/40 bg-amber-500/20 text-amber-300' },
  { key: 'os1930', label: 'OS 1900', activeClass: 'border-orange-500/40 bg-orange-500/20 text-orange-300' },
];

const OPACITY_LABELS: Record<SessionRasterOverlay, string> = {
  lidar: 'LiDAR',
  'lidar-wales': 'LiDAR Wales',
  relief: 'Multi-angle relief',
  os1880: 'OS 1895',
  os1930: 'OS 1900',
};

export type SessionFieldHistoryLayerControl = {
  trailsAvailable: boolean;
  trailsVisible: boolean;
  toggleTrails: () => void;
  findsAvailable: boolean;
  findsVisible: boolean;
  toggleFinds: () => void;
};

export type SessionGapLayerControl = {
  available: boolean;
  visible: boolean;
  toggle: () => void;
};

export function SessionMapLayerPicker({ control, fieldHistory, gaps }: { control: SessionMapLayerControl; fieldHistory?: SessionFieldHistoryLayerControl; gaps?: SessionGapLayerControl }) {
  const [open, setOpen] = useState(false);
  const anyActive = control.isSatellite || control.romanRoads || Object.values(control.overlays).some(Boolean) || !!fieldHistory?.trailsVisible || !!fieldHistory?.findsVisible || !!gaps?.visible;
  const buttonClass = (active: boolean, activeClass: string) => `flex min-h-10 w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-2xs font-bold transition-colors disabled:cursor-not-allowed disabled:border-transparent disabled:text-white/25 ${active ? activeClass : 'border-transparent text-white/55 hover:bg-white/5 hover:text-white'}`;
  return (
    <div className="relative">
      <button type="button" aria-label="Map layers" aria-expanded={open} onClick={() => setOpen(value => !value)} className={`relative grid min-h-11 min-w-11 place-items-center rounded-xl border bg-gray-950/85 shadow-lg backdrop-blur ${open || anyActive ? 'border-teal-400/50 text-teal-300' : 'border-white/10 text-gray-300'}`}>
        <span className="text-lg leading-none" aria-hidden="true">◇</span>
        {anyActive && <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-teal-300" />}
      </button>
      {open && (
        <div className="fixed right-20 top-[calc(7rem+env(safe-area-inset-top))] z-[120] max-h-[calc(100dvh-12rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))] min-w-44 overflow-y-auto rounded-xl border border-white/15 bg-gray-950/95 p-2 shadow-2xl backdrop-blur-xl">
          {gaps && <>
            <p className="px-1.5 pb-1 text-3xs font-black uppercase tracking-widest text-white/35">Coverage</p>
            <button type="button" disabled={!gaps.available} aria-pressed={gaps.visible} onClick={gaps.toggle} className={buttonClass(gaps.visible, 'border-orange-500/40 bg-orange-500/20 text-orange-200')}>Show gaps</button>
          </>}
          {fieldHistory && <>
            <p className={`px-1.5 pb-1 text-3xs font-black uppercase tracking-widest text-white/35 ${gaps ? 'pt-2' : ''}`}>Field history</p>
            <button type="button" disabled={!fieldHistory.trailsAvailable} aria-pressed={fieldHistory.trailsVisible} onClick={fieldHistory.toggleTrails} className={buttonClass(fieldHistory.trailsVisible, 'border-cyan-500/40 bg-cyan-500/20 text-cyan-200')}>Field trails</button>
            <button type="button" disabled={!fieldHistory.findsAvailable} aria-pressed={fieldHistory.findsVisible} onClick={fieldHistory.toggleFinds} className={buttonClass(fieldHistory.findsVisible, 'border-amber-500/40 bg-amber-500/20 text-amber-200')}>Past finds</button>
          </>}
          <p className={`px-1.5 pb-1 text-3xs font-black uppercase tracking-widest text-white/35 ${fieldHistory || gaps ? 'pt-2' : ''}`}>Map style</p>
          <button type="button" aria-pressed={control.isSatellite} onClick={control.toggleSatellite} className={buttonClass(control.isSatellite, 'border-teal-500/40 bg-teal-500/20 text-teal-300')}>Satellite</button>
          <p className="px-1.5 pb-1 pt-2 text-3xs font-black uppercase tracking-widest text-white/35">Overlays</p>
          {OVERLAYS.map(overlay => <button key={overlay.key} type="button" aria-pressed={control.overlays[overlay.key]} onClick={() => { control.toggleOverlay(overlay.key); setOpen(false); }} className={buttonClass(control.overlays[overlay.key], overlay.activeClass)}>{overlay.label}</button>)}
          <button type="button" aria-pressed={control.romanRoads} onClick={control.toggleRomanRoads} className={buttonClass(control.romanRoads, 'border-blue-500/40 bg-blue-500/20 text-blue-300')}>
            {control.romanRoadStatus === 'zoom-in' ? 'Roman Roads — zoom in' : control.romanRoadStatus === 'unavailable' ? 'Roman Roads — unavailable' : control.romanRoadStatus === 'loading' ? 'Roman Roads — loading' : 'Roman Roads'}
          </button>
        </div>
      )}
      {control.activeOpacityLayer && !open && (
        <div className="absolute bottom-12 right-0 z-[120] flex h-48 w-11 flex-col items-center gap-2 rounded-2xl border border-emerald-500/35 bg-gray-950/95 px-1.5 py-2 shadow-2xl backdrop-blur-xl">
          <span className="text-[0.5rem] font-black leading-none text-emerald-300">{Math.round(control.overlayOpacity[control.activeOpacityLayer] * 100)}%</span>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(control.overlayOpacity[control.activeOpacityLayer] * 100)}
            onChange={event => control.setOverlayOpacity(control.activeOpacityLayer!, Number(event.target.value) / 100)}
            aria-label={`${OPACITY_LABELS[control.activeOpacityLayer]} opacity`}
            className="min-h-0 w-8 flex-1 accent-emerald-400"
            style={{ writingMode: 'vertical-rl', direction: 'rtl' }}
          />
          <span className="text-center text-[0.4375rem] font-black uppercase leading-tight tracking-widest text-white/45">{OPACITY_LABELS[control.activeOpacityLayer]}</span>
        </div>
      )}
    </div>
  );
}
