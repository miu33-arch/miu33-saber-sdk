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
describe("SaberApiClient Sandbox Remote Integration", () => {
  const mockConfig = {
    clientId: "sbx_client_miu33",
    clientSecret: "sbx_secret_live_0987",
    apiKey: "saber_api_key_test_123",
    environment: "sandbox" as const,
  };

  test("initializes client with sandbox defaults and custom headers", () => {
    const client = new SaberApiClient(mockConfig);
    assert.ok(client instanceof SaberApiClient);
  });

  test("rejects gracefully on unreachable sandbox host without uncaught process crash", async () => {
    const unreachableClient = new SaberApiClient({
      ...mockConfig,
      customBaseUrl: "http://127.0.0.1:9", // unreachable loopback port
      timeoutMs: 300,
    });

    await assert.rejects(
      async () => {
        await unreachableClient.getAccessToken();
      },
      (err: Error) => {
        assert.match(err.message, /\[SaberApiClient\] OAuth2 Authentication Failed/);
        return true;
      }
    );
  });
});