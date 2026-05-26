import { Jurisdiction, TreasureActResult } from "../types/significantFind";

export type TreasureActInput = {
  material: string;
  period: string;
  count: number; // number of objects in this find/scatter
  jurisdiction: Jurisdiction;
};

export type TreasureActCheckResult = {
  result: TreasureActResult;
  reasons: string[];
  legalSummary: string;
  reportingObligation: string | null;
};

const PRECIOUS_METALS = ["Gold", "Silver", "50% Silver"];
const PREHISTORIC_PERIODS = ["Prehistoric", "Bronze Age", "Iron Age", "Celtic"];
const BASE_METALS = ["Copper alloy", "Copper", "Cupro-Nickel", "Lead", "Iron", "Tin", "Pewter"];
const METALS = [...PRECIOUS_METALS, ...BASE_METALS];

function isPreciousMetal(material: string): boolean {
  return PRECIOUS_METALS.includes(material);
}

function isPrehistoric(period: string): boolean {
  return PREHISTORIC_PERIODS.includes(period);
}

function isBaseMetalObject(material: string): boolean {
  return BASE_METALS.includes(material);
}

function isMetal(material: string): boolean {
  return METALS.includes(material);
}

function isOver300YearsOld(period: string): boolean {
  const modernPeriods = ["Modern", "Post-medieval"];
  // Post-medieval covers roughly 1550 onwards — items from early post-medieval could
  // still be >300 years old, but we treat it conservatively as "possibly not".
  return !modernPeriods.includes(period) && period !== "Unknown";
}

function mayBeOver200YearsOld(period: string): boolean {
  return period !== "Modern";
}

export function checkTreasureAct(input: TreasureActInput): TreasureActCheckResult {
  const { material, period, count, jurisdiction } = input;
  const reasons: string[] = [];

  // Scotland — all found objects are legally Crown property (bona vacantia)
  if (jurisdiction === "scotland") {
    return {
      result: "may_be_reportable",
      reasons: [
        "In Scotland, all archaeological objects found without a known owner are legally Crown property.",
        "You are required to report significant finds to the Treasure Trove Unit.",
      ],
      legalSummary:
        "Scotland operates under the Treasure Trove (Scotland) system rather than the Treasure Act. " +
        "All objects of archaeological significance found without a known owner are Crown property. " +
        "The Treasure Trove Unit will assess the find and decide whether to claim it for a museum. " +
        "A finder's reward (ex gratia payment) is usually made for claimed objects.",
      reportingObligation:
        "Report to the Treasure Trove Unit: treasuretrove@nms.ac.uk",
    };
  }

  // Northern Ireland — Treasure Act 1996 applies with modifications
  if (jurisdiction === "northern_ireland") {
    if (isPreciousMetal(material) && isOver300YearsOld(period)) {
      return {
        result: "may_be_reportable",
        reasons: [
          "Precious metal objects over 300 years old must be reported under the Treasure Act 1996.",
          "Northern Ireland follows the same Treasure Act criteria as England and Wales.",
        ],
        legalSummary:
          "The Treasure Act 1996 applies in Northern Ireland. Precious metal objects (gold or silver) " +
          "over 300 years old must be reported to the local coroner within 14 days of discovery or " +
          "of realising it may be Treasure.",
        reportingObligation:
          "Report to the local coroner within 14 days. Contact the Northern Ireland Environment Agency for advice.",
      };
    }
  }

  // England and Wales (and NI non-precious-metal cases)
  // Rule 1: Single gold or silver object over 300 years old
  if (isPreciousMetal(material) && isOver300YearsOld(period)) {
    reasons.push(`${material} objects over 300 years old are defined as Treasure under the Treasure Act 1996.`);
  }

  // Rule 2: Two or more coins from the same find, at least 10% precious metal, over 300 years old
  if (
    count >= 2 &&
    isPreciousMetal(material) &&
    isOver300YearsOld(period)
  ) {
    reasons.push(
      `${count} precious metal objects found together meet the Treasure Act coin group threshold.`
    );
  }

  // Rule 3: Two or more prehistoric base-metal objects found together
  if (count >= 2 && isBaseMetalObject(material) && isPrehistoric(period)) {
    reasons.push(
      `${count} prehistoric base-metal objects found together are defined as Treasure.`
    );
  }

  // Rule 4: Any object found in association with Treasure
  // (can't check this automatically — covered in legalSummary)

  // Rule 5: 2023 significance-based class.
  // The app cannot assess legal significance, so it only flags cases where
  // FLO/coroner advice may be needed rather than trying to decide the point.
  if (isMetal(material) && mayBeOver200YearsOld(period)) {
    reasons.push(
      "Metal objects or coins over 200 years old may be Treasure if they meet the historical, archaeological, or cultural significance threshold introduced in 2023."
    );
  }

  if (reasons.length > 0) {
    return {
      result: "may_be_reportable",
      reasons,
      legalSummary:
        "Under the Treasure Act 1996 and the 2023 significance-based extension, you may have a legal duty " +
        "to report this find to the local coroner within 14 days of discovering it — or within 14 days of realising it may be Treasure. " +
        "Failure to report is a criminal offence. The NCMD Treasure Trove Fund can arrange professional " +
        "excavation and help with the reporting process at no cost to you.",
      reportingObligation:
        "Report to the local coroner within 14 days. Contact your local FLO (Finds Liaison Officer) for help.",
    };
  }

  // Check if it might still be worth recording with PAS
  const mightBeSignificant =
    isOver300YearsOld(period) ||
    period === "Unknown";

  return {
    result: "probably_not",
    reasons: mightBeSignificant
      ? [
          "This find does not appear to meet the Treasure Act criteria based on the information provided.",
          "However, recording it with the Portable Antiquities Scheme (PAS) is still valuable for archaeological research.",
        ]
      : [
          "This find does not meet the Treasure Act criteria.",
        ],
    legalSummary:
      "Based on the details you have provided, this find is probably not legally defined as Treasure " +
      "under the Treasure Act 1996. You are not legally required to report it to the coroner. " +
      "However, recording it voluntarily with the Portable Antiquities Scheme contributes to the " +
      "national archaeological record and is strongly encouraged.",
    reportingObligation: null,
  };
}
