import React from 'react';
import { Find } from '../db';
import { FINDSPOT_COPYRIGHT_NOTICE } from '../utils/legalCopy';

interface ShareCardProps {
  find?: Find;
  photoUrl?: string; // legacy fallback
  photoUrlFront?: string;
  photoUrlBack?: string;
  type: 'find' | 'find-of-the-day';
}

function clean(value?: string | number | null): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function formatNumber(value?: number | null, suffix = ''): string | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return `${Number(value.toFixed(2))}${suffix}`;
}

function formatDateRange(value?: string | null): string | null {
  const text = clean(value);
  if (!text) return null;
  if (/^\d{1,4}$/.test(text)) return `AD ${text}`;
  return text;
}

function formatDimension(width?: number | null, height?: number | null): string | null {
  const w = formatNumber(width);
  const h = formatNumber(height);
  if (w && h) return `${w} x ${h}mm`;
  if (w) return `${w}mm`;
  if (h) return `${h}mm`;
  return null;
}

function titleCase(value: string): string {
  return value
    .toLowerCase()
    .replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

function LogoMark() {
  return (
    <div className="flex items-center gap-4">
      <svg width="46" height="46" viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <circle cx="256" cy="256" r="190" stroke="#0f766e" strokeWidth="28" fill="none" />
        <circle cx="256" cy="256" r="112" stroke="#14b8a6" strokeWidth="22" fill="none" opacity="0.62" />
        <circle cx="256" cy="256" r="44" fill="#0f766e" />
        <rect x="245" y="36" width="22" height="72" rx="4" fill="#f59e0b" opacity="0.75" />
        <rect x="245" y="404" width="22" height="72" rx="4" fill="#f59e0b" opacity="0.75" />
        <rect x="36" y="245" width="72" height="22" rx="4" fill="#f59e0b" opacity="0.75" />
        <rect x="404" y="245" width="72" height="22" rx="4" fill="#f59e0b" opacity="0.75" />
      </svg>
      <div className="flex flex-col leading-none">
        <svg width="178" height="36" viewBox="0 0 178 36" xmlns="http://www.w3.org/2000/svg" aria-label="FindSpot">
          <defs>
            <linearGradient id="findspot-wordmark-share-v3" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#10b981" />
              <stop offset="52%" stopColor="#14b8a6" />
              <stop offset="100%" stopColor="#0ea5e9" />
            </linearGradient>
          </defs>
          <text
            x="0"
            y="29"
            fill="url(#findspot-wordmark-share-v3)"
            style={{ fontSize: '32px', fontWeight: 900, fontFamily: '"Inter", sans-serif', letterSpacing: '0' }}
          >
            FindSpot
          </text>
        </svg>
        <div className="mt-1 text-[13px] leading-none font-bold uppercase text-[#66736f]">Discovery record</div>
      </div>
    </div>
  );
}

function ImagePanel({ src, label }: { src?: string; label?: string | null }) {
  return (
    <div className="relative h-full overflow-hidden rounded-lg border border-[#d7dfdc] bg-[#edf2ef]">
      {label && (
        <div className="absolute left-5 top-5 z-10 rounded-md border border-[#d7dfdc] bg-white/92 px-4 py-2">
          <span className="text-[13px] font-black uppercase text-[#33413d]">{label}</span>
        </div>
      )}

      {src ? (
        <div
          className="h-full w-full"
          style={{
            backgroundImage: `url(${src})`,
            backgroundSize: 'contain',
            backgroundRepeat: 'no-repeat',
            backgroundPosition: 'center',
          }}
        />
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center gap-4 text-[#8a9893]">
          <svg width="84" height="84" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
            <rect x="3" y="5" width="18" height="14" rx="2" />
            <path d="M8 13l2.2-2.2a1 1 0 011.4 0L15 14.2" />
            <path d="M14 13l1.2-1.2a1 1 0 011.4 0L21 16.2" />
            <circle cx="8" cy="9" r="1.2" />
          </svg>
          <div className="text-[18px] font-black uppercase">No image added</div>
        </div>
      )}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  const isRecord = label === 'Record';
  return (
    <div className="min-h-[112px] rounded-lg border border-[#d7dfdc] bg-white px-5 py-4">
      <div className="mb-2 text-[12px] font-black uppercase text-[#6b7773]">{label}</div>
      <div className={`${isRecord ? 'whitespace-nowrap text-[20px]' : 'break-words text-[24px]'} font-black leading-tight text-[#16251f]`}>
        {value}
      </div>
    </div>
  );
}

export const ShareCard = React.forwardRef<HTMLDivElement, ShareCardProps>((props, ref) => {
  const { find, photoUrl, photoUrlFront, photoUrlBack, type } = props;

  if (!find) return null;

  const isCoin =
    find.findCategory === 'Coin' ||
    find.findCategory === 'Token / Jetton' ||
    !!find.coinType ||
    !!find.coinDenomination ||
    (!find.findCategory && find.objectType?.toLowerCase().includes('coin'));

  const periodLabel = clean(find.period);
  const dateLabel = formatDateRange(find.dateRange);
  const periodTitlePrefix = find.period && find.period !== 'Unknown' ? find.period : null;
  const frontImage = photoUrlFront || photoUrl;
  const backImage = photoUrlBack;
  const hasBack = !!backImage;
  const frontLabel = hasBack ? (isCoin ? 'Obverse' : 'Front') : null;
  const backLabel = isCoin ? 'Reverse' : 'Back';

  const coinTitleParts = [clean(find.coinType), clean(find.coinDenomination)].filter(Boolean) as string[];
  const coinTitle = coinTitleParts.length > 0 ? coinTitleParts.join(' ') : null;
  const objectTitle = titleCase(clean(find.objectType) || clean(find.findCategory) || 'Recorded find');
  const nonCoinTitle = periodTitlePrefix && !objectTitle.toLowerCase().includes(periodTitlePrefix.toLowerCase())
    ? `${periodTitlePrefix} ${objectTitle}`
    : objectTitle;
  const title = isCoin ? coinTitle || objectTitle || 'Recorded coin' : nonCoinTitle;
  const titleSize = title.length > 42 ? '48px' : title.length > 30 ? '54px' : '62px';

  const reference = isCoin
    ? clean(find.coinSpink ? `Spink ${find.coinSpink}` : null) || clean(find.ruler)
    : clean(find.findCategory) || clean(find.ruler);

  const measurementParts = [
    formatNumber(find.weightG, 'g'),
    formatDimension(find.widthMm, find.heightMm),
  ].filter(Boolean) as string[];

  const categoryLabel = find.findCategory && find.findCategory !== 'Other'
    ? find.findCategory.toLowerCase()
    : 'find';
  const subtitle = isCoin
    ? [
        clean(find.ruler),
        find.coinSpink ? `Spink ${find.coinSpink}` : null,
        dateLabel || periodLabel,
      ].filter(Boolean).join(' / ')
    : [
        clean(find.material),
        `${categoryLabel} recorded with FindSpot`,
      ].filter(Boolean).join(' ');
  const detailLine = isCoin
    ? [
        clean(find.material),
        ...measurementParts,
      ].filter(Boolean).join(' • ')
    : measurementParts.join(' • ');

  const facts = (isCoin
    ? [
        { label: 'Period', value: periodLabel },
        { label: 'Material', value: clean(find.material) },
        { label: 'Reference', value: reference },
        { label: 'Record', value: clean(find.findCode) },
      ]
    : [
        { label: 'Period', value: periodLabel },
        { label: 'Material', value: clean(find.material) },
        { label: 'Record', value: clean(find.findCode) },
      ]
  ).filter((item): item is { label: string; value: string } => !!item.value);

  const cardStyle: React.CSSProperties = {
    width: '1080px',
    height: '1350px',
    background: 'linear-gradient(180deg, #f7faf8 0%, #edf3f0 100%)',
    color: '#13201c',
    display: 'flex',
    flexDirection: 'column',
    position: 'relative',
    overflow: 'hidden',
    fontFamily: '"Inter", "system-ui", sans-serif',
  };

  return (
    <div ref={ref} style={cardStyle}>
      <div className="flex h-full flex-col p-[56px]">
        <header className="flex items-center justify-between border-b border-[#ccd8d3] pb-8">
          <LogoMark />
          <div className="text-right">
            <div className="text-[15px] font-black uppercase text-[#0f766e]">
              {type === 'find-of-the-day' ? 'Find of the day' : 'Recorded find'}
            </div>
          </div>
        </header>

        <section className={`mt-8 grid gap-5 ${hasBack ? 'grid-cols-2' : 'grid-cols-1'}`} style={{ height: hasBack ? '560px' : '620px' }}>
          <ImagePanel src={frontImage} label={frontLabel} />
          {hasBack && <ImagePanel src={backImage} label={backLabel} />}
        </section>

        <section className="mt-8 border-y border-[#ccd8d3] py-8">
          <div className="text-[17px] font-black uppercase text-[#0f766e]">Discovery record</div>
          <h1
            className="mt-3 break-words font-black leading-[1.03] text-[#13201c]"
            style={{ fontSize: titleSize }}
          >
            {title}
          </h1>
          {subtitle && (
            <div className="mt-4 break-words text-[28px] font-bold leading-tight text-[#39534c]">
              {subtitle}
            </div>
          )}
          {detailLine && (
            <div className="mt-4 break-words text-[28px] font-black leading-tight text-[#13201c]">
              {detailLine}
            </div>
          )}
        </section>

        <section className={`mt-7 grid gap-4 ${facts.length >= 4 ? 'grid-cols-4' : facts.length === 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>
          {facts.map((item) => (
            <Fact key={item.label} label={item.label} value={item.value} />
          ))}
        </section>

        <footer className="mt-auto flex items-end justify-between border-t border-[#ccd8d3] pt-7">
          <div>
            <div className="text-[18px] font-black text-[#13201c]">FindShare by FindSpot</div>
            <div className="mt-1 text-[14px] font-bold text-[#66736f]">Private by default. Shared only when you choose.</div>
            <div className="mt-2 text-[11px] font-bold text-[#8a9893]">{FINDSPOT_COPYRIGHT_NOTICE} Share-card format protected.</div>
          </div>
          <div className="text-[16px] font-black text-[#0f766e]">findspot.uk</div>
        </footer>
      </div>
    </div>
  );
});
