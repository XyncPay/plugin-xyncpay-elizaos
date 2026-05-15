import { describe, it, expect, vi } from "vitest";
import type { ActionResult } from "@elizaos/core";
import { translatePaymentAction } from "../../actions/translatePayment";
import {
  makeRuntime,
  makeMessage,
  makeService,
  makeSessionMemory,
  VALID_SETTINGS,
  TEST_PAYMENT_ID,
  TEST_SETTLEMENT_ID,
} from "../test-utils";

const MOCK_TRANSLATE_RESPONSE = {
  data: {
    paymentId: TEST_PAYMENT_ID,
    settlementId: TEST_SETTLEMENT_ID,
    unsignedTransaction: {
      chainId: 8453,
      to: "0xAbC1234567890AbC1234567890AbC1234567890Ab",
      data: "0x",
      value: "0",
      gasLimit: "21000",
      maxFeePerGas: "1000000000",
      maxPriorityFeePerGas: "100000000",
    },
    request: {
      id: TEST_PAYMENT_ID,
      feeAmount: "100",
      netAmount: "9900",
      sourceProtocol: "x402",
      targetProtocol: "x402",
      currency: "USDC",
      amount: "10000000",
      chain: "base",
    },
  },
};

describe("XYNCPAY_TRANSLATE_PAYMENT : validate", () => {
  it("returns true when service is available", async () => {
    const service = makeService();
    const runtime = makeRuntime(VALID_SETTINGS, {}, service);
    const result = await translatePaymentAction.validate(runtime, makeMessage());
    expect(result).toBe(true);
  });

  it("returns false when service is not available", async () => {
    const runtime = makeRuntime(VALID_SETTINGS, {}, null);
    const result = await translatePaymentAction.validate(runtime, makeMessage());
    expect(result).toBe(false);
  });
});

describe("XYNCPAY_TRANSLATE_PAYMENT : handler (explicit params)", () => {
  it("translates payment from explicit content fields and persists to memory", async () => {
    const sessionMemory = makeSessionMemory();
    const translateSpy = vi.fn().mockResolvedValue(MOCK_TRANSLATE_RESPONSE);
    const service = makeService({ translatePayment: translateSpy });
    const runtime = makeRuntime(
      VALID_SETTINGS,
      { xyncpay_session: [sessionMemory] },
      service,
    );
    const message = makeMessage({
      text: "send 10 USDC",
      recipient: "0xAbC1234567890AbC1234567890AbC1234567890Ab",
      amount: "10",
      currency: "USDC",
    });

    const result = await translatePaymentAction.handler(runtime, message) as ActionResult;
    expect(result.success).toBe(true);
    expect(result.text).toContain(TEST_PAYMENT_ID);
    expect(runtime.createMemory).toHaveBeenCalled();
    expect(translateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        payeeAddress: "0xAbC1234567890AbC1234567890AbC1234567890Ab",
        amount: "10",
        currency: "USDC",
      }),
    );
  });

  it("passes sessionId and memo from explicit params", async () => {
    const sessionMemory = makeSessionMemory();
    const service = makeService({
      translatePayment: async (params: { memo?: string; sessionId: string }) => {
        expect(params.memo).toBe("for services rendered");
        expect(params.sessionId).toBeTruthy();
        return MOCK_TRANSLATE_RESPONSE;
      },
    });
    const runtime = makeRuntime(
      VALID_SETTINGS,
      { xyncpay_session: [sessionMemory] },
      service,
    );
    const message = makeMessage({
      text: "pay",
      recipient: "0xAbC1234567890AbC1234567890AbC1234567890Ab",
      amount: "5",
      currency: "USDC",
      memo: "for services rendered",
    });

    const result = await translatePaymentAction.handler(runtime, message) as ActionResult;
    expect(result.success).toBe(true);
  });
});

describe("XYNCPAY_TRANSLATE_PAYMENT : handler (LLM fallback)", () => {
  it("falls back to LLM extraction when explicit params are absent", async () => {
    const sessionMemory = makeSessionMemory();
    const service = makeService({
      translatePayment: async () => MOCK_TRANSLATE_RESPONSE,
    });
    const runtime = makeRuntime(
      VALID_SETTINGS,
      { xyncpay_session: [sessionMemory] },
      service,
      () =>
        Promise.resolve({
          recipient: "0xAbC1234567890AbC1234567890AbC1234567890Ab",
          amount: "10",
          currency: "USDC",
        }),
    );
    const message = makeMessage({ text: "Send 10 USDC to 0xAbC1234567890AbC1234567890AbC1234567890Ab" });

    const result = await translatePaymentAction.handler(runtime, message) as ActionResult;
    expect(result.success).toBe(true);
    expect(result.text).toContain(TEST_PAYMENT_ID);
  });
});

describe("XYNCPAY_TRANSLATE_PAYMENT : handler (error paths)", () => {
  it("returns an error when service is not available", async () => {
    const runtime = makeRuntime(VALID_SETTINGS, {}, null);
    const result = await translatePaymentAction.handler(runtime, makeMessage()) as ActionResult;
    expect(result.success).toBe(false);
    expect(result.error).toContain("XyncPayService not available");
  });

  it("returns an error when no active session exists", async () => {
    const service = makeService();
    const runtime = makeRuntime(VALID_SETTINGS, {}, service);
    const message = makeMessage({
      text: "pay",
      recipient: "0xAbC1234567890AbC1234567890AbC1234567890Ab",
      amount: "10",
      currency: "USDC",
    });
    const result = await translatePaymentAction.handler(runtime, message) as ActionResult;
    expect(result.success).toBe(false);
    expect(result.error).toContain("XYNCPAY_CREATE_SESSION");
  });

  it("returns an error when the session has expired", async () => {
    const expiredSession = makeSessionMemory(Date.now() - 1_000);
    const service = makeService();
    const runtime = makeRuntime(
      VALID_SETTINGS,
      { xyncpay_session: [expiredSession] },
      service,
    );
    const message = makeMessage({
      text: "pay",
      recipient: "0xAbC1234567890AbC1234567890AbC1234567890Ab",
      amount: "10",
      currency: "USDC",
    });
    const result = await translatePaymentAction.handler(runtime, message) as ActionResult;
    expect(result.success).toBe(false);
    expect(result.error).toContain("XYNCPAY_CREATE_SESSION");
  });

  it("returns an error when the currency is not in allowedCurrencies", async () => {
    const sessionMemory = makeSessionMemory();
    const service = makeService();
    const runtime = makeRuntime(
      VALID_SETTINGS,
      { xyncpay_session: [sessionMemory] },
      service,
    );
    const message = makeMessage({
      text: "pay",
      recipient: "0xAbC1234567890AbC1234567890AbC1234567890Ab",
      amount: "10",
      currency: "ETH",
    });
    const result = await translatePaymentAction.handler(runtime, message) as ActionResult;
    expect(result.success).toBe(false);
    expect(result.error).toContain("ETH");
  });

  it("returns an error when both extraction paths fail", async () => {
    const sessionMemory = makeSessionMemory();
    const service = makeService();
    const runtime = makeRuntime(
      VALID_SETTINGS,
      { xyncpay_session: [sessionMemory] },
      service,
      () => Promise.resolve(null),
    );
    const message = makeMessage({ text: "pay someone something" });

    const result = await translatePaymentAction.handler(runtime, message) as ActionResult;
    expect(result.success).toBe(false);
    expect(result.error).toContain("recipient");
  });
});
