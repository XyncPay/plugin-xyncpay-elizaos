import { describe, it, expect, vi } from "vitest";
import type { ActionResult } from "@elizaos/core";
import { registerAgentAction } from "../../actions/registerAgent";
import { XyncPayApiError } from "../../services/xyncpayClient";
import {
  makeRuntime,
  makeMessage,
  makeService,
  makeRegistrationMemory,
  VALID_SETTINGS,
  TEST_XYNC_ID,
  TEST_WALLET_ADDRESS,
} from "../test-utils";

describe("XYNCPAY_REGISTER_AGENT : validate", () => {
  it("returns true when the service is registered", async () => {
    const service = makeService();
    const runtime = makeRuntime(VALID_SETTINGS, {}, service);
    const result = await registerAgentAction.validate(runtime, makeMessage());
    expect(result).toBe(true);
  });

  it("returns false when the service is not available", async () => {
    const runtime = makeRuntime(VALID_SETTINGS, {}, null);
    const result = await registerAgentAction.validate(runtime, makeMessage());
    expect(result).toBe(false);
  });
});

describe("XYNCPAY_REGISTER_AGENT : handler", () => {
  it("returns existing registration from memory without calling the API", async () => {
    const regMemory = makeRegistrationMemory();
    const service = makeService();
    const runtime = makeRuntime(
      VALID_SETTINGS,
      { xyncpay_registration: [regMemory] },
      service,
    );

    const result = await registerAgentAction.handler(runtime, makeMessage()) as ActionResult;
    expect(result.success).toBe(true);
    expect(result.text).toContain(TEST_XYNC_ID);
    expect(service.client.requestRegistrationChallenge).not.toHaveBeenCalled();
  });

  it("performs the full challenge-response flow and persists the registration", async () => {
    const challengeSpy = vi.fn().mockResolvedValue({
      data: { challenge: "sign-this-string", nonce: "nonce123", expiresAt: Date.now() + 60_000 },
    });
    const completeSpy = vi.fn().mockResolvedValue({
      data: {
        xyncId: TEST_XYNC_ID,
        walletAddress: TEST_WALLET_ADDRESS,
        preferredChain: "base",
        supportedProtocols: ["x402"],
        supportedChains: ["base"],
        reputationScore: 0,
        totalTransactions: 0,
        totalVolumeUsd: 0,
        status: "active",
        createdAt: Date.now(),
        lastActiveAt: Date.now(),
      },
    });
    const service = makeService({
      requestRegistrationChallenge: challengeSpy,
      completeRegistration: completeSpy,
    });
    const runtime = makeRuntime(VALID_SETTINGS, {}, service);

    const result = await registerAgentAction.handler(runtime, makeMessage()) as ActionResult;
    expect(result.success).toBe(true);
    expect(result.text).toContain(TEST_XYNC_ID);
    expect(challengeSpy).toHaveBeenCalledWith(TEST_WALLET_ADDRESS, "base");
    expect(completeSpy).toHaveBeenCalled();
    expect(runtime.createMemory).toHaveBeenCalled();
  });

  it("recovers from AGENT_EXISTS by returning the existing registration from memory", async () => {
    const regMemory = makeRegistrationMemory();
    const service = makeService({
      requestRegistrationChallenge: vi.fn().mockResolvedValue({
        data: { challenge: "sign-me", nonce: "nonce456", expiresAt: Date.now() + 60_000 },
      }),
      completeRegistration: vi.fn().mockRejectedValue(
        new XyncPayApiError("AGENT_EXISTS", 409, "Agent already registered"),
      ),
    });
    const runtime = makeRuntime(
      VALID_SETTINGS,
      { xyncpay_registration: [regMemory] },
      service,
    );

    const result = await registerAgentAction.handler(runtime, makeMessage()) as ActionResult;
    expect(result.success).toBe(true);
    expect(result.text).toContain(TEST_XYNC_ID);
  });

  it("returns an error when AGENT_EXISTS but no local registration found", async () => {
    const service = makeService({
      requestRegistrationChallenge: vi.fn().mockResolvedValue({
        data: { challenge: "sign-me", nonce: "nonce789", expiresAt: Date.now() + 60_000 },
      }),
      completeRegistration: vi.fn().mockRejectedValue(
        new XyncPayApiError("AGENT_EXISTS", 409, "Agent already registered"),
      ),
    });
    const runtime = makeRuntime(VALID_SETTINGS, {}, service);

    const result = await registerAgentAction.handler(runtime, makeMessage()) as ActionResult;
    expect(result.success).toBe(false);
    expect(result.error).toContain("xyncId");
  });

  it("returns an error when the service is not available", async () => {
    const runtime = makeRuntime(VALID_SETTINGS, {}, null);
    const result = await registerAgentAction.handler(runtime, makeMessage()) as ActionResult;
    expect(result.success).toBe(false);
    expect(result.error).toContain("XyncPayService not available");
  });
});
