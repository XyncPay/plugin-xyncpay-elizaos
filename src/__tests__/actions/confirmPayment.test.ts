import { describe, it, expect, vi } from "vitest";
import type { ActionResult } from "@elizaos/core";
import { confirmPaymentAction } from "../../actions/confirmPayment";
import {
  makeRuntime,
  makeMessage,
  makeService,
  makePaymentMemory,
  VALID_SETTINGS,
  TEST_PAYMENT_ID,
} from "../test-utils";

const { sendTransactionMock, waitMock } = vi.hoisted(() => ({
  sendTransactionMock: vi.fn(),
  waitMock: vi.fn(),
}));

vi.mock("ethers", () => ({
  Wallet: vi.fn(() => ({
    sendTransaction: sendTransactionMock,
    signMessage: vi.fn().mockResolvedValue("0xsignature"),
  })),
  JsonRpcProvider: vi.fn(() => ({})),
}));

describe("XYNCPAY_CONFIRM_PAYMENT : validate", () => {
  it("returns true when service is available and a payment is in memory", async () => {
    const paymentMemory = makePaymentMemory();
    const service = makeService();
    const runtime = makeRuntime(
      VALID_SETTINGS,
      { xyncpay_payment: [paymentMemory] },
      service,
    );
    const result = await confirmPaymentAction.validate(runtime, makeMessage());
    expect(result).toBe(true);
  });

  it("returns false when service is not available", async () => {
    const paymentMemory = makePaymentMemory();
    const runtime = makeRuntime(
      VALID_SETTINGS,
      { xyncpay_payment: [paymentMemory] },
      null,
    );
    const result = await confirmPaymentAction.validate(runtime, makeMessage());
    expect(result).toBe(false);
  });

  it("returns false when no payment is in memory", async () => {
    const service = makeService();
    const runtime = makeRuntime(VALID_SETTINGS, {}, service);
    const result = await confirmPaymentAction.validate(runtime, makeMessage());
    expect(result).toBe(false);
  });
});

describe("XYNCPAY_CONFIRM_PAYMENT : handler (early exits)", () => {
  it("returns an error when service is not available", async () => {
    const runtime = makeRuntime(VALID_SETTINGS, {}, null);
    const result = await confirmPaymentAction.handler(runtime, makeMessage()) as ActionResult;
    expect(result.success).toBe(false);
    expect(result.error).toContain("XyncPayService not available");
  });

  it("returns an error when no pending payment is in memory", async () => {
    const service = makeService();
    const runtime = makeRuntime(VALID_SETTINGS, {}, service);
    const result = await confirmPaymentAction.handler(runtime, makeMessage()) as ActionResult;
    expect(result.success).toBe(false);
    expect(result.error).toContain("XYNCPAY_TRANSLATE_PAYMENT");
  });
});

describe("XYNCPAY_CONFIRM_PAYMENT : handler (on-chain paths)", () => {
  it("returns success when transaction confirms and API reports it", async () => {
    const paymentMemory = makePaymentMemory();
    const service = makeService({
      confirmPayment: async () => ({
        data: {
          id: TEST_PAYMENT_ID,
          status: "confirmed",
          txHash: "0xtxhash001",
          blockNumber: 1000,
          gasUsed: "21000",
          feeAmount: "100",
          netAmount: "9900",
          confirmedAt: Date.now(),
        },
      }),
    });
    const runtime = makeRuntime(
      VALID_SETTINGS,
      { xyncpay_payment: [paymentMemory] },
      service,
    );

    sendTransactionMock.mockResolvedValue({ hash: "0xtxhash001", wait: waitMock });
    waitMock.mockResolvedValue({ hash: "0xtxhash001", blockNumber: 1000, status: 1 });

    const result = await confirmPaymentAction.handler(runtime, makeMessage()) as ActionResult;
    expect(result.success).toBe(true);
    expect(result.text).toContain("0xtxhash001");
    expect(runtime.createMemory).toHaveBeenCalled();
  });

  it("returns an error when the transaction reverts on-chain (status 0)", async () => {
    const paymentMemory = makePaymentMemory();
    const service = makeService();
    const runtime = makeRuntime(
      VALID_SETTINGS,
      { xyncpay_payment: [paymentMemory] },
      service,
    );

    sendTransactionMock.mockResolvedValue({ hash: "0xtxhash002", wait: waitMock });
    waitMock.mockResolvedValue({ hash: "0xtxhash002", blockNumber: 1001, status: 0 });

    const result = await confirmPaymentAction.handler(runtime, makeMessage()) as ActionResult;
    expect(result.success).toBe(false);
    expect(result.error).toContain("reverted");
  });

  it("returns partial success when tx confirms but API reporting fails", async () => {
    const paymentMemory = makePaymentMemory();
    const service = makeService({
      confirmPayment: async () => {
        throw new Error("XyncPay API unavailable");
      },
    });
    const runtime = makeRuntime(
      VALID_SETTINGS,
      { xyncpay_payment: [paymentMemory] },
      service,
    );

    sendTransactionMock.mockResolvedValue({ hash: "0xtxhash003", wait: waitMock });
    waitMock.mockResolvedValue({ hash: "0xtxhash003", blockNumber: 1002, status: 1 });

    const result = await confirmPaymentAction.handler(runtime, makeMessage()) as ActionResult;
    expect(result.success).toBe(true);
    expect(result.text).toContain("reporting to XyncPay failed");
    expect((result.data as { apiConfirmationFailed?: boolean }).apiConfirmationFailed).toBe(true);
  });
});
