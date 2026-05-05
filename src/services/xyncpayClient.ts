// XyncPay HTTP client for plugin-xyncpay-elizaos. Wraps every XyncPay API endpoint with typed
// methods. Signs request bodies with ethers wallet on endpoints that require authentication.
// Throws typed errors on non-2xx responses.

import { Wallet } from "ethers";
import type {
  XyncPayConfig,
  RegisterAgentChallengeRequest,
  RegisterAgentChallengeResponse,
  RegisterAgentCompleteRequest,
  RegisterAgentCompleteResponse,
  CreateSessionRequest,
  CreateSessionResponse,
  TranslatePaymentRequest,
  TranslatePaymentResponse,
  GetPaymentStatusResponse,
  ConfirmPaymentRequest,
  ConfirmPaymentResponse,
  XyncPayErrorResponse,
  XyncPayErrorCode,
} from "../types";

export class XyncPayApiError extends Error {
  constructor(
    public readonly code: XyncPayErrorCode | "NETWORK_ERROR" | "PARSE_ERROR" | "UNKNOWN_ERROR",
    public readonly httpStatus: number | null,
    message: string,
    public readonly responseBody?: unknown
  ) {
    super(message);
    this.name = "XyncPayApiError";
  }
}

function isErrorResponse(body: unknown): body is XyncPayErrorResponse {
  if (typeof body !== "object" || body === null) return false;
  const rec = body as Record<string, unknown>;
  if (typeof rec["error"] !== "object" || rec["error"] === null) return false;
  const err = rec["error"] as Record<string, unknown>;
  return typeof err["code"] === "string" && typeof err["message"] === "string";
}

export class XyncPayClient {
  private readonly wallet: Wallet;
  private readonly apiUrl: string;
  public readonly walletAddress: string;

  constructor(config: XyncPayConfig) {
    this.wallet = new Wallet(config.walletPrivateKey);
    this.apiUrl = config.apiUrl;
    this.walletAddress = this.wallet.address;
  }

  private async parseResponse<T>(response: Response): Promise<T> {
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new XyncPayApiError(
        "PARSE_ERROR",
        response.status,
        `Request failed with status ${response.status} and non-JSON body`
      );
    }

    if (response.ok) {
      return body as T;
    }

    if (isErrorResponse(body)) {
      throw new XyncPayApiError(body.error.code, response.status, body.error.message, body);
    }

    throw new XyncPayApiError(
      "UNKNOWN_ERROR",
      response.status,
      `Request failed with status ${response.status}`,
      body
    );
  }

  private async signedFetch<TResponse>(
    path: string,
    method: string,
    body: unknown
  ): Promise<TResponse> {
    const url = new URL(path, this.apiUrl).toString();
    const rawBody = JSON.stringify(body);
    const signature = await this.wallet.signMessage(rawBody);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);

    try {
      const response = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          "X-Wallet-Address": this.walletAddress,
          "X-Wallet-Signature": signature,
        },
        body: rawBody,
        signal: controller.signal,
      });
      return this.parseResponse<TResponse>(response);
    } catch (err) {
      if (err instanceof XyncPayApiError) {
        throw err;
      }
      if (err instanceof Error && err.name === "AbortError") {
        throw new XyncPayApiError("NETWORK_ERROR", null, "Request timed out after 30 seconds");
      }
      throw new XyncPayApiError(
        "NETWORK_ERROR",
        null,
        `Network request failed: ${err instanceof Error ? err.message : "unknown error"}`
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  private async unsignedFetch<TResponse>(
    path: string,
    method: string,
    body?: unknown
  ): Promise<TResponse> {
    const url = new URL(path, this.apiUrl).toString();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);

    const fetchOptions: RequestInit = {
      method,
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
    };

    if (body !== undefined) {
      fetchOptions.body = JSON.stringify(body);
    }

    try {
      const response = await fetch(url, fetchOptions);
      return this.parseResponse<TResponse>(response);
    } catch (err) {
      if (err instanceof XyncPayApiError) {
        throw err;
      }
      if (err instanceof Error && err.name === "AbortError") {
        throw new XyncPayApiError("NETWORK_ERROR", null, "Request timed out after 30 seconds");
      }
      throw new XyncPayApiError(
        "NETWORK_ERROR",
        null,
        `Network request failed: ${err instanceof Error ? err.message : "unknown error"}`
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  async requestRegistrationChallenge(
    walletAddress: string,
    preferredChain: string
  ): Promise<RegisterAgentChallengeResponse> {
    const body: RegisterAgentChallengeRequest = { walletAddress, preferredChain };
    return this.unsignedFetch<RegisterAgentChallengeResponse>(
      "/api/v1/agents/register",
      "POST",
      body
    );
  }

  async completeRegistration(
    params: RegisterAgentCompleteRequest
  ): Promise<RegisterAgentCompleteResponse> {
    return this.unsignedFetch<RegisterAgentCompleteResponse>(
      "/api/v1/agents/register",
      "POST",
      params
    );
  }

  async createSession(params: CreateSessionRequest): Promise<CreateSessionResponse> {
    return this.signedFetch<CreateSessionResponse>("/api/v1/sessions/create", "POST", params);
  }

  async translatePayment(params: TranslatePaymentRequest): Promise<TranslatePaymentResponse> {
    return this.signedFetch<TranslatePaymentResponse>(
      "/api/v1/payments/translate",
      "POST",
      params
    );
  }

  async getPaymentStatus(paymentId: string): Promise<GetPaymentStatusResponse> {
    return this.unsignedFetch<GetPaymentStatusResponse>(
      `/api/v1/payments/${encodeURIComponent(paymentId)}`,
      "GET"
    );
  }

  async confirmPayment(
    paymentId: string,
    params: ConfirmPaymentRequest
  ): Promise<ConfirmPaymentResponse> {
    return this.signedFetch<ConfirmPaymentResponse>(
      `/api/v1/payments/${encodeURIComponent(paymentId)}/confirm`,
      "POST",
      params
    );
  }
}
