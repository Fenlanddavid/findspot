import React from "react";
import { Permission, Find, Media, Session } from "../db";
import { ScaledImage } from "./ScaledImage";
import {
  REPORT,
  ReportFooter,
  ReportHeader,
  ReportSectionHeading,
  ReportSummaryRows,
  formatReportDate,
  makeReportReference,
  reportBodyStyle,
  reportDocumentStyle,
} from "./ReportChrome";

export function FindReport(props: {
  find: Find;
  media: Media[];
  permission?: Permission;
  session?: Session;
  insuranceProvider?: string;
  ncmdNumber?: string;
  ncmdExpiry?: string;
  detectoristName?: string;
  detectoristEmail?: string;
}) {
  const { find, media, permission, session, insuranceProvider, ncmdNumber, ncmdExpiry, detectoristName, detectoristEmail } = props;
  const generatedAt = new Date();
  const reportReference = makeReportReference("FIND", find.id || find.findCode || "LOCAL", generatedAt);
  const conductedBy = detectoristName || permission?.collector || "Detectorist";
  const insuranceText = ncmdNumber ? `${insuranceProvider || "Membership"} No. ${ncmdNumber}${ncmdExpiry ? `, expires ${formatReportDate(ncmdExpiry, "short")}` : ""}` : null;
  const dateFound = formatReportDate(session?.date || find.createdAt, "long") || "Not recorded";

  const objectRows = [
    { label: "Find code", value: find.findCode || "Not recorded" },
    { label: "Object type", value: find.objectType || "Unidentified find" },
    ...(find.pasId ? [{ label: "PAS ID", value: find.pasId }] : []),
    ...(find.coinType ? [{ label: "Coin type", value: find.coinType }] : []),
    ...(find.coinDenomination ? [{ label: "Denomination", value: find.coinDenomination }] : []),
    ...(find.coinSpink ? [{ label: "Spink No.", value: find.coinSpink }] : []),
    { label: "Period", value: find.period || "Not recorded" },
    { label: "Material", value: find.material || "Not recorded" },
    { label: "Weight", value: find.weightG ? `${find.weightG}g` : "Not recorded" },
    { label: "Dimensions", value: [find.widthMm && `${find.widthMm}mm W`, find.heightMm && `${find.heightMm}mm H`, find.depthMm && `${find.depthMm}mm D`].filter(Boolean).join(", ") || "Not recorded" },
    { label: "Completeness", value: find.completeness || "Not recorded" },
  ];

  const locationRows = [
    { label: "Permission", value: permission?.name || "Not recorded" },
    { label: "Date found", value: dateFound },
    { label: "OS grid ref", value: find.osGridRef || "Not recorded" },
    { label: "What3Words", value: find.w3w ? `///${find.w3w.replace("///", "")}` : "Not recorded" },
    { label: "Coordinates", value: find.lat != null && find.lon != null ? `${find.lat.toFixed(6)}, ${find.lon.toFixed(6)}` : "Not recorded" },
    { label: "GPS accuracy", value: find.gpsAccuracyM ? `+/- ${Math.round(find.gpsAccuracyM)}m` : "Not recorded" },
    { label: "Detectorist", value: conductedBy },
  ];

  return (
    <div className="report-container" style={{ ...reportDocumentStyle, maxWidth: 900, margin: "0 auto" }}>
      <ReportHeader
        typeLabel="Find Report"
        title={find.objectType || "Unidentified Find"}
        subtitle={find.findCode}
        reference={reportReference}
        conductedBy={conductedBy}
        insuranceText={insuranceText}
        dateText={`Generated ${formatReportDate(generatedAt, "long")}`}
        descriptor="Individual find record prepared from local FindSpot data, including object details, discovery context and photographic evidence."
      />

      <div style={reportBodyStyle}>
        <ReportSummaryRows title="Object Details" rows={objectRows} />
        <ReportSummaryRows title="Discovery Context" rows={locationRows} />

        {(find.decoration || find.notes) && (
          <div data-pdf-block>
            <ReportSectionHeading>Find Notes</ReportSectionHeading>
            <div style={{ borderLeft: `3px solid ${REPORT.accent}`, paddingLeft: 14, fontSize: 12, lineHeight: 1.6, color: REPORT.muted, whiteSpace: "pre-wrap" }}>
              {[find.decoration, find.notes].filter(Boolean).join("\n\n")}
            </div>
          </div>
        )}

        <div data-pdf-block>
          <ReportSectionHeading caption={`${media.length} ${media.length === 1 ? "image" : "images"} attached to this find record.`}>
            Photographic Evidence
          </ReportSectionHeading>
          {media.length > 0 ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
              {media.map((item) => (
                <ScaledImage
                  key={item.id}
                  media={item}
                  className="rounded-lg border border-gray-200 bg-gray-50 aspect-square overflow-hidden"
                  imgClassName="object-contain w-full h-full"
                />
              ))}
            </div>
          ) : (
            <div style={{ border: `1px solid ${REPORT.line}`, borderRadius: 9, background: REPORT.panelSoft, minHeight: 120, display: "flex", alignItems: "center", justifyContent: "center", color: REPORT.muted, fontSize: 12 }}>
              No photographs attached to this find.
            </div>
          )}
        </div>

        {permission?.landownerName && (
          <div data-pdf-block style={{ border: `1px solid ${REPORT.line}`, borderRadius: 10, background: REPORT.panel, padding: "14px 16px" }}>
            <ReportSectionHeading>Landowner Confirmation</ReportSectionHeading>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 220px", gap: 24, alignItems: "end", fontSize: 12, color: REPORT.muted, lineHeight: 1.55 }}>
              <div>
                This find was recorded against land where permission is held from <strong style={{ color: REPORT.ink }}>{permission.landownerName}</strong>.
              </div>
              <div style={{ borderBottom: `1px solid ${REPORT.ink}`, height: 36 }} />
            </div>
          </div>
        )}

        <ReportFooter reference={reportReference} generatedAt={generatedAt} />
      </div>
    </div>
  );
}
