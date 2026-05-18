import { describe, it, expect, vi } from "vitest";
import type { ActionResult } from "@elizaos/core";
import { getPaymentStatusAction } from "../../actions/getPaymentStatus";
import {
  makeRuntime,
  makeMessage,
  makeService,
  makePaymentMemory,
  VALID_SETTINGS,
  TEST_PAYMENT_ID,
} from "../test-utils";

const MOCK_STATUS_RESPONSE = {
  data: {
    id: TEST_PAYMENT_ID,
    sourceProtocol: "x402",
    targetProtocol: "x402",
    payerXyncId: "xync_payer_001",
    payeeAddress: "0xAbC1234567890AbC1234567890AbC1234567890Ab",
    amount: "10000000",
    feeAmount: "100",
    netAmount: "9900",
    currency: "USDC",
    sourceChain: "base",
    targetChain: "base",
    status: "confirmed",
    createdAt: 1_000_000,
    expiresAt: 2_000_000,
    settlement: {
      id: "settle_tst_0001",
      chain: "base",
      status: "confirmed",
      txHash: "0xtxhash999",
      blockNumber: 5000,
    },
  },
};

describe("XYNCPAY_GET_PAYMENT_STATUS : validate", () => {
  it("returns true when message text mentions a paymentId", async () => {
    const service = makeService();
    const runtime = makeRuntime(VALID_SETTINGS, {}, service);
    const message = makeMessage({ text: "What is the status of xyn_pay_abc123?" });
    const result = await getPaymentStatusAction.validate(runtime, message);
    expect(result).toBe(true);
  });

  it("returns true when no paymentId in message but one is found in memory", async () => {
    const paymentMemory = makePaymentMemory();
    const service = makeService();
    const runtime = makeRuntime(
      VALID_SETTINGS,
      { xyncpay_payment: [paymentMemory] },
      service,
    );
    const result = await getPaymentStatusAction.validate(runtime, makeMessage());
    expect(result).toBe(true);
  });

  it("returns false when service is not available", async () => {
    const runtime = makeRuntime(VALID_SETTINGS, {}, null);
    const message = makeMessage({ text: "What is the status of xyn_pay_abc123?" });
    const result = await getPaymentStatusAction.validate(runtime, message);
    expect(result).toBe(false);
  });

  it("returns false when no paymentId in message and no payment in memory", async () => {
    const service = makeService();
    const runtime = makeRuntime(VALID_SETTINGS, {}, service);
    const result = await getPaymentStatusAction.validate(runtime, makeMessage());
    expect(result).toBe(false);
  });
});

describe("XYNCPAY_GET_PAYMENT_STATUS : handler", () => {
  it("queries status using paymentId returned by LLM extraction", async () => {
    const getStatusSpy = vi.fn().mockResolvedValue(MOCK_STATUS_RESPONSE);
    const service = makeService({ getPaymentStatus: getStatusSpy });
    const runtime = makeRuntime(
      VALID_SETTINGS,
      {},
      service,
      () => Promise.resolve({ paymentId: "xyn_pay_from_llm" }),
    );

    const result = await getPaymentStatusAction.handler(runtime, makeMessage()) as ActionResult;
    expect(result.success).toBe(true);
    expect(getStatusSpy).toHaveBeenCalledWith("xyn_pay_from_llm");
  });

  it("falls back to the most recent payment in memory when LLM returns nothing", async () => {
    const paymentMemory = makePaymentMemory();
    const getStatusSpy = vi.fn().mockResolvedValue(MOCK_STATUS_RESPONSE);
    const service = makeService({ getPaymentStatus: getStatusSpy });
    const runtime = makeRuntime(
      VALID_SETTINGS,
      { xyncpay_payment: [paymentMemory] },
      service,
      () => Promise.resolve({}),
    );

    const result = await getPaymentStatusAction.handler(runtime, makeMessage()) as ActionResult;
    expect(result.success).toBe(true);
    expect(getStatusSpy).toHaveBeenCalledWith(TEST_PAYMENT_ID);
  });

  it("includes txHash and blockNumber in the response text when present", async () => {
    const paymentMemory = makePaymentMemory();
    const service = makeService({
      getPaymentStatus: async () => MOCK_STATUS_RESPONSE,
    });
    const runtime = makeRuntime(
      VALID_SETTINGS,
      { xyncpay_payment: [paymentMemory] },
      service,
      () => Promise.resolve({}),
    );

    const result = await getPaymentStatusAction.handler(runtime, makeMessage()) as ActionResult;
    expect(result.success).toBe(true);
    expect(result.text).toContain("0xtxhash999");
    expect(result.text).toContain("5000");
  });

  it("persists the status query result to memory", async () => {
    const paymentMemory = makePaymentMemory();
    const service = makeService({
      getPaymentStatus: async () => MOCK_STATUS_RESPONSE,
    });
    const runtime = makeRuntime(
      VALID_SETTINGS,
      { xyncpay_payment: [paymentMemory] },
      service,
      () => Promise.resolve({}),
    );

    await getPaymentStatusAction.handler(runtime, makeMessage()) as ActionResult;
    expect(runtime.createMemory).toHaveBeenCalled();
  });

  it("returns an error when no paymentId is found in LLM output or memory", async () => {
    const service = makeService();
    const runtime = makeRuntime(
      VALID_SETTINGS,
      {},
      service,
      () => Promise.resolve({}),
    );

    const result = await getPaymentStatusAction.handler(runtime, makeMessage()) as ActionResult;
    expect(result.success).toBe(false);
    expect(result.error).toContain("XYNCPAY_TRANSLATE_PAYMENT");
  });

  it("uses explicit paymentId from message.content when provided (no LLM call)", async () => {
    const service = makeService({
      getPaymentStatus: async (id: string) => {
        expect(id).toBe(TEST_PAYMENT_ID);
        return MOCK_STATUS_RESPONSE;
      },
    });
    // Runtime without useModel to simulate OpenClaw or other LLM-less environments.
    const runtime = makeRuntime(VALID_SETTINGS, {}, service);
    // Defensively remove useModel to ensure the explicit path doesn't call the LLM.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (runtime as any).useModel = undefined;
    const message = makeMessage({
      text: "Check the payment status",
      paymentId: TEST_PAYMENT_ID,
    });
    const result = await getPaymentStatusAction.handler(runtime, message) as ActionResult;
    expect(result.success).toBe(true);
    expect(result.text).toContain(TEST_PAYMENT_ID);
  });

  it("falls back to memory when useModel is unavailable and no explicit paymentId", async () => {
    const service = makeService({
      getPaymentStatus: async () => MOCK_STATUS_RESPONSE,
    });
    const sessionMemory = makePaymentMemory();
    const runtime = makeRuntime(
      VALID_SETTINGS,
      { xyncpay_payment: [sessionMemory] },
      service
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (runtime as any).useModel = undefined;
    const message = makeMessage({ text: "Status update please" });
    const result = await getPaymentStatusAction.handler(runtime, message) as ActionResult;
    expect(result.success).toBe(true);
    expect(result.text).toContain(TEST_PAYMENT_ID);
  });

  it("returns an error when service is not available", async () => {
    const runtime = makeRuntime(VALID_SETTINGS, {}, null);
    const result = await getPaymentStatusAction.handler(runtime, makeMessage()) as ActionResult;
    expect(result.success).toBe(false);
    expect(result.error).toContain("XyncPayService not available");
  });
});
