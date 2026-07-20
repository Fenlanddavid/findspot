import type { SMUnavailableReason } from "../../services/historicScanService";

type TextSize = "xs" | "sm";

const COPY: Record<SMUnavailableReason, { title: string; body: string }> = {
    coverage_scotland: {
        title: "Scheduled Monument Check Unavailable",
        body: "FindSpot could not confirm Scottish scheduled monument coverage for this scan. Check Historic Environment Scotland's Designations map before detecting - scheduled monuments are protected by law across the UK.",
    },
    coverage_ni: {
        title: "Scheduled Monument Data Not Yet Available Here",
        body: "FindSpot's monument data does not yet cover Northern Ireland. Check the Historic Environment Record (DfC) before detecting - scheduled monuments are protected by law across the UK.",
    },
    coverage_border: {
        title: "Near the Scotland Border",
        body: "Monument coverage here is England and Wales only. Verify against both the NHLE map and Historic Environment Scotland before treating this area as clear.",
    },
    coverage_incomplete: {
        title: "Scheduled Monument Data Incomplete Here",
        body: "FindSpot's monument data does not fully cover this area yet. Check the official national scheduled monument record before treating it as clear.",
    },
    coverage_outside_uk: {
        title: "Scheduled Monument Check Unavailable",
        body: "Protected monument data could not be confirmed for this area. Use official records before treating the area as clear.",
    },
};

export function getSMUnavailableCopy(
    reason: SMUnavailableReason | null | undefined,
    fallbackBody: string,
) {
    if (reason) return COPY[reason];
    return {
        title: "Scheduled Monument Check Unavailable",
        body: fallbackBody,
    };
}

export function SMUnavailableBanner({
    reason,
    fallbackBody,
    textSize = "sm",
}: {
    reason?: SMUnavailableReason | null;
    fallbackBody: string;
    textSize?: TextSize;
}) {
    const copy = getSMUnavailableCopy(reason, fallbackBody);
    const titleClass = textSize === "xs"
        ? "text-[0.625rem] font-black text-amber-300 uppercase tracking-[0.18em]"
        : "text-[0.5625rem] font-black text-amber-300 uppercase tracking-[0.18em] mb-1";
    const bodyClass = textSize === "xs"
        ? "mt-1 text-[0.625rem] font-bold text-amber-100/80 leading-snug"
        : "text-[0.6875rem] font-bold text-amber-100/75 leading-snug";

    return (
        <div className="rounded-xl border border-amber-500/35 bg-amber-500/10 px-3 py-2">
            <p className={titleClass}>{copy.title}</p>
            <p className={bodyClass}>{copy.body}</p>
        </div>
    );
}
