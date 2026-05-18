import React, { useMemo } from "react";
import { Permission, Find, Media, Session } from "../db";
import { ScaledImage } from "./ScaledImage";
import {
  REPORT,
  ReportFooter,
  ReportHeader,
  ReportMetricGrid,
  ReportSectionHeading,
  ReportSummaryRows,
  formatReportDate,
  formatSessionDateRange,
  getNotableFindLabels,
  makeReportReference,
  plural,
  reportBodyStyle,
  reportDocumentStyle,
} from "./ReportChrome";

export function PermissionReport(props: {
  permission: Permission;
  sessions: Session[];
  finds: Find[];
  media: Media[];
  insuranceProvider?: string;
  ncmdNumber?: string;
  ncmdExpiry?: string;
  detectoristName?: string;
  detectoristEmail?: string;
}) {
  const generatedAt = new Date();
  const reportReference = makeReportReference("PERM", props.permission.id, generatedAt);
  const conductedBy = props.detectoristName || props.permission.collector || "Detectorist";
  const insuranceText = props.ncmdNumber ? `${props.insuranceProvider || "Membership"} No. ${props.ncmdNumber}${props.ncmdExpiry ? `, expires ${formatReportDate(props.ncmdExpiry, "short")}` : ""}` : null;
  const notableFinds = getNotableFindLabels(props.finds);

  const mediaMap = useMemo(() => {
    const map = new Map<string, Media[]>();
    for (const item of props.media) {
      if (!item.findId) continue;
      if (!map.has(item.findId)) map.set(item.findId, []);
      map.get(item.findId)!.push(item);
    }
    return map;
  }, [props.media]);

  const findsBySession = useMemo(() => {
    const map = new Map<string, Find[]>();
    const orphaned: Find[] = [];

    for (const find of props.finds) {
      if (find.sessionId) {
        if (!map.has(find.sessionId)) map.set(find.sessionId, []);
        map.get(find.sessionId)!.push(find);
      } else {
        orphaned.push(find);
      }
    }
    return { map, orphaned };
  }, [props.finds]);

  const sessionRows = [...props.sessions].sort((a, b) => (b.date || "").localeCompare(a.date || ""));

  return (
    <div className="report-container" style={{ ...reportDocumentStyle, maxWidth: 900, margin: "0 auto" }}>
      <ReportHeader
        typeLabel="Permission Archive Report"
        title={props.permission.name}
        subtitle={props.permission.type ? `${props.permission.type} permission` : null}
        reference={reportReference}
        conductedBy={conductedBy}
        insuranceText={insuranceText}
        dateText={`Generated ${formatReportDate(generatedAt, "long")}`}
        descriptor="Permission archive prepared from local FindSpot data, including land details, contact information, sessions, finds and attached find media."
      />

      <div style={reportBodyStyle}>
        <ReportSummaryRows
          title="Permission Details"
          rows={[
            { label: "Permission type", value: props.permission.type || "Individual" },
            { label: "Land type", value: props.permission.landType || "Not recorded" },
            { label: "Permission status", value: props.permission.permissionGranted ? "Granted" : "Not specified" },
            { label: "GPS centre", value: props.permission.lat != null && props.permission.lon != null ? `${props.permission.lat.toFixed(6)}, ${props.permission.lon.toFixed(6)}` : "Not recorded" },
            { label: "Sessions", value: props.sessions.length > 0 ? plural(props.sessions.length, "session") : "No sessions recorded" },
            { label: "Finds", value: props.finds.length > 0 ? plural(props.finds.length, "find") : "No finds recorded" },
            { label: "Date range", value: formatSessionDateRange(props.sessions) || "Not recorded" },
          ]}
        />

        <ReportSummaryRows
          title="Landowner Contact"
          rows={[
            { label: "Name", value: props.permission.landownerName || "Not recorded" },
            { label: "Phone", value: props.permission.landownerPhone || "Not recorded" },
            { label: "Email", value: props.permission.landownerEmail || "Not recorded" },
            { label: "Address", value: props.permission.landownerAddress || "Not recorded" },
          ]}
        />

        <ReportMetricGrid
          stats={[
            { label: "Sessions", value: String(props.sessions.length) },
            { label: "Finds", value: String(props.finds.length) },
            { label: "Images", value: String(props.media.length) },
          ]}
        />

        {props.permission.notes && (
          <div data-pdf-block>
            <ReportSectionHeading>Permission Notes</ReportSectionHeading>
            <div style={{ borderLeft: `3px solid ${REPORT.accent}`, paddingLeft: 14, fontSize: 12, lineHeight: 1.6, color: REPORT.muted, whiteSpace: "pre-wrap" }}>
              {props.permission.notes}
            </div>
          </div>
        )}

        {notableFinds.length > 0 && (
          <div data-pdf-block style={{ border: `1px solid ${REPORT.line}`, borderRadius: 10, padding: "14px 16px", background: REPORT.panel }}>
            <ReportSectionHeading>Notable Finds</ReportSectionHeading>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
              {notableFinds.map((label) => (
                <span key={label} style={{ fontSize: 11, fontFamily: "sans-serif", background: REPORT.accentSoft, border: "1px solid #bdebd2", borderRadius: 999, padding: "5px 10px", color: "#166534", fontWeight: 740 }}>
                  {label}
                </span>
              ))}
            </div>
          </div>
        )}

        <div>
          <ReportSectionHeading caption={`${props.finds.length} ${props.finds.length === 1 ? "find" : "finds"} recorded across ${props.sessions.length} ${props.sessions.length === 1 ? "session" : "sessions"}.`}>
            Finds By Session
          </ReportSectionHeading>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {sessionRows.map((session) => {
              const sessionFinds = findsBySession.map.get(session.id) || [];
              if (sessionFinds.length === 0) return null;

              return (
                <section key={session.id} data-pdf-block style={{ border: `1px solid ${REPORT.line}`, borderRadius: 10, background: REPORT.panel, overflow: "hidden" }}>
                  <div style={{ padding: "12px 14px", borderBottom: `1px solid ${REPORT.line}`, background: "#fbfaf7", display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
                    <div>
                      <div style={{ fontSize: 8, letterSpacing: "0.13em", textTransform: "uppercase", color: REPORT.muted, fontWeight: 800 }}>Session</div>
                      <div style={{ fontSize: 14, color: REPORT.ink, fontWeight: 780 }}>{formatReportDate(session.date, "long") || "Undated session"}</div>
                    </div>
                    <div style={{ fontSize: 10, color: REPORT.muted, fontFamily: "sans-serif", textAlign: "right" }}>
                      {session.cropType || session.landUse || "No field conditions recorded"}
                    </div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: 12 }}>
                    {sessionFinds.map((find) => (
                      <FindDetail key={find.id} find={find} media={mediaMap.get(find.id) || []} />
                    ))}
                  </div>
                </section>
              );
            })}

            {findsBySession.orphaned.length > 0 && (
              <section data-pdf-block style={{ border: `1px solid ${REPORT.line}`, borderRadius: 10, background: REPORT.panel, padding: 12 }}>
                <ReportSectionHeading>Other / Historical Finds</ReportSectionHeading>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {findsBySession.orphaned.map((find) => (
                    <FindDetail key={find.id} find={find} media={mediaMap.get(find.id) || []} />
                  ))}
                </div>
              </section>
            )}
          </div>
        </div>

        <ReportFooter reference={reportReference} generatedAt={generatedAt} />
      </div>
    </div>
  );
}

function FindDetail({ find, media }: { find: Find; media: Media[] }) {
  const dimensions = [find.widthMm && `${find.widthMm}mm W`, find.heightMm && `${find.heightMm}mm H`, find.depthMm && `${find.depthMm}mm D`].filter(Boolean).join(", ");

  return (
    <div style={{ border: `1px solid ${REPORT.line}`, borderRadius: 9, background: "#fff", padding: 11, display: "grid", gridTemplateColumns: media.length > 0 ? "1fr 150px" : "1fr", gap: 12, alignItems: "start" }}>
      <div>
        <div style={{ display: "flex", gap: 8, alignItems: "baseline", marginBottom: 5 }}>
          <span style={{ background: REPORT.ink, color: "#fff", borderRadius: 5, padding: "2px 6px", fontSize: 10, fontFamily: "monospace", fontWeight: 800 }}>{find.findCode}</span>
          {find.pasId && <span style={{ background: REPORT.accentSoft, color: REPORT.accentDark, borderRadius: 5, padding: "2px 6px", fontSize: 9, fontFamily: "monospace", fontWeight: 800 }}>{find.pasId}</span>}
        </div>
        <div style={{ fontSize: 13, color: REPORT.ink, fontWeight: 760, marginBottom: 4 }}>{find.objectType || "Unidentified Find"}</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "4px 12px", fontSize: 10.5, color: REPORT.muted, lineHeight: 1.45 }}>
          <Detail label="Period" value={find.period} />
          <Detail label="Material" value={find.material} />
          <Detail label="Grid ref" value={find.osGridRef} />
          <Detail label="Weight" value={find.weightG ? `${find.weightG}g` : ""} />
          <Detail label="Dimensions" value={dimensions} />
          <Detail label="Completeness" value={find.completeness} />
        </div>
        {(find.decoration || find.notes) && (
          <div style={{ marginTop: 7, fontSize: 10.5, color: REPORT.muted, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
            {[find.decoration, find.notes].filter(Boolean).join("\n")}
          </div>
        )}
      </div>

      {media.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: media.length > 1 ? "repeat(2, 1fr)" : "1fr", gap: 6 }}>
          {media.slice(0, 4).map((item) => (
            <ScaledImage
              key={item.id}
              media={item}
              className="rounded-lg border border-gray-200 bg-gray-50 aspect-square overflow-hidden"
              imgClassName="object-cover w-full h-full"
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Detail({ label, value }: { label: string; value?: string | number | null }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div>
      <span style={{ display: "block", fontSize: 8, letterSpacing: "0.08em", textTransform: "uppercase", color: REPORT.faint, fontWeight: 800 }}>{label}</span>
      <span>{value}</span>
    </div>
  );
}
