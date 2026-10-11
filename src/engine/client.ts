import axios, { AxiosInstance, AxiosError } from 'axios';

export type SaberEnvironment = 'sandbox' | 'production';

export interface SaberClientConfig {
  clientId: string;
  clientSecret: string;
  apiKey: string;
  environment?: SaberEnvironment;
  customBaseUrl?: string;
  timeoutMs?: number;
}

export interface SaberAuthToken {
  accessToken: string;
  expiresAt: number;
}

export interface SaberTariffInquiry {
  hsCode: string; // 12-digit KSA national tariff
  productDescriptionAr?: string;
  productDescriptionEn?: string;
  technicalRegulationRequired: boolean;
  technicalRegulationId?: string;
  conformityScheme: 'REGULATED' | 'NON_REGULATED';
}

export interface SaberPcocLookupResult {
  certificateNumber: string;
  status: 'ACTIVE' | 'EXPIRED' | 'SUSPENDED' | 'CANCELLED';
  cabBodyName: string; // e.g., TÜV, SGS, Intertek
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
  applicationStatus: 'APPROVED' | 'PENDING_CAB_AUDIT' | 'REJECTED';
  customsReleaseCode?: string;
  barcodeUrl?: string;
  rejectionReasons?: string[];
  submittedAt: string;
}

export class SaberApiClient {
  private http: AxiosInstance;
  private tokenCache: SaberAuthToken | null = null;
  private readonly baseUrl: string;

  constructor(private config: SaberClientConfig) {
    const defaultEnv = config.environment || 'sandbox';
    this.baseUrl =
      config.customBaseUrl ||
      (defaultEnv === 'sandbox'
        ? 'https://sandbox.saber.sa/api/v2'
        : 'https://api.saber.sa/v2');

    this.http = axios.create({
      baseURL: this.baseUrl,
      timeout: config.timeoutMs || 12000,
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': config.apiKey,
        'User-Agent': 'MIU33-Saber-SDK/1.0.0',
      },
    });
  }

  /**
   * 1. Authentication Handshake with In-Memory Token Caching
   */
  public async getAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.tokenCache && this.tokenCache.expiresAt > now + 60000) {
      return this.tokenCache.accessToken;
    }

    try {
      const response = await this.http.post('/oauth/token', {
        grant_type: 'client_credentials',
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
      throw this.handleError('OAuth2 Authentication Failed', err);
    }
  }

  /**
   * 2. Live HS Code Tariff & Technical Regulation (TR) Inquiry
   */
  public async queryTariffRegulation(hsCode: string): Promise<SaberTariffInquiry> {
    const token = await this.getAccessToken();
    try {
      const response = await this.http.get(`/tariff/inquiry/${hsCode}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      return response.data;
    } catch (err) {
      throw this.handleError(`HS Code Lookup Failed [${hsCode}]`, err);
    }
  }

  /**
   * 3. Live PCoC Status Lookup in SABER Central Registry
   */
  public async verifyPcoc(certificateNumber: string): Promise<SaberPcocLookupResult> {
    const token = await this.getAccessToken();
    try {
      const response = await this.http.get(`/certificates/pcoc/${certificateNumber}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      return response.data;
    } catch (err) {
      throw this.handleError(`PCoC Verification Failed [${certificateNumber}]`, err);
    }
  }

  /**
   * 4. SCoC Consignment Issuance Request
   */
  public async submitScoc(payload: SaberScocSubmissionPayload): Promise<SaberScocSubmissionResponse> {
    const token = await this.getAccessToken();
    try {
      const response = await this.http.post('/shipments/scoc', payload, {
        headers: { Authorization: `Bearer ${token}` },
      });
      return response.data;
    } catch (err) {
      throw this.handleError('SCoC Issuance Submission Failed', err);
    }
  }

  private handleError(context: string, error: unknown): Error {
    if (axios.isAxiosError(error)) {
      const axiosErr = error as AxiosError<any>;
      const details = axiosErr.response?.data?.message || axiosErr.message;
      const status = axiosErr.response?.status;
      return new Error(`[SaberApiClient] ${context}: (${status || 'Network'}) - ${details}`);
    }
    return new Error(`[SaberApiClient] ${context}: ${(error as Error).message}`);
  }
}