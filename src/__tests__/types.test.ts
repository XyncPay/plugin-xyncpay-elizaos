import { describe, it, expect } from "vitest";
import type {
  StoredAgentRegistration,
  StoredSession,
  StoredPayment,
  XyncPayErrorResponse,
  PaymentStatus,
  UnsignedTransaction,
  PaymentRequestDetails,
  SettlementInfo,
} from "../types";
import {
  TEST_WALLET_ADDRESS,
  TEST_XYNC_ID,
  TEST_SESSION_ID,
  TEST_PAYMENT_ID,
  TEST_SETTLEMENT_ID,
} from "./test-utils";

describe("StoredAgentRegistration", () => {
  it("can be constructed with required fields", () => {
    const reg: StoredAgentRegistration = {
      xyncId: TEST_XYNC_ID,
      walletAddress: TEST_WALLET_ADDRESS,
      preferredChain: "base",
      registeredAt: 1_000_000,
    };
    expect(reg.xyncId).toBe(TEST_XYNC_ID);
    expect(reg.walletAddress).toBe(TEST_WALLET_ADDRESS);
  });
});

describe("StoredSession", () => {
  it("can be constructed with required fields", () => {
    const session: StoredSession = {
      sessionId: TEST_SESSION_ID,
      agentId: TEST_XYNC_ID,
      expiresAt: Date.now() + 3_600_000,
    };
    expect(session.sessionId).toBe(TEST_SESSION_ID);
  });
});

describe("StoredPayment", () => {
  it("can be constructed with required fields", () => {
    const tx: UnsignedTransaction = {
      chainId: 8453,
      to: "0xRecipient",
      data: "0x",
      value: "0",
      gasLimit: "21000",
      maxFeePerGas: "1000000000",
      maxPriorityFeePerGas: "100000000",
    };
    const req: PaymentRequestDetails = {
      id: TEST_PAYMENT_ID,
      feeAmount: "100",
      netAmount: "9900",
      sourceProtocol: "x402",
      targetProtocol: "x402",
      currency: "USDC",
      amount: "10000000",
      chain: "base",
    };
    const payment: StoredPayment = {
      paymentId: TEST_PAYMENT_ID,
      settlementId: TEST_SETTLEMENT_ID,
      unsignedTransaction: tx,
      request: req,
      createdAt: Date.now(),
    };
    expect(payment.paymentId).toBe(TEST_PAYMENT_ID);
    expect(payment.unsignedTransaction.maxFeePerGas).toBe("1000000000");
  });
});

describe("XyncPayErrorResponse", () => {
  it("accepts all defined error codes", () => {
    const errorCodes: XyncPayErrorResponse["error"]["code"][] = [
      "INVALID_SIGNATURE",
      "AGENT_EXISTS",
      "AGENT_NOT_FOUND",
      "SESSION_EXPIRED",
      "IDEMPOTENCY_KEY_REQUIRED",
      "IDEMPOTENCY_CONFLICT",
      "IDEMPOTENCY_STORE_UNAVAILABLE",
      "UNAUTHORIZED",
      "UNAUTHENTICATED",
    ];
    const response: XyncPayErrorResponse = {
      error: { code: "AGENT_EXISTS", message: "Already registered" },
    };
    expect(response.error.code).toBe("AGENT_EXISTS");
    expect(errorCodes).toContain("IDEMPOTENCY_KEY_REQUIRED");
    expect(errorCodes).toContain("UNAUTHORIZED");
  });
});

describe("PaymentStatus", () => {
  it("includes ready and pending statuses", () => {
    const statuses: PaymentStatus[] = [
      "ready",
      "pending",
      "pending_signature",
      "submitted",
      "confirmed",
      "failed",
      "expired",
    ];
    expect(statuses).toContain("ready");
    expect(statuses).toContain("pending");
    expect(statuses).toHaveLength(7);
  });
});

describe("SettlementInfo", () => {
  it("can be constructed with required and optional fields", () => {
    const settlement: SettlementInfo = {
      id: TEST_SETTLEMENT_ID,
      chain: "base",
      status: "confirmed",
      txHash: "0xabc123",
      blockNumber: 100,
    };
    expect(settlement.chain).toBe("base");
    expect(settlement.txHash).toBe("0xabc123");
  });
});
