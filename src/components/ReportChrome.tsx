import React from "react";
import { Find, Session } from "../db";
import { toFarmerLabel } from "../services/fieldReport";
import { FindSpotLogoMark } from "./Logo";

export const REPORT = {
  paper: "#f8f6f0",
  panel: "#ffffff",
  panelSoft: "#f3f1ea",
  ink: "#1f2933",
  muted: "#667085",
  faint: "#98a2b3",
  line: "#dedbd2",
  accent: "#10b981",
  accentDark: "#047857",
  accentSoft: "#e7f7ef",
  sky: "#0ea5e9",
};

export const reportDocumentStyle: React.CSSProperties = {
  background: REPORT.paper,
  color: REPORT.ink,
  borderRadius: 12,
  overflow: "hidden",
  fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  border: `1px solid ${REPORT.line}`,
};

export const reportBodyStyle: React.CSSProperties = {
  padding: "28px min(34px, 6%) 30px",
  display: "flex",
  flexDirection: "column",
  gap: 22,
};

export const reportKeepTogetherStyle: React.CSSProperties = {
  breakInside: "avoid",
  pageBreakInside: "avoid",
};

export const reportSectionLabelStyle: React.CSSProperties = {
  fontSize: 8,
  fontFamily: "sans-serif",
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  color: REPORT.muted,
  fontWeight: 800,
};

export function formatReportDate(value: string | Date | null | undefined, style: "short" | "long" = "long"): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: style === "short" ? "short" : "long",
    year: "numeric",
  });
}

export function formatSessionDateRange(sessions: Session[]): string | null {
  const dates = sessions
    .map(s => new Date(s.date))
    .filter(date => !Number.isNaN(date.getTime()))
    .sort((a, b) => a.getTime() - b.getTime());
  if (dates.length === 0) return null;
  const first = formatReportDate(dates[0], "short");
  const last = formatReportDate(dates[dates.length - 1], "short");
  return first === last ? first : `${first} - ${last}`;
}

export function makeReportReference(prefix: string, id: string, generatedAt: Date): string {
  const datePart = generatedAt.toISOString().slice(0, 10).replace(/-/g, "");
  const idPart = id.replace(/[^a-z0-9]/gi, "").slice(0, 6).toUpperCase() || "LOCAL";
  return `FS-${prefix}-${datePart}-${idPart}`;
}

export function plural(count: number, singular: string, pluralLabel = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralLabel}`;
}

export function getNotableFindLabels(finds: Find[], max = 4): string[] {
  const scoreFind = (find: Find) => {
    const text = [
      find.objectType,
      find.material,
      find.period,
      find.coinType,
      find.coinDenomination,
      find.dateRange,
    ].filter(Boolean).join(" ").toLowerCase();
    let score = 0;
    if (text.includes("gold")) score += 5;
    if (text.includes("silver")) score += 4;
    if (text.includes("coin") || text.includes("hammered") || text.includes("stater") || text.includes("denarius")) score += 3;
    if (find.period && !/unknown|modern|post.?modern/i.test(find.period)) score += 2;
    if (find.objectType && !/unknown|scrap|junk/i.test(find.objectType)) score += 1;
    return score;
  };

  const ranked = finds
    .filter(find => !find.isPending)
    .map(find => ({ find, score: scoreFind(find) }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || (a.find.createdAt || "").localeCompare(b.find.createdAt || ""));

  const labels: string[] = [];
  for (const { find } of ranked) {
    const label = toFarmerLabel(find);
    if (!labels.includes(label)) labels.push(label);
    if (labels.length >= max) break;
  }
  return labels;
}

export function ReportBrand({ label = "FindSpot report" }: { label?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, fontFamily: "sans-serif" }}>
      <FindSpotLogoMark gradientId="findspot-report-logo-grad" style={{ width: 34, height: 34, flexShrink: 0, display: "block" }} />
      <div>
        <div
          style={{
            fontSize: 15,
            lineHeight: 1,
            fontWeight: 900,
            letterSpacing: 0,
          }}
        >
          <span style={{ color: REPORT.accent }}>Find</span>
          <span style={{ color: REPORT.sky }}>Spot</span>
        </div>
        <div style={{ fontSize: 7, lineHeight: 1.5, letterSpacing: "0.16em", textTransform: "uppercase", color: REPORT.muted }}>{label}</div>
      </div>
    </div>
  );
}

export function ReportHeader(props: {
  typeLabel: string;
  title: string;
  subtitle?: string | null;
  reference: string;
  conductedBy: string;
  insuranceText?: string | null;
  dateText?: string | null;
  descriptor: string;
}) {
  return (
    <div
      style={{
        position: "relative",
        background: REPORT.paper,
        padding: "26px 34px 30px",
        borderBottom: `1px solid ${REPORT.line}`,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          opacity: 0.55,
          backgroundImage:
            "linear-gradient(135deg, rgba(16,185,129,0.08) 0 1px, transparent 1px 22px), linear-gradient(45deg, rgba(14,165,233,0.04) 0 1px, transparent 1px 28px)",
          pointerEvents: "none",
        }}
      />
      <div style={{ position: "relative", height: 3, width: 76, background: `linear-gradient(90deg, ${REPORT.accent}, ${REPORT.sky})`, borderRadius: 999, marginBottom: 22 }} />
      <div style={{ position: "relative", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 18, marginBottom: 28 }}>
        <ReportBrand label={props.typeLabel} />
        <div style={{ textAlign: "right", fontFamily: "sans-serif", color: REPORT.muted }}>
          <div style={{ fontSize: 7, letterSpacing: "0.16em", textTransform: "uppercase", marginBottom: 4, fontWeight: 800 }}>Report Ref</div>
          <div style={{ fontSize: 10, color: REPORT.ink, fontWeight: 800 }}>{props.reference}</div>
        </div>
      </div>
      <div style={{ position: "relative" }}>
        <div style={{ ...reportSectionLabelStyle, color: REPORT.accentDark, marginBottom: 10 }}>{props.typeLabel}</div>
        <div style={{ fontSize: 32, lineHeight: 1.08, fontWeight: 760, letterSpacing: "-0.035em", color: REPORT.ink, maxWidth: 560 }}>{props.title}</div>
        {props.subtitle && <div style={{ fontSize: 15, color: REPORT.muted, marginTop: 7 }}>{props.subtitle}</div>}
        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 12px", marginTop: 18, fontSize: 12, color: REPORT.muted }}>
          <span>Conducted by <strong style={{ color: REPORT.ink }}>{props.conductedBy}</strong></span>
          {props.insuranceText && <span>{props.insuranceText}</span>}
          {props.dateText && <span>{props.dateText}</span>}
        </div>
        <div style={{ marginTop: 16, maxWidth: 540, fontSize: 12, lineHeight: 1.55, color: REPORT.muted }}>
          {props.descriptor}
        </div>
      </div>
    </div>
  );
}

export function ReportSummaryRows({ rows, title = "At a glance" }: { rows: Array<{ label: string; value: string }>; title?: string }) {
  return (
    <div data-pdf-block style={{ ...reportKeepTogetherStyle, background: REPORT.panel, border: `1px solid ${REPORT.line}`, borderRadius: 10, overflow: "hidden" }}>
      <div style={{ padding: "12px min(14px, 4%)", borderBottom: `1px solid ${REPORT.line}`, background: "#fbfaf7" }}>
        <div style={{ ...reportSectionLabelStyle, color: REPORT.accentDark }}>{title}</div>
      </div>
      <div>
        {rows.map((row, index) => (
          <div
            key={row.label}
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(108px, 32%) minmax(0, 1fr)",
              gap: 12,
              padding: "10px min(14px, 4%)",
              borderTop: index === 0 ? "none" : `1px solid ${REPORT.line}`,
              alignItems: "baseline",
            }}
          >
            <div style={{ minWidth: 0, fontSize: 10, color: REPORT.muted, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", overflowWrap: "anywhere", hyphens: "auto" }}>{row.label}</div>
            <div style={{ minWidth: 0, fontSize: 13, color: REPORT.ink, lineHeight: 1.45, overflowWrap: "anywhere", hyphens: "auto" }}>{row.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ReportMetricGrid({ stats }: { stats: Array<{ label: string; value: string }> }) {
  return (
    <div data-pdf-block style={{ ...reportKeepTogetherStyle, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 10 }}>
      {stats.map(({ label, value }) => (
        <div key={label} style={{ ...reportKeepTogetherStyle, background: "#fbfaf7", border: `1px solid ${REPORT.line}`, borderRadius: 9, padding: "12px 13px", minHeight: 70 }}>
          <div style={{ fontSize: 8, fontFamily: "sans-serif", letterSpacing: "0.13em", textTransform: "uppercase", color: REPORT.muted, marginBottom: 7, fontWeight: 800 }}>{label}</div>
          <div style={{ minWidth: 0, fontSize: 18, lineHeight: 1.15, fontWeight: 780, color: REPORT.ink, overflowWrap: "anywhere", hyphens: "auto" }}>{value}</div>
        </div>
      ))}
    </div>
  );
}

export function ReportPillList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div data-pdf-block style={{ ...reportKeepTogetherStyle, border: `1px solid ${REPORT.line}`, borderRadius: 10, padding: "14px 16px", background: REPORT.panel }}>
      <div style={{ ...reportSectionLabelStyle, marginBottom: 9 }}>{title}</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
        {items.map(label => (
          <span key={label} style={{ fontSize: 11, fontFamily: "sans-serif", background: REPORT.accentSoft, border: "1px solid #bdebd2", borderRadius: 999, padding: "5px 10px", color: "#166534", fontWeight: 740 }}>{label}</span>
        ))}
      </div>
    </div>
  );
}

export function ReportSectionHeading({ children, caption }: { children: React.ReactNode; caption?: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 9 }}>
      <div style={reportSectionLabelStyle}>{children}</div>
      {caption && <div style={{ fontSize: 11, color: REPORT.muted, lineHeight: 1.45, marginTop: 4 }}>{caption}</div>}
    </div>
  );
}

function makeGpsBadgeDataUri(num: number, hasGps: boolean): string {
  const text = String(num);
  const fontSize = text.length >= 3 ? 7.5 : text.length === 2 ? 8.6 : 9.4;
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">`,
    `<circle cx="12" cy="12" r="10.8" fill="${hasGps ? "#ffffff" : "#f8fafc"}" stroke="${hasGps ? REPORT.accent : "#cbd5e1"}" stroke-width="1.6"/>`,
    `<text x="12" y="12.35" text-anchor="middle" dominant-baseline="middle" alignment-baseline="middle" font-family="Arial, sans-serif" font-size="${fontSize}" font-weight="800" fill="${hasGps ? REPORT.accentDark : "#64748b"}">${text}</text>`,
    `</svg>`,
  ].join("");
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export function GpsFindBadge({ num, hasGps, style }: { num: number; hasGps: boolean; style?: React.CSSProperties }) {
  return (
    <img
      src={makeGpsBadgeDataUri(num, hasGps)}
      alt=""
      style={{ width: 24, height: 24, display: "block", flexShrink: 0, ...style }}
      draggable={false}
    />
  );
}

export function ReportFooter({
  reference,
  generatedAt,
  message = "Thank you for supporting responsible detecting and proper recording of the land.",
  note = "Activity is summarised for landowner review. Finds should be recorded and reported where required, including through the Portable Antiquities Scheme and Treasure process where applicable.",
}: {
  reference: string;
  generatedAt: Date;
  message?: string;
  note?: string;
}) {
  return (
    <div data-pdf-block style={{ ...reportKeepTogetherStyle, borderTop: `1px solid ${REPORT.line}`, paddingTop: 16, textAlign: "center", fontFamily: "sans-serif" }}>
      <div style={{ fontSize: 13, color: REPORT.ink, lineHeight: 1.55, marginBottom: 8 }}>
        {message}
      </div>
      <div style={{ fontSize: 10.5, color: REPORT.muted, lineHeight: 1.65, maxWidth: 560, margin: "0 auto 12px" }}>
        {note}
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, color: REPORT.faint }}>
        <FindSpotLogoMark gradientId="findspot-report-footer-logo-grad" style={{ width: 20, height: 20, display: "block" }} />
        <div style={{ textAlign: "left" }}>
          <div style={{ fontSize: 8, letterSpacing: "0.12em", textTransform: "uppercase", fontWeight: 800 }}>Generated by FindSpot</div>
          <div style={{ fontSize: 8, marginTop: 2 }}>{reference} · {formatReportDate(generatedAt, "long")} · Local-first record generated on this device</div>
        </div>
      </div>
    </div>
  );
}
