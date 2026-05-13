// Type definitions for XyncPay API requests and responses.
// Generated from the canonical API contract.
// See https://www.xyncpay.com/api-reference for the live REST API documentation.

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface XyncPayConfig {
  apiUrl: string;
  walletPrivateKey: string;
  preferredChain: string;
  agentName: string;
  baseRpcUrl: string;
}

// ---------------------------------------------------------------------------
// Brand types for nominally-typed ID strings
// ---------------------------------------------------------------------------

export type XyncId = string & { readonly __brand: "XyncId" };
export type SessionId = string & { readonly __brand: "SessionId" };
export type PaymentId = string & { readonly __brand: "PaymentId" };
export type SettlementId = string & { readonly __brand: "SettlementId" };

// ---------------------------------------------------------------------------
// Protocol and chain enumerations
// ---------------------------------------------------------------------------

export type SourceProtocol = "x402" | "mpp" | "ap2";
export type TargetProtocol = "x402" | "mpp" | "ap2";
// "solana" is defined here for forward compatibility; only "base" is active at v1
export type SupportedChain = "base" | "solana";
export type SupportedCurrency = "USDC";

// ---------------------------------------------------------------------------
// Agent registration
// ---------------------------------------------------------------------------

export interface RegisterAgentChallengeRequest {
  walletAddress: string;
  preferredChain: string;
}

export interface RegisterAgentChallengeResponse {
  data: {
    challenge: string;
    nonce: string;
    expiresAt: number;
  };
}

export interface RegisterAgentCompleteRequest {
  walletAddress: string;
  preferredChain: string;
  signature: string;
  nonce: string;
  name: string;
  supportedProtocols: string[];
  supportedChains: string[];
}

export interface RegisterAgentCompleteResponse {
  data: {
    xyncId: XyncId;
    walletAddress: string;
    preferredChain: string;
    supportedProtocols: string[];
    supportedChains: string[];
    reputationScore: number;
    totalTransactions: number;
    totalVolumeUsd: number;
    status: string;
    createdAt: number;
    lastActiveAt: number;
  };
}

// ---------------------------------------------------------------------------
// Spending sessions
// ---------------------------------------------------------------------------

export interface CreateSessionRequest {
  agentId: XyncId;
  spendingCap: string;
  perTransactionLimit: string;
  rateLimit: number;
  allowedChains: string[];
  allowedCurrencies: string[];
  expiresInSeconds: number;
}

export interface CreateSessionResponse {
  data: {
    sessionId: SessionId;
    agentId: XyncId;
    spendingCap: string;
    perTransactionLimit: string;
    rateLimit: number;
    totalSpent: string;
    transactionCount: number;
    allowedChains: string[];
    allowedCurrencies: string[];
    status: string;
    createdAt: number;
    expiresAt: number;
  };
}

// ---------------------------------------------------------------------------
// Payment translation
// ---------------------------------------------------------------------------

export interface TranslatePaymentRequest {
  sourceProtocol: SourceProtocol;
  targetProtocol: TargetProtocol;
  payeeAddress: string;
  amount: string;
  currency: SupportedCurrency;
  chain: SupportedChain;
  sessionId: SessionId;
  memo?: string;
}

export interface UnsignedTransaction {
  chainId: number;
  to: string;
  data: string;
  value: string;
  gasLimit: string;
  maxFeePerGas: string;
  maxPriorityFeePerGas: string;
}

export interface PaymentRequestDetails {
  id: PaymentId;
  feeAmount: string;
  netAmount: string;
  sourceProtocol: SourceProtocol;
  targetProtocol: TargetProtocol;
  currency: SupportedCurrency;
  amount: string;
  chain: SupportedChain;
}

export interface TranslatePaymentResponse {
  data: {
    paymentId: PaymentId;
    settlementId: SettlementId;
    unsignedTransaction: UnsignedTransaction;
    request: PaymentRequestDetails;
  };
}

// ---------------------------------------------------------------------------
// Payment status
// ---------------------------------------------------------------------------

export type PaymentStatus =
  | "ready"
  | "pending"
  | "pending_signature"
  | "submitted"
  | "confirmed"
  | "failed"
  | "expired";

export interface SettlementInfo {
  id: SettlementId;
  chain: SupportedChain;
  status: PaymentStatus;
  txHash?: string;
  blockNumber?: number;
  gasUsed?: string;
  confirmedAt?: number;
}

export interface GetPaymentStatusResponse {
  data: {
    id: PaymentId;
    sourceProtocol: SourceProtocol;
    targetProtocol: TargetProtocol;
    payerXyncId: XyncId;
    payeeAddress: string;
    amount: string;
    feeAmount: string;
    netAmount: string;
    currency: SupportedCurrency;
    sourceChain: SupportedChain;
    targetChain: SupportedChain;
    status: PaymentStatus;
    createdAt: number;
    expiresAt: number;
    translatedAt?: number;
    settlement: SettlementInfo;
  };
}

// ---------------------------------------------------------------------------
// Payment confirmation
// ---------------------------------------------------------------------------

export interface ConfirmPaymentRequest {
  txHash: string;
}

export interface ConfirmPaymentResponse {
  data: {
    id: PaymentId;
    status: PaymentStatus;
    txHash: string;
    blockNumber: number;
    gasUsed: string;
    feeAmount: string;
    netAmount: string;
    confirmedAt: number;
  };
}

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

export type XyncPayErrorCode =
  | "INVALID_SIGNATURE"
  | "AGENT_EXISTS"
  | "AGENT_NOT_FOUND"
  | "SESSION_EXPIRED"
  | "SESSION_EXHAUSTED"
  | "PER_TRANSACTION_LIMIT"
  | "VALIDATION_ERROR"
  | "RATE_LIMIT_EXCEEDED"
  | "UNSUPPORTED_PROTOCOL"
  | "CHAIN_MISMATCH"
  | "NOT_FOUND"
  | "INTERNAL_ERROR"
  | "IDEMPOTENCY_KEY_REQUIRED"
  | "IDEMPOTENCY_CONFLICT"
  | "IDEMPOTENCY_STORE_UNAVAILABLE"
  | "UNAUTHORIZED"
  | "UNAUTHENTICATED";

export interface XyncPayErrorResponse {
  error: {
    code: XyncPayErrorCode;
    message: string;
  };
}

// ---------------------------------------------------------------------------
// ElizaOS Memory storage types
// ---------------------------------------------------------------------------

export interface StoredAgentRegistration {
  xyncId: XyncId;
  walletAddress: string;
  preferredChain: string;
  registeredAt: number;
}

export interface StoredSession {
  sessionId: SessionId;
  agentId: XyncId;
  expiresAt: number;
}

export interface StoredPayment {
  paymentId: PaymentId;
  settlementId: SettlementId;
  unsignedTransaction: UnsignedTransaction;
  request: PaymentRequestDetails;
  createdAt: number;
}
