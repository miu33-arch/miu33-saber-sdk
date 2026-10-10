export type RegulationStatus = "REGULATED" | "NON_REGULATED";

export interface TechnicalRegulation {
  trCode: string;
  categoryName: string;
  requiresCab: boolean;
}

export interface SaberProductItem {
  sku: string;
  hsCode: string;          // 8 to 12 digits (Saudi Integrated Tariff)
  productNameEn: string;
  countryOfOrigin: string; // ISO 2-letter (e.g. "CN", "DE", "US")
  modelNumber: string;
  manufacturer: string;
}

export interface PcocCertificate {
  certificateNumber: string; // PCoC identifier
  issueDate: string;         // YYYY-MM-DD
  expiryDate: string;        // YYYY-MM-DD (1 year validity)
  cabCode: string;           // Conformity Assessment Body (e.g. "CAB-TUV", "CAB-SGS")
  hsCode: string;
}

export interface ScocManifestItem {
  sku: string;
  hsCode: string;
  quantity: number;
  unitValueSar: number;
  pcocCertificateNumber?: string;
}

export interface ScocShipmentManifest {
  invoiceNumber: string;
  invoiceDate: string;
  billOfLading: string;
  importerCrn: string;     // 10 digits
  portOfEntry: string;
  items: ScocManifestItem[];
}

export interface ManifestAuditResult {
  valid: boolean;
  clearanceReady: boolean;
  totalQuantity: number;
  totalValueSar: number;
  errors: string[];
  warnings: string[];
}
