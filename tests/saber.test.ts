import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { classifyProductRegulation, sanitizeHsCode } from "../src/engine/classifier.js";
import { auditShipmentManifest } from "../src/engine/auditor.js";
import { PcocCertificate, ScocShipmentManifest } from "../src/types/saber.js";
import { SaberApiClient } from "../src/engine/client.js";

describe("SABER HS Code Classification", () => {
  test("sanitizes formatted tariff strings", () => {
    assert.equal(sanitizeHsCode("8504.40.90"), "85044090");
  });

  test("flags electrical equipment as REGULATED under TR-LVD-01", () => {
    const res = classifyProductRegulation("85044090");
    assert.equal(res.status, "REGULATED");
    assert.equal(res.regulation?.trCode, "TR-LVD-01");
    assert.equal(res.regulation?.requiresCab, true);
  });

  test("flags textiles / inert hardware as NON_REGULATED", () => {
    const res = classifyProductRegulation("61091000");
    assert.equal(res.status, "NON_REGULATED");
  });
});

describe("SCoC Pre-Arrival Customs Manifest Audit", () => {
  const activePcoc: PcocCertificate = {
    certificateNumber: "PCOC-2026-9901",
    issueDate: "2026-01-15",
    expiryDate: "2027-01-15",
    cabCode: "CAB-TUV-01",
    hsCode: "85044090"
  };

  test("approves compliant mixed shipment with active PCoC", () => {
    const manifest: ScocShipmentManifest = {
      invoiceNumber: "INV-2026-0081",
      invoiceDate: "2026-10-10",
      billOfLading: "MAEU928301928",
      importerCrn: "1010000000",
      portOfEntry: "JED_SEA",
      items: [
        {
          sku: "PWR-SUPPLY-500W",
          hsCode: "85044090",
          quantity: 200,
          unitValueSar: 150,
          pcocCertificateNumber: "PCOC-2026-9901"
        },
        {
          sku: "COTTON-TSHIRT-BLK",
          hsCode: "61091000",
          quantity: 500,
          unitValueSar: 25
        }
      ]
    };

    const audit = auditShipmentManifest(manifest, [activePcoc]);
    assert.equal(audit.valid, true);
    assert.equal(audit.clearanceReady, true);
    assert.equal(audit.totalQuantity, 700);
    assert.equal(audit.totalValueSar, 200 * 150 + 500 * 25);
    assert.equal(audit.errors.length, 0);
  });

  test("rejects regulated shipment if PCoC certificate is missing", () => {
    const manifest: ScocShipmentManifest = {
      invoiceNumber: "INV-2026-0082",
      invoiceDate: "2026-10-10",
      billOfLading: "MAEU928301929",
      importerCrn: "1010000000",
      portOfEntry: "RUH_AIR",
      items: [
        {
          sku: "LAPTOP-CHARGER-65W",
          hsCode: "85044090",
          quantity: 50,
          unitValueSar: 80
        }
      ]
    };

    const audit = auditShipmentManifest(manifest, [activePcoc]);
    assert.equal(audit.valid, false);
    assert.equal(audit.clearanceReady, false);
    assert.ok(audit.errors.some(e => e.includes("PCOC_REQUIRED")));
  });

  test("rejects regulated shipment if PCoC certificate is expired", () => {
    const expiredPcoc: PcocCertificate = {
      certificateNumber: "PCOC-2025-0012",
      issueDate: "2025-01-01",
      expiryDate: "2026-01-01",
      cabCode: "CAB-SGS-01",
      hsCode: "85044090"
    };

    const manifest: ScocShipmentManifest = {
      invoiceNumber: "INV-2026-0083",
      invoiceDate: "2026-10-10",
      billOfLading: "MAEU928301930",
      importerCrn: "1010000000",
      portOfEntry: "DMM_SEA",
      items: [
        {
          sku: "PWR-SUPPLY-500W",
          hsCode: "85044090",
          quantity: 100,
          unitValueSar: 120,
          pcocCertificateNumber: "PCOC-2025-0012"
        }
      ]
    };

    const audit = auditShipmentManifest(manifest, [expiredPcoc]);
    assert.equal(audit.valid, false);
    assert.ok(audit.errors.some(e => e.includes("PCOC_EXPIRED")));
  });
});
describe("SaberApiClient Production Sandbox Capabilities", () => {
  const mockConfig = {
    clientId: "sbx_client_miu33",
    clientSecret: "sbx_secret_live_0987",
    apiKey: "saber_api_key_test_123",
    mockMode: true,
  };

  test("generates repeatable sha256 idempotency key", () => {
    const client = new SaberApiClient(mockConfig);
    const payload = { invoiceNumber: "INV-001", amount: 1500 };
    const key1 = client.generateIdempotencyKey(payload);
    const key2 = client.generateIdempotencyKey(payload);
    assert.equal(key1, key2);
    assert.equal(key1.length, 64);
  });

  test("evaluates mock tariff regulation without network call", async () => {
    const client = new SaberApiClient(mockConfig);
    const res = await client.queryTariffRegulation("8504.40.90");
    assert.equal(res.conformityScheme, "REGULATED");
    assert.equal(res.technicalRegulationId, "TR-LVD-01");
  });

  test("verifies mock PCoC and submits mock SCoC end-to-end", async () => {
    const client = new SaberApiClient(mockConfig);
    const pcoc = await client.verifyPcoc("PCOC-2026-9901");
    assert.equal(pcoc.status, "ACTIVE");

    const scoc = await client.submitScoc({
      importerCr: "1010000000",
      commercialInvoiceNumber: "INV-2026-0081",
      invoiceDate: "2026-10-10",
      portOfEntry: "JED_SEA",
      billOfLading: "MAEU928301928",
      items: [
        {
          hsCode: "85044090",
          pcocNumber: pcoc.certificateNumber,
          itemDescription: "Power Module",
          quantity: 100,
          declaredValueSar: 15000,
        },
      ],
    });

    assert.equal(scoc.applicationStatus, "APPROVED");
    assert.ok(scoc.scocNumber.startsWith("SCOC-2026-"));
    assert.ok(scoc.barcodeUrl?.includes("sandbox.saber.sa"));
  });

  test("polls mock SCoC release status synchronously", async () => {
    const client = new SaberApiClient(mockConfig);
    const pollResult = await client.pollScocStatus("SCOC-2026-1234", { maxAttempts: 2, intervalMs: 10 });
    assert.equal(pollResult.applicationStatus, "APPROVED");
    assert.equal(pollResult.customsReleaseCode, "FASAH-REL-SCOC-2026-1234");
  });
});