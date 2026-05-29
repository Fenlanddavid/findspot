import React, { forwardRef } from "react";
import type { Session, Permission, Find } from "../db";
import type { Field } from "../db";
import { FindSpotLogoMark } from "./Logo";
import { getNotableFindLabels, formatReportDate, REPORT } from "./ReportChrome";

interface Props {
  session: Session;
  permission: Permission | null | undefined;
  field: Field | null | undefined;
  finds: Find[];
  detectoristName: string;
  highlightPhotoUrl: string | null;
}

const CARD_W = 540;
const CARD_H = 720;

function formatDuration(session: Session): string | null {
  if (session.startTime && session.endTime) {
    const ms = new Date(session.endTime).getTime() - new Date(session.startTime).getTime();
    if (ms > 0) {
      const mins = Math.floor(ms / 60000);
      const hrs = Math.floor(mins / 60);
      if (hrs > 0) return `${hrs}h ${mins % 60}m`;
      return `${mins}m`;
    }
  }
  return null;
}

function truncateLabel(value: string, maxLength: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength - 3).trimEnd()}...`;
}

export const LandownerUpdateCard = forwardRef<HTMLDivElement, Props>(
  ({ session, permission, field, finds, detectoristName, highlightPhotoUrl }, ref) => {
    const completedFinds = finds.filter(f => !f.isPending);
    const pendingCount   = finds.filter(f => f.isPending).length;
    const notableLabels  = getNotableFindLabels(completedFinds, 3);
    const duration       = formatDuration(session);
    const dateText       = formatReportDate(session.date, "long");
    const displayDetectoristName = truncateLabel(detectoristName || "Detectorist", 30);

    const locationName = field?.name
      ? `${field.name}${permission?.name ? ` · ${permission.name}` : ""}`
      : (permission?.name ?? "Field session");

    return (
      <div
        ref={ref}
        style={{
          width: CARD_W,
          height: CARD_H,
          background: REPORT.paper,
          color: REPORT.ink,
          fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
          overflow: "hidden",
          position: "relative",
          display: "flex",
          flexDirection: "column",
          boxSizing: "border-box",
          border: `1px solid ${REPORT.line}`,
        }}
      >
        {/* ── HEADER ─────────────────────────────────────────────── */}
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "18px 24px 16px",
          borderBottom: `1px solid ${REPORT.line}`,
          background: REPORT.panel,
          flexShrink: 0,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <FindSpotLogoMark
              gradientId="landowner-card-logo"
              style={{ width: 28, height: 28, flexShrink: 0 }}
            />
            <div>
              <div style={{ fontSize: 13, fontWeight: 900, lineHeight: 1.1, letterSpacing: 0 }}>
                <span style={{ color: REPORT.accent }}>Find</span>
                <span style={{ color: REPORT.sky }}>Spot</span>
              </div>
              <div style={{
                fontSize: 9,
                color: REPORT.muted,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                fontWeight: 700,
                marginTop: 2,
              }}>
                Session Update
              </div>
            </div>
          </div>
          <div style={{ textAlign: "right", minWidth: 0 }}>
            <div style={{
              maxWidth: 220,
              fontSize: 11,
              lineHeight: "16px",
              color: REPORT.muted,
              fontWeight: 700,
              whiteSpace: "nowrap",
            }}>{displayDetectoristName}</div>
          </div>
        </div>

        {/* ── HIGHLIGHT PHOTO ────────────────────────────────────── */}
        <div style={{
          width: "100%",
          height: 200,
          flexShrink: 0,
          background: REPORT.panelSoft,
          borderBottom: `1px solid ${REPORT.line}`,
          overflow: "hidden",
          position: "relative",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}>
          {highlightPhotoUrl ? (
            <>
              <div
                aria-hidden="true"
                style={{
                  position: "absolute",
                  inset: 0,
                  backgroundImage: `url("${highlightPhotoUrl}")`,
                  backgroundPosition: "center",
                  backgroundRepeat: "no-repeat",
                  backgroundSize: "cover",
                }}
              />
              <div style={{
                position: "absolute",
                bottom: 0, left: 0, right: 0,
                height: 48,
                background: `linear-gradient(to top, ${REPORT.paper}, transparent)`,
              }} />
            </>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, opacity: 0.3 }}>
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none"
                stroke={REPORT.faint} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                <circle cx="12" cy="13" r="4"/>
              </svg>
              <span style={{
                fontSize: 9,
                color: REPORT.faint,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                fontWeight: 800,
              }}>No photo</span>
            </div>
          )}
        </div>

        {/* ── CONTENT ────────────────────────────────────────────── */}
        <div style={{
          flex: 1,
          padding: "20px 24px 0",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}>
          {/* Location + date */}
          <div style={{ marginBottom: 16 }}>
            <div style={{
              fontSize: 16,
              fontWeight: 900,
              color: REPORT.ink,
              lineHeight: 1.2,
              marginBottom: 4,
              letterSpacing: "-0.01em",
              overflowWrap: "anywhere",
            }}>
              {locationName}
            </div>
            <div style={{ fontSize: 12, color: REPORT.muted, fontWeight: 600 }}>
              {dateText}{duration ? ` · ${duration}` : ""}
            </div>
          </div>

          {/* Finds count pill */}
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
            <div style={{
              background: completedFinds.length > 0 ? REPORT.accentSoft : REPORT.panelSoft,
              border: `1px solid ${completedFinds.length > 0 ? REPORT.accent : REPORT.line}`,
              borderRadius: 12,
              padding: "10px 18px",
              textAlign: "center",
              minWidth: 80,
            }}>
              <div style={{
                fontSize: 28,
                fontWeight: 900,
                color: completedFinds.length > 0 ? REPORT.accentDark : REPORT.faint,
                lineHeight: 1,
              }}>
                {completedFinds.length}
              </div>
              <div style={{
                fontSize: 9,
                fontWeight: 800,
                color: REPORT.muted,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                marginTop: 4,
              }}>
                {completedFinds.length === 1 ? "find" : "finds"}
              </div>
            </div>
            {pendingCount > 0 && (
              <div style={{ fontSize: 11, color: REPORT.faint, fontStyle: "italic" }}>
                +{pendingCount} pending to verify
              </div>
            )}
          </div>

          {/* Notable finds — or zero-finds fallback */}
          {notableLabels.length > 0 ? (
            <div>
              <div style={{
                fontSize: 9,
                fontWeight: 800,
                color: REPORT.muted,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                marginBottom: 10,
              }}>
                Notable finds
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {notableLabels.map((label, i) => (
                  <div key={i} style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    fontSize: 13,
                    color: REPORT.ink,
                    fontWeight: 600,
                  }}>
                    <div style={{
                      width: 6,
                      height: 6,
                      borderRadius: 2,
                      background: REPORT.accent,
                      flexShrink: 0,
                    }} />
                    <span style={{ minWidth: 0, lineHeight: 1.3, overflowWrap: "anywhere" }}>{label}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : completedFinds.length === 0 ? (
            <div style={{ fontSize: 13, color: REPORT.faint, fontStyle: "italic", lineHeight: 1.65 }}>
              No finds recorded this session — conditions noted for future visits.
            </div>
          ) : null}
        </div>

        {/* ── FOOTER ─────────────────────────────────────────────── */}
        <div style={{
          padding: "14px 24px 18px",
          borderTop: `1px solid ${REPORT.line}`,
          background: REPORT.panel,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          flexShrink: 0,
        }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 10, color: REPORT.faint, lineHeight: 1.6 }}>
              Session conducted responsibly under landowner permission.
            </div>
            <div style={{ fontSize: 10, color: REPORT.faint, lineHeight: 1.6 }}>
              Recorded using FindSpot · findspot.uk
            </div>
          </div>
          {/* lock icon */}
          <div style={{
            width: 30,
            height: 30,
            borderRadius: 8,
            background: REPORT.accentSoft,
            border: `1px solid ${REPORT.accent}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
              stroke={REPORT.accentDark} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
            </svg>
          </div>
        </div>
      </div>
    );
  }
);

LandownerUpdateCard.displayName = "LandownerUpdateCard";
