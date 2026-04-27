import React from 'react';
import { Find, Permission } from '../db';

interface ShareCardProps {
  find?: Find;
  photoUrl?: string; // legacy fallback
  photoUrlFront?: string;
  photoUrlBack?: string;
  permission?: Permission;
  type: 'find' | 'find-of-the-day';
}

function CardLogoGroup() {
  return (
    <div className="flex items-center gap-4">
      <svg width="52" height="52" viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="logo-grad-card-v15" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#10b981" />
            <stop offset="50%" stopColor="#14b8a6" />
            <stop offset="100%" stopColor="#0ea5e9" />
          </linearGradient>
        </defs>
        <circle cx="256" cy="256" r="200" stroke="url(#logo-grad-card-v15)" strokeWidth="32" fill="none" />
        <circle cx="256" cy="256" r="120" stroke="url(#logo-grad-card-v15)" strokeWidth="24" fill="none" opacity="0.6" />
        <circle cx="256" cy="256" r="50" fill="url(#logo-grad-card-v15)" />
        <rect x="244" y="20" width="24" height="80" rx="4" fill="url(#logo-grad-card-v15)" opacity="0.4" />
        <rect x="244" y="412" width="24" height="80" rx="4" fill="url(#logo-grad-card-v15)" opacity="0.4" />
        <rect x="20" y="244" width="80" height="24" rx="4" fill="url(#logo-grad-card-v15)" opacity="0.4" />
        <rect x="412" y="244" width="80" height="24" rx="4" fill="url(#logo-grad-card-v15)" opacity="0.4" />
      </svg>

      <div className="flex flex-col leading-none">
        <svg width="190" height="38" viewBox="0 0 190 38" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="findspot-text-grad-v15" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#10b981" />
              <stop offset="50%" stopColor="#14b8a6" />
              <stop offset="100%" stopColor="#0ea5e9" />
            </linearGradient>
          </defs>
          <text
            x="0"
            y="32"
            fill="url(#findspot-text-grad-v15)"
            style={{ fontSize: '34px', fontWeight: 900, fontFamily: '"Inter", sans-serif', letterSpacing: '-0.06em' }}
          >
            FindSpot
          </text>
        </svg>
        <span className="text-[11px] uppercase tracking-[0.35em] text-white/35 font-bold mt-0.5">
          Discovery Record
        </span>
      </div>
    </div>
  );
}

function ImagePanel({
  src,
  label,
}: {
  src?: string;
  label: string;
}) {
  return (
    <div className="relative h-full rounded-[2rem] overflow-hidden border border-white/10 bg-[#08111f] shadow-[0_20px_60px_-20px_rgba(0,0,0,0.85)]">
      <div className="absolute top-4 left-4 z-10 px-3 py-1.5 rounded-full bg-black/45 backdrop-blur-md border border-white/10">
        <span className="text-[11px] uppercase tracking-[0.25em] text-white/75 font-bold">{label}</span>
      </div>

      {src ? (
        <div
          className="w-full h-full"
          style={{
            backgroundImage: `url(${src})`,
            backgroundSize: 'contain',
            backgroundRepeat: 'no-repeat',
            backgroundPosition: 'center',
          }}
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-white/10 uppercase tracking-[0.45em] text-sm font-black">
          No Image
        </div>
      )}

      <div className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/35 to-transparent pointer-events-none" />
    </div>
  );
}

function MetaChip({
  label,
  value,
  align = 'left',
}: {
  label: string;
  value?: string | number | null;
  align?: 'left' | 'center' | 'right';
}) {
  const alignClass =
    align === 'center' ? 'items-center text-center' : align === 'right' ? 'items-end text-right' : 'items-start text-left';

  return (
    <div className={`flex flex-col ${alignClass} rounded-2xl border border-white/8 bg-white/[0.03] px-5 py-4`}>
      <div className="text-[11px] uppercase font-black tracking-[0.28em] text-emerald-400/55 mb-2">{label}</div>
      <div className="text-[24px] font-bold text-white/88 leading-tight break-words">{value || '--'}</div>
    </div>
  );
}

export const ShareCard = React.forwardRef<HTMLDivElement, ShareCardProps>((props, ref) => {
  const { find, photoUrl, photoUrlFront, photoUrlBack, permission, type } = props;

  if (!find) return null;

  const isCoin =
    find.findCategory === 'Coin' ||
    find.findCategory === 'Token / Jetton' ||
    !!find.coinType ||
    !!find.coinDenomination ||
    (!find.findCategory && find.objectType?.toLowerCase().includes('coin'));

  const mainTitle = isCoin && find.coinType ? `${find.coinType} Coin` : find.objectType || 'Recorded Find';
  const subTitle = isCoin ? find.coinDenomination : find.ruler || null;

  const frontImage = photoUrlFront || photoUrl;
  const backImage = photoUrlBack;
  const hasBack = !!backImage;

  const frontLabel = hasBack ? (isCoin ? 'Obverse' : 'Front') : 'Image';
  const backLabel = isCoin ? 'Reverse' : 'Back';

  const cardStyle: React.CSSProperties = {
    width: '1080px',
    height: '1350px',
    background:
      'radial-gradient(circle at top, rgba(16,185,129,0.10) 0%, rgba(2,6,23,1) 38%), linear-gradient(180deg, #07111f 0%, #020617 100%)',
    color: 'white',
    display: 'flex',
    flexDirection: 'column',
    position: 'relative',
    overflow: 'hidden',
    fontFamily: '"Inter", "system-ui", sans-serif',
  };

  const serifStyle: React.CSSProperties = {
    fontFamily: 'Georgia, serif',
  };

  return (
    <div ref={ref} style={cardStyle} className="relative">
      {/* Ambient detail */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute -top-24 left-1/2 -translate-x-1/2 w-[820px] h-[820px] rounded-full bg-emerald-500/6 blur-3xl" />
        <div className="absolute inset-0 opacity-[0.05]" style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.06) 1px, transparent 1px)',
          backgroundSize: '44px 44px',
        }} />
      </div>

      {/* Header */}
      <div className="relative z-10 px-14 pt-14 pb-8 flex items-start justify-between">
        <CardLogoGroup />
        <div className="flex flex-col items-end pt-1">
          <div className="text-[12px] uppercase tracking-[0.3em] text-white/35 font-bold mb-2">
            {type === 'find-of-the-day' ? 'Find of the Day' : 'Recorded Find'}
          </div>
          <div className="text-[18px] font-semibold text-emerald-300/75">facebook.com/FindSpot</div>
        </div>
      </div>

      {/* Title block */}
      <div className="relative z-10 px-14 pb-8">
        <div className="rounded-[2rem] border border-white/8 bg-white/[0.035] backdrop-blur-sm px-8 py-7 shadow-[0_24px_70px_-28px_rgba(0,0,0,0.85)]">
          <div className="flex items-start justify-between gap-6">
            <div className="min-w-0 flex-1">
              <h1 style={serifStyle} className="text-[56px] leading-[1.02] font-black tracking-tight text-white">
                {mainTitle}
              </h1>

              {(subTitle || find.ruler) && (
                <div className="mt-3 text-[28px] font-bold text-emerald-300 tracking-tight leading-tight">
                  {subTitle && find.ruler && subTitle !== find.ruler
                    ? `${subTitle} — ${find.ruler}`
                    : subTitle || find.ruler}
                </div>
              )}


            </div>

            <div className="shrink-0 rounded-2xl border border-emerald-400/15 bg-emerald-400/[0.06] px-5 py-4 text-right min-w-[210px]">
              <div className="text-[11px] uppercase tracking-[0.28em] text-emerald-400/60 font-black mb-2">
                Chronology
              </div>
              <div className="text-[28px] font-black text-white leading-tight">
                {find.dateRange || find.period || '--'}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Image section */}
      <div className="relative z-10 px-14 pb-8">
        <div className={`grid gap-6 ${hasBack ? 'grid-cols-2' : 'grid-cols-1'}`} style={{ height: '520px' }}>
          <ImagePanel src={frontImage} label={frontLabel} />
          {hasBack && <ImagePanel src={backImage} label={backLabel} />}
        </div>
      </div>

      {/* Metadata */}
      <div className="relative z-10 px-14">
        <div className="grid grid-cols-3 gap-5">
          <MetaChip label="Detector" value={find.detector || '---'} />
          <MetaChip label="Signal ID" value={find.targetId ?? '--'} align="center" />
          <MetaChip label="Depth" value={find.depthCm ? `${find.depthCm}cm` : '--'} align="right" />
        </div>
      </div>

      {/* Footer */}
      <div className="relative z-10 mt-auto px-14 pb-10 pt-8">
        <div className="flex items-center justify-between border-t border-white/8 pt-6">
          <div className="text-[12px] uppercase tracking-[0.32em] text-white/28 font-black">
            Logged with FindSpot
          </div>
          <div className="text-[14px] font-semibold text-white/38">
            findspot.uk
          </div>
        </div>
      </div>
    </div>
  );
});
