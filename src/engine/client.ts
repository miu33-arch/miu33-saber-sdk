import axios, { AxiosInstance, AxiosError } from "axios";
import crypto from "node:crypto";

export type SaberEnvironment = "sandbox" | "production";

export interface SaberClientConfig {
  clientId: string;
  clientSecret: string;
  apiKey: string;
  environment?: SaberEnvironment;
  customBaseUrl?: string;
  timeoutMs?: number;
  mockMode?: boolean;
  maxRetries?: number;
}

export interface SaberAuthToken {
  accessToken: string;
  expiresAt: number;
}

export interface SaberTariffInquiry {
  hsCode: string;
  productDescriptionAr?: string;
  productDescriptionEn?: string;
  technicalRegulationRequired: boolean;
  technicalRegulationId?: string;
  conformityScheme: "REGULATED" | "NON_REGULATED";
}

export interface SaberPcocLookupResult {
  certificateNumber: string;
  status: "ACTIVE" | "EXPIRED" | "SUSPENDED" | "CANCELLED";
  cabBodyName: string;
  issueDate: string;
  expiryDate: string;
  hsCodesCovered: string[];
}

export interface SaberScocSubmissionPayload {
  importerCr: string;
  commercialInvoiceNumber: string;
  invoiceDate: string;
  portOfEntry: string;
  billOfLading: string;
  items: Array<{
    hsCode: string;
    pcocNumber: string;
    itemDescription: string;
    quantity: number;
    declaredValueSar: number;
  }>;
}

export interface SaberScocSubmissionResponse {
  scocNumber: string;
  applicationStatus: "APPROVED" | "PENDING_CAB_AUDIT" | "REJECTED";
  customsReleaseCode?: string;
  barcodeUrl?: string;
  rejectionReasons?: string[];
  submittedAt: string;
}

export interface PollScocOptions {
  intervalMs?: number;
  maxAttempts?: number;
}

export class SaberApiClient {
  private http: AxiosInstance;
  private tokenCache: SaberAuthToken | null = null;
  private readonly baseUrl: string;
  private readonly mockMode: boolean;
  private readonly maxRetries: number;

  constructor(private config: SaberClientConfig) {
    this.mockMode = Boolean(config.mockMode);
    this.maxRetries = config.maxRetries ?? 3;

    const defaultEnv = config.environment || "sandbox";
    this.baseUrl =
      config.customBaseUrl ||
      (defaultEnv === "sandbox"
        ? "https://sandbox.saber.sa/api/v2"
        : "https://api.saber.sa/v2");

    this.http = axios.create({
      baseURL: this.baseUrl,
      timeout: config.timeoutMs || 12000,
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": config.apiKey,
        "User-Agent": "MIU33-Saber-SDK/1.0.0",
      },
    });
  }

  /**
   * Helper: Deterministic Idempotency Key calculation
   */
  public generateIdempotencyKey(payload: object): string {
    return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  }

  /**
   * Helper: Exponential backoff executor for transient network / 5xx errors
   */
  private async executeWithRetry<T>(fn: () => Promise<T>): Promise<T> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastError = err;
        const isNetworkOr5xx =
          axios.isAxiosError(err) &&
          (!err.response || (err.response.status >= 500 && err.response.status <= 599));

        if (!isNetworkOr5xx || attempt === this.maxRetries) {
          throw err;
        }

        const backoffDelay = Math.min(100 * Math.pow(2, attempt), 2000);
        await new Promise((resolve) => setTimeout(resolve, backoffDelay));
      }
    }
    throw lastError;
  }

  /**
   * 1. Authentication Handshake with In-Memory Token Caching
   */
  public async getAccessToken(): Promise<string> {
    if (this.mockMode) {
      return "mock_saber_token_" + Date.now();
    }

    const now = Date.now();
    if (this.tokenCache && this.tokenCache.expiresAt > now + 60000) {
      return this.tokenCache.accessToken;
    }

    return this.executeWithRetry(async () => {
      try {
        const response = await this.http.post("/oauth/token", {
          grant_type: "client_credentials",
          client_id: this.config.clientId,
          client_secret: this.config.clientSecret,
        });

        const { access_token, expires_in } = response.data;
        this.tokenCache = {
          accessToken: access_token,
          expiresAt: now + (expires_in || 3600) * 1000,
        };

        return this.tokenCache.accessToken;
      } catch (err) {
        throw this.handleError("OAuth2 Authentication Failed", err);
      }
    });
  }

  /**
   * 2. Live / Mock HS Code Tariff Inquiry
   */
  public async queryTariffRegulation(hsCode: string): Promise<SaberTariffInquiry> {
    if (this.mockMode) {
      const cleanHs = hsCode.replace(/\D/g, "");
      const isRegulated = cleanHs.startsWith("85") || cleanHs.startsWith("84");
      return {
        hsCode: cleanHs,
        productDescriptionEn: isRegulated ? "Electrical Machinery / Power Module" : "General Commodity",
        productDescriptionAr: isRegulated ? "معدات وأجهزة كهربائية" : "بضائع عامة",
        technicalRegulationRequired: isRegulated,
        technicalRegulationId: isRegulated ? "TR-LVD-01" : undefined,
        conformityScheme: isRegulated ? "REGULATED" : "NON_REGULATED",
      };
    }

    const token = await this.getAccessToken();
    return this.executeWithRetry(async () => {
      try {
        const response = await this.http.get(`/tariff/inquiry/${hsCode}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        return response.data;
      } catch (err) {
        throw this.handleError(`HS Code Lookup Failed [${hsCode}]`, err);
      }
    });
  }

  /**
   * 3. Live / Mock PCoC Verification
   */
  public async verifyPcoc(certificateNumber: string): Promise<SaberPcocLookupResult> {
    if (this.mockMode) {
      const isValid = certificateNumber.startsWith("PCOC-") && !certificateNumber.includes("EXPIRED");
      return {
        certificateNumber,
        status: isValid ? "ACTIVE" : "EXPIRED",
        cabBodyName: "TÜV Rheinland Middle East",
        issueDate: "2026-01-01",
        expiryDate: isValid ? "2027-01-01" : "2026-01-01",
        hsCodesCovered: ["85044090", "850440900000"],
      };
    }

    const token = await this.getAccessToken();
    return this.executeWithRetry(async () => {
      try {
        const response = await this.http.get(`/certificates/pcoc/${certificateNumber}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        return response.data;
      } catch (err) {
        throw this.handleError(`PCoC Verification Failed [${certificateNumber}]`, err);
      }
    });
  }

  /**
   * 4. SCoC Consignment Submission with Idempotency Key
   */
  public async submitScoc(payload: SaberScocSubmissionPayload): Promise<SaberScocSubmissionResponse> {
    if (this.mockMode) {
      const randomSuffix = Math.floor(1000 + Math.random() * 9000);
      return {
        scocNumber: `SCOC-2026-${randomSuffix}`,
        applicationStatus: "APPROVED",
        customsReleaseCode: `FASAH-REL-${randomSuffix}`,
        barcodeUrl: `https://sandbox.saber.sa/barcode/scoc-2026-${randomSuffix}.png`,
        submittedAt: new Date().toISOString(),
      };
    }

    const token = await this.getAccessToken();
    const idempotencyKey = this.generateIdempotencyKey(payload);

    return this.executeWithRetry(async () => {
      try {
        const response = await this.http.post("/shipments/scoc", payload, {
          headers: {
            Authorization: `Bearer ${token}`,
            "X-Idempotency-Key": idempotencyKey,
          },
        });
        return response.data;
      } catch (err) {
        throw this.handleError("SCoC Issuance Submission Failed", err);
      }
    });
  }

  /**
   * 5. Async Poller: Polls status until clearance or terminal rejection
   */
  public async pollScocStatus(
    scocNumber: string,
    options: PollScocOptions = {}
  ): Promise<SaberScocSubmissionResponse> {
    const intervalMs = options.intervalMs ?? 500;
    const maxAttempts = options.maxAttempts ?? 10;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (this.mockMode) {
        return {
          scocNumber,
          applicationStatus: "APPROVED",
          customsReleaseCode: `FASAH-REL-${scocNumber}`,
          barcodeUrl: `https://sandbox.saber.sa/barcode/${scocNumber}.png`,
          submittedAt: new Date().toISOString(),
        };
      }

      const token = await this.getAccessToken();
      const response = await this.http.get(`/shipments/scoc/${scocNumber}/status`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      const data: SaberScocSubmissionResponse = response.data;
      if (data.applicationStatus === "APPROVED" || data.applicationStatus === "REJECTED") {
        return data;
      }

      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }

    throw new Error(`[SaberApiClient] SCoC polling timed out after ${maxAttempts} attempts for ${scocNumber}`);
  }

  private handleError(context: string, error: unknown): Error {
    if (axios.isAxiosError(error)) {
      const axiosErr = error as AxiosError<any>;
      const details = axiosErr.response?.data?.message || axiosErr.message;
      const status = axiosErr.response?.status;
      return new Error(`[SaberApiClient] ${context}: (${status || "Network"}) - ${details}`);
    }
    return new Error(`[SaberApiClient] ${context}: ${(error as Error).message}`);
  }
}