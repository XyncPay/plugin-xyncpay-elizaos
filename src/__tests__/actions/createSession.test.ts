import { describe, it, expect } from "vitest";
import type { ActionResult } from "@elizaos/core";
import { createSessionAction } from "../../actions/createSession";
import {
  makeRuntime,
  makeMessage,
  makeService,
  makeRegistrationMemory,
  VALID_SETTINGS,
  TEST_SESSION_ID,
  TEST_XYNC_ID,
} from "../test-utils";

const MOCK_SESSION_RESPONSE = {
  data: {
    sessionId: TEST_SESSION_ID,
    agentId: TEST_XYNC_ID,
    spendingCap: "100000000",
    perTransactionLimit: "10000000",
    rateLimit: 60,
    totalSpent: "0",
    transactionCount: 0,
    allowedChains: ["base"],
    allowedCurrencies: ["USDC"],
    status: "active",
    createdAt: Date.now(),
    expiresAt: Date.now() + 86_400_000,
  },
};

describe("XYNCPAY_CREATE_SESSION : validate", () => {
  it("returns true when service is available and xyncId found in memory", async () => {
    const regMemory = makeRegistrationMemory();
    const service = makeService();
    const runtime = makeRuntime(
      VALID_SETTINGS,
      { xyncpay_registration: [regMemory] },
      service,
    );
    const result = await createSessionAction.validate(runtime, makeMessage());
    expect(result).toBe(true);
  });

  it("returns false when service is not available", async () => {
    const regMemory = makeRegistrationMemory();
    const runtime = makeRuntime(
      VALID_SETTINGS,
      { xyncpay_registration: [regMemory] },
      null,
    );
    const result = await createSessionAction.validate(runtime, makeMessage());
    expect(result).toBe(false);
  });

  it("returns false when no registration exists in memory", async () => {
    const service = makeService();
    const runtime = makeRuntime(VALID_SETTINGS, {}, service);
    const result = await createSessionAction.validate(runtime, makeMessage());
    expect(result).toBe(false);
  });
});

describe("XYNCPAY_CREATE_SESSION : handler", () => {
  it("creates a session and persists it to memory", async () => {
    const regMemory = makeRegistrationMemory();
    const service = makeService({
      createSession: async () => MOCK_SESSION_RESPONSE,
    });
    const runtime = makeRuntime(
      VALID_SETTINGS,
      { xyncpay_registration: [regMemory] },
      service,
    );

    const result = await createSessionAction.handler(runtime, makeMessage()) as ActionResult;
    expect(result.success).toBe(true);
    expect(result.text).toContain(TEST_SESSION_ID);
    expect(runtime.createMemory).toHaveBeenCalled();
  });

  it("passes spending cap and rate limit from config to the API", async () => {
    const regMemory = makeRegistrationMemory();
    const service = makeService({
      createSession: async (params: { spendingCap: string; rateLimit: number }) => {
        expect(params.spendingCap).toBe("100000000");
        expect(params.rateLimit).toBe(60);
        return MOCK_SESSION_RESPONSE;
      },
    });
    const runtime = makeRuntime(
      VALID_SETTINGS,
      { xyncpay_registration: [regMemory] },
      service,
    );

    const result = await createSessionAction.handler(runtime, makeMessage()) as ActionResult;
    expect(result.success).toBe(true);
  });

  it("returns an error when service is not available", async () => {
    const runtime = makeRuntime(VALID_SETTINGS, {}, null);
    const result = await createSessionAction.handler(runtime, makeMessage()) as ActionResult;
    expect(result.success).toBe(false);
    expect(result.error).toContain("XyncPayService not available");
  });

  it("returns an error when no xyncId found in memory", async () => {
    const service = makeService();
    const runtime = makeRuntime(VALID_SETTINGS, {}, service);
    const result = await createSessionAction.handler(runtime, makeMessage()) as ActionResult;
    expect(result.success).toBe(false);
    expect(result.error).toContain("XYNCPAY_REGISTER_AGENT");
  });
});
