import { classifyProductRegulation, sanitizeHsCode } from "./classifier.js";
import {
  ScocShipmentManifest,
  PcocCertificate,
  ManifestAuditResult
} from "../types/saber.js";

export function validateCrn(crn: string): boolean {
  return /^\d{10}$/.test(crn.trim());
}

export function isPcocActive(cert: PcocCertificate, referenceDate = new Date()): boolean {
  const expiry = new Date(cert.expiryDate);
  return expiry.getTime() >= referenceDate.getTime();
}

export function auditShipmentManifest(
  manifest: ScocShipmentManifest,
  registeredPcocList: PcocCertificate[] = []
): ManifestAuditResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!validateCrn(manifest.importerCrn)) {
    errors.push(`INVALID_IMPORTER_CRN: ${manifest.importerCrn} must be exactly 10 digits.`);
  }

  if (!manifest.billOfLading || manifest.billOfLading.trim().length === 0) {
    errors.push("MISSING_BILL_OF_LADING: Bill of Lading (B/L) is mandatory for Fasah pre-arrival.");
  }

  if (!manifest.items || manifest.items.length === 0) {
    errors.push("EMPTY_MANIFEST: Shipment contains zero line items.");
  }

  const pcocMap = new Map<string, PcocCertificate>();
  for (const cert of registeredPcocList) {
    pcocMap.set(cert.certificateNumber.trim(), cert);
  }

  let totalQuantity = 0;
  let totalValueSar = 0;

  for (let i = 0; i < manifest.items.length; i++) {
    const item = manifest.items[i]!;
    const cleanHs = sanitizeHsCode(item.hsCode);

    if (cleanHs.length < 8 || cleanHs.length > 12) {
      errors.push(`ITEM_${i}_INVALID_HS: HS code ${item.hsCode} must be 8-12 digits for Saudi customs.`);
    }

    if (item.quantity <= 0) {
      errors.push(`ITEM_${i}_INVALID_QTY: Quantity must be greater than zero.`);
    }

    if (item.unitValueSar < 0) {
      errors.push(`ITEM_${i}_INVALID_VALUE: Unit value cannot be negative.`);
    }

    totalQuantity += item.quantity;
    totalValueSar += item.quantity * item.unitValueSar;

    const classification = classifyProductRegulation(cleanHs);

    if (classification.status === "REGULATED") {
      if (!item.pcocCertificateNumber) {
        errors.push(
          `ITEM_${i}_PCOC_REQUIRED: HS ${item.hsCode} is regulated under [${classification.regulation?.trCode}]. Missing PCoC reference.`
        );
      } else {
        const cert = pcocMap.get(item.pcocCertificateNumber.trim());
        if (!cert) {
          errors.push(
            `ITEM_${i}_PCOC_NOT_FOUND: Certificate ${item.pcocCertificateNumber} not found in registered active list.`
          );
        } else if (!isPcocActive(cert)) {
          errors.push(
            `ITEM_${i}_PCOC_EXPIRED: Certificate ${item.pcocCertificateNumber} has expired on ${cert.expiryDate}.`
          );
        }
      }
    } else {
      if (item.pcocCertificateNumber) {
        warnings.push(
          `ITEM_${i}_PCOC_UNNECESSARY: HS ${item.hsCode} is non-regulated. PCoC not strictly required; self-declaration applies.`
        );
      }
    }
  }

  const valid = errors.length === 0;

  return {
    valid,
    clearanceReady: valid,
    totalQuantity,
    totalValueSar,
    errors,
    warnings
  };
}
