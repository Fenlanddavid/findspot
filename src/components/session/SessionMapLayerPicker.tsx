import { useState } from 'react';
import type { SessionMapLayerControl, SessionRasterOverlay } from '../../hooks/useSessionMapLayers';

const OVERLAYS: Array<{ key: SessionRasterOverlay; label: string; activeClass: string }> = [
  { key: 'lidar', label: 'LiDAR', activeClass: 'border-emerald-500/40 bg-emerald-500/20 text-emerald-300' },
  { key: 'lidar-wales', label: 'LiDAR Wales', activeClass: 'border-emerald-500/40 bg-emerald-500/20 text-emerald-300' },
  { key: 'os1880', label: 'OS 1895', activeClass: 'border-amber-500/40 bg-amber-500/20 text-amber-300' },
  { key: 'os1930', label: 'OS 1900', activeClass: 'border-orange-500/40 bg-orange-500/20 text-orange-300' },
];

export function SessionMapLayerPicker({ control }: { control: SessionMapLayerControl }) {
  const [open, setOpen] = useState(false);
  const anyActive = control.isSatellite || control.romanRoads || Object.values(control.overlays).some(Boolean);
  const buttonClass = (active: boolean, activeClass: string) => `flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-2xs font-bold transition-colors ${active ? activeClass : 'border-transparent text-white/55 hover:bg-white/5 hover:text-white'}`;
  return (
    <div className="relative">
      <button type="button" aria-label="Map layers" aria-expanded={open} onClick={() => setOpen(value => !value)} className={`relative grid min-h-11 min-w-11 place-items-center rounded-xl border bg-gray-950/85 shadow-lg backdrop-blur ${open || anyActive ? 'border-teal-400/50 text-teal-300' : 'border-white/10 text-gray-300'}`}>
        <span className="text-lg leading-none" aria-hidden="true">◇</span>
        {anyActive && <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-teal-300" />}
      </button>
      {open && (
        <div className="absolute right-0 top-12 z-[120] min-w-40 rounded-xl border border-white/15 bg-gray-950/95 p-2 shadow-2xl backdrop-blur-xl">
          <p className="px-1.5 pb-1 text-3xs font-black uppercase tracking-widest text-white/35">Map style</p>
          <button type="button" aria-pressed={control.isSatellite} onClick={control.toggleSatellite} className={buttonClass(control.isSatellite, 'border-teal-500/40 bg-teal-500/20 text-teal-300')}>Satellite</button>
          <p className="px-1.5 pb-1 pt-2 text-3xs font-black uppercase tracking-widest text-white/35">Overlays</p>
          {OVERLAYS.map(overlay => <button key={overlay.key} type="button" aria-pressed={control.overlays[overlay.key]} onClick={() => control.toggleOverlay(overlay.key)} className={buttonClass(control.overlays[overlay.key], overlay.activeClass)}>{overlay.label}</button>)}
          <button type="button" aria-pressed={control.romanRoads} onClick={control.toggleRomanRoads} className={buttonClass(control.romanRoads, 'border-blue-500/40 bg-blue-500/20 text-blue-300')}>
            {control.romanRoadStatus === 'zoom-in' ? 'Roman Roads — zoom in' : control.romanRoadStatus === 'unavailable' ? 'Roman Roads — unavailable' : control.romanRoadStatus === 'loading' ? 'Roman Roads — loading' : 'Roman Roads'}
          </button>
        </div>
      )}
    </div>
  );
}
