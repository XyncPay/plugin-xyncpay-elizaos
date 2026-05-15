import { describe, it, expect } from "vitest";
import { XyncPayService } from "../../services/xyncpayService";
import { makeRuntime, TEST_WALLET_ADDRESS, VALID_SETTINGS } from "../test-utils";

describe("XyncPayService", () => {
  it("has serviceType 'xyncpay'", () => {
    expect(XyncPayService.serviceType).toBe("xyncpay");
  });

  it("start() creates a service with a client bound to the configured wallet", async () => {
    const runtime = makeRuntime(VALID_SETTINGS);
    const service = await XyncPayService.start(runtime);
    expect(service).toBeInstanceOf(XyncPayService);
    expect(service.client).toBeDefined();
    expect(service.client.walletAddress).toBe(TEST_WALLET_ADDRESS);
  });

  it("stop() resolves without error", async () => {
    const runtime = makeRuntime(VALID_SETTINGS);
    const service = await XyncPayService.start(runtime);
    await expect(service.stop()).resolves.toBeUndefined();
  });

  it("start() throws when WALLET_PRIVATE_KEY is missing", async () => {
    const settings = { ...VALID_SETTINGS };
    delete settings["WALLET_PRIVATE_KEY"];
    const runtime = makeRuntime(settings);
    await expect(XyncPayService.start(runtime)).rejects.toThrow("XyncPay plugin configuration error");
  });
});
