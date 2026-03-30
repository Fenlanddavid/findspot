
import { Find } from "../db";

/**
 * Synthesizes a professional PAS-style description based on find data.
 */
export const generatePASDescription = (find: Find): string => {
  const parts: string[] = [];

  // 1. Initial Summary
  const completeness = find.completeness ? find.completeness.toLowerCase() : "complete";
  parts.push(`A ${completeness} ${find.material.toLowerCase()} ${find.objectType.toLowerCase()} of ${find.period} date.`);

  // 2. Physical Description
  if (find.weightG || find.widthMm || find.heightMm) {
    const measurements = [];
    if (find.widthMm) measurements.push(`${find.widthMm}mm in width`);
    if (find.heightMm) measurements.push(`${find.heightMm}mm in height`);
    if (find.weightG) measurements.push(`weighing ${find.weightG}g`);
    parts.push(`The object measures ${measurements.join(", ")}.`);
  }

  // 3. Condition & Decoration
  if (find.decoration || find.notes) {
    parts.push(`Surface details: ${find.decoration || "No significant decoration visible."}`);
  }

  // 4. Context/Patina Logic (Material specific)
  if (find.material === "Copper alloy") {
    parts.push("The object has a stable dark green patina with moderate surface wear consistent with field recovery.");
  } else if (find.material === "Silver" || find.material === "Gold") {
    parts.push(`The ${find.material.toLowerCase()} surface shows characteristic post-depositional wear.`);
  }

  return parts.join(" ");
};

/**
 * Calculates a 'Recording Quality Score' based on data completeness.
 *
 * Score breakdown (max 100):
 *   Measurements  30pts  weight (10) + width/diameter (10) + height/thickness (10)
 *   Location      30pts  GPS coordinates (all-or-nothing — partial coords are useless)
 *   Photos        40pts  first photo (20) + second photo (10) + third photo (10)
 */
export const calculateRecordingScore = (find: Find, photoCount: number): { score: number; reasons: string[] } => {
  let score = 0;
  const reasons: string[] = [];

  // Measurements (max 30)
  if (find.weightG) score += 10; else reasons.push("Missing weight");
  if (find.widthMm) score += 10; else reasons.push("Missing width/diameter");
  if (find.heightMm || find.depthMm) score += 10; else reasons.push("Missing height/thickness");

  // Location (max 30) — all-or-nothing because a single coordinate is meaningless
  if (find.lat && find.lon) {
    score += 30;
  } else {
    reasons.push("Missing GPS coordinates");
  }

  // Photos (max 40)
  if (photoCount > 0) score += 20; else reasons.push("No photos attached");
  if (photoCount >= 2) score += 10;
  if (photoCount >= 3) score += 10;

  return { score, reasons };
};

/**
 * Reverse geocodes coordinates to get Parish and County.
 */
export const getParishAndCounty = async (lat: number, lon: number): Promise<{ parish: string; county: string }> => {
  try {
    const resp = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=10`);
    if (!resp.ok) throw new Error(`Nominatim error: ${resp.status}`);
    const data = await resp.json();
    const address = data.address || {};
    
    return {
      parish: address.suburb || address.village || address.town || address.city || "Unknown Parish",
      county: address.county || address.state || "Unknown County"
    };
  } catch (e) {
    console.error("Geocoding failed", e);
    return { parish: "Unknown", county: "Unknown" };
  }
};
