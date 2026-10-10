import { RegulationStatus, TechnicalRegulation } from "../types/saber.js";

const SASO_REGULATION_CATALOG: Record<string, TechnicalRegulation> = {
  "8504": { trCode: "TR-LVD-01", categoryName: "Low Voltage Electrical Equipment", requiresCab: true },
  "8516": { trCode: "TR-LVD-01", categoryName: "Electric Heating & Domestic Appliances", requiresCab: true },
  "8528": { trCode: "TR-LVD-01", categoryName: "Monitors and Projectors", requiresCab: true },
  "8517": { trCode: "TR-TELECOM-04", categoryName: "Telecommunications & Networking", requiresCab: true },
  "8414": { trCode: "TR-MACH-02", categoryName: "Pumps, Compressors & Fans", requiresCab: true },
  "8415": { trCode: "TR-MACH-02", categoryName: "Air Conditioning Machinery", requiresCab: true },
  "9503": { trCode: "TR-TOYS-01", categoryName: "Children Toys", requiresCab: true },
  "3304": { trCode: "TR-COSM-03", categoryName: "Beauty and Skincare Preparations", requiresCab: true },
  "3305": { trCode: "TR-COSM-03", categoryName: "Hair Preparations", requiresCab: true }
};

export function sanitizeHsCode(hsCode: string): string {
  return hsCode.replace(/[^0-9]/g, "");
}

export function classifyProductRegulation(hsCode: string): {
  status: RegulationStatus;
  regulation?: TechnicalRegulation;
} {
  const clean = sanitizeHsCode(hsCode);
  if (clean.length < 4) {
    throw new Error(`INVALID_HS_CODE: "${hsCode}" must have at least 4 digits.`);
  }

  const heading4 = clean.slice(0, 4);
  const regulation = SASO_REGULATION_CATALOG[heading4];

  if (regulation) {
    return {
      status: "REGULATED",
      regulation
    };
  }

  return {
    status: "NON_REGULATED"
  };
}
