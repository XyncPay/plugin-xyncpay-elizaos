import { describe, it, expect } from "vitest";
import { getConfig, validateConfig } from "../environment";
import {
  makeRuntime,
  VALID_SETTINGS,
  TEST_PRIVATE_KEY,
} from "./test-utils";

const MIN_VALID_INPUT = {
  walletPrivateKey: TEST_PRIVATE_KEY,
  agentName: "TestAgent",
  spendingCap: "100",
  perTransactionLimit: "10",
  rateLimit: "60",
  sessionExpiresInSeconds: "86400",
};

describe("validateConfig", () => {
  it("parses a valid config and returns typed output", () => {
    const config = validateConfig(MIN_VALID_INPUT);
    expect(config.agentName).toBe("TestAgent");
    expect(config.walletPrivateKey).toBe(TEST_PRIVATE_KEY);
    expect(config.preferredChain).toBe("base");
    expect(config.rateLimit).toBe(60);
    expect(config.sessionExpiresInSeconds).toBe(86400);
  });

  it("applies defaults for optional fields", () => {
    const config = validateConfig(MIN_VALID_INPUT);
    expect(config.apiUrl).toBe("https://www.xyncpay.com");
    expect(config.preferredChain).toBe("base");
    expect(config.baseRpcUrl).toBe("https://mainnet.base.org");
  });

  it("accepts an explicit apiUrl override", () => {
    const config = validateConfig({ ...MIN_VALID_INPUT, apiUrl: "https://staging.xyncpay.com" });
    expect(config.apiUrl).toBe("https://staging.xyncpay.com");
  });

  it("converts spendingCap '100' to smallest unit '100000000'", () => {
    const config = validateConfig({ ...MIN_VALID_INPUT, spendingCap: "100" });
    expect(config.spendingCap).toBe("100000000");
  });

  it("converts spendingCap '10.5' to smallest unit '10500000'", () => {
    const config = validateConfig({ ...MIN_VALID_INPUT, spendingCap: "10.5" });
    expect(config.spendingCap).toBe("10500000");
  });

  it("converts spendingCap '0.000001' to smallest unit '1'", () => {
    const config = validateConfig({ ...MIN_VALID_INPUT, spendingCap: "0.000001" });
    expect(config.spendingCap).toBe("1");
  });

  it("converts perTransactionLimit '10' to smallest unit '10000000'", () => {
    const config = validateConfig({ ...MIN_VALID_INPUT, perTransactionLimit: "10" });
    expect(config.perTransactionLimit).toBe("10000000");
  });

  it("converts perTransactionLimit '1.000001' to '1000001'", () => {
    const config = validateConfig({ ...MIN_VALID_INPUT, perTransactionLimit: "1.000001" });
    expect(config.perTransactionLimit).toBe("1000001");
  });

  it("throws when walletPrivateKey is missing", () => {
    const input = { ...MIN_VALID_INPUT };
    delete (input as Partial<typeof MIN_VALID_INPUT>).walletPrivateKey;
    expect(() => validateConfig(input)).toThrow("XyncPay plugin configuration error");
  });

  it("throws when walletPrivateKey has wrong format", () => {
    expect(() =>
      validateConfig({ ...MIN_VALID_INPUT, walletPrivateKey: "not-a-hex-key" })
    ).toThrow("XyncPay plugin configuration error");
  });

  it("throws when spendingCap has more than 6 decimal places", () => {
    expect(() =>
      validateConfig({ ...MIN_VALID_INPUT, spendingCap: "1.0000001" })
    ).toThrow("XyncPay plugin configuration error");
  });

  it("throws when rateLimit is not a positive integer", () => {
    expect(() =>
      validateConfig({ ...MIN_VALID_INPUT, rateLimit: "-5" })
    ).toThrow("XyncPay plugin configuration error");
  });

  it("coerces rateLimit string '60' to number 60", () => {
    const config = validateConfig({ ...MIN_VALID_INPUT, rateLimit: "60" });
    expect(typeof config.rateLimit).toBe("number");
    expect(config.rateLimit).toBe(60);
  });

  it("coerces sessionExpiresInSeconds string '86400' to number 86400", () => {
    const config = validateConfig({ ...MIN_VALID_INPUT, sessionExpiresInSeconds: "86400" });
    expect(typeof config.sessionExpiresInSeconds).toBe("number");
    expect(config.sessionExpiresInSeconds).toBe(86400);
  });
});

describe("getConfig", () => {
  it("reads settings from runtime and returns valid config", () => {
    const runtime = makeRuntime(VALID_SETTINGS);
    const config = getConfig(runtime);
    expect(config.agentName).toBe("TestAgent");
    expect(config.walletPrivateKey).toBe(TEST_PRIVATE_KEY);
    expect(config.preferredChain).toBe("base");
    expect(config.rateLimit).toBe(60);
    expect(config.sessionExpiresInSeconds).toBe(86400);
    expect(config.spendingCap).toBe("100000000");
    expect(config.perTransactionLimit).toBe("10000000");
  });

  it("falls back to character.name when XYNCPAY_AGENT_NAME is not set", () => {
    const settings = { ...VALID_SETTINGS };
    delete settings["XYNCPAY_AGENT_NAME"];
    const runtime = makeRuntime(settings);
    const config = getConfig(runtime);
    expect(config.agentName).toBe("TestAgent");
  });

  it("throws a descriptive error when walletPrivateKey is missing", () => {
    const settings = { ...VALID_SETTINGS };
    delete settings["WALLET_PRIVATE_KEY"];
    const runtime = makeRuntime(settings);
    expect(() => getConfig(runtime)).toThrow("XyncPay plugin configuration error");
  });
});
