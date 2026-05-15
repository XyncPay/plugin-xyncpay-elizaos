import type { IAgentRuntime, Memory, State, UUID } from "@elizaos/core";
import { vi } from "vitest";
import type { PaymentId, SessionId, SettlementId, XyncId } from "../types";

export const TEST_PRIVATE_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
export const TEST_WALLET_ADDRESS = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
export const TEST_ROOM_ID = "00000000-0000-0000-0000-000000000001" as UUID;
export const TEST_AGENT_ID = "00000000-0000-0000-0000-000000000002" as UUID;
export const TEST_XYNC_ID = "xync_tst_0001" as XyncId;
export const TEST_SESSION_ID = "sess_tst_0001" as SessionId;
export const TEST_PAYMENT_ID = "xyn_pay_tst_0001" as PaymentId;
export const TEST_SETTLEMENT_ID = "settle_tst_0001" as SettlementId;

export const VALID_SETTINGS: Record<string, string> = {
  WALLET_PRIVATE_KEY: TEST_PRIVATE_KEY,
  XYNCPAY_AGENT_NAME: "TestAgent",
  XYNCPAY_SPENDING_CAP: "100",
  XYNCPAY_PER_TRANSACTION_LIMIT: "10",
  XYNCPAY_RATE_LIMIT: "60",
  XYNCPAY_SESSION_EXPIRES_IN: "86400",
};

export function makeRuntime(
  settings: Record<string, string> = VALID_SETTINGS,
  memories: Record<string, Memory[]> = {},
  service: unknown = null,
  modelFn?: () => Promise<unknown>,
): IAgentRuntime {
  return {
    agentId: TEST_AGENT_ID,
    character: { name: "TestAgent" },
    getSetting: vi.fn((key: string) => settings[key] ?? null),
    getMemories: vi.fn(({ tableName }: { tableName: string }) =>
      Promise.resolve(memories[tableName] ?? [])
    ),
    createMemory: vi.fn(() => Promise.resolve()),
    composeState: vi.fn(() =>
      Promise.resolve({ text: "recent messages context", values: {}, data: {} } as unknown as State)
    ),
    useModel: vi.fn(modelFn ?? (() => Promise.resolve({}))),
    getService: vi.fn(() => service),
  } as unknown as IAgentRuntime;
}

export function makeMessage(content: Record<string, unknown> = { text: "test message" }): Memory {
  return {
    id: "00000000-0000-0000-0000-000000000010" as UUID,
    entityId: TEST_AGENT_ID,
    agentId: TEST_AGENT_ID,
    roomId: TEST_ROOM_ID,
    content,
    createdAt: Date.now(),
  } as Memory;
}

export function makeRegistrationMemory(): Memory {
  return {
    id: "00000000-0000-0000-0000-000000000020" as UUID,
    entityId: TEST_AGENT_ID,
    agentId: TEST_AGENT_ID,
    roomId: TEST_ROOM_ID,
    content: {
      xyncId: TEST_XYNC_ID,
      walletAddress: TEST_WALLET_ADDRESS,
      preferredChain: "base",
      registeredAt: Date.now(),
    } as unknown as { [key: string]: unknown },
    createdAt: Date.now(),
  } as Memory;
}

export function makeSessionMemory(expiresAt: number = Date.now() + 3_600_000): Memory {
  return {
    id: "00000000-0000-0000-0000-000000000030" as UUID,
    entityId: TEST_AGENT_ID,
    agentId: TEST_AGENT_ID,
    roomId: TEST_ROOM_ID,
    content: {
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
      expiresAt,
    } as unknown as { [key: string]: unknown },
    createdAt: Date.now(),
  } as Memory;
}

export function makePaymentMemory(): Memory {
  return {
    id: "00000000-0000-0000-0000-000000000040" as UUID,
    entityId: TEST_AGENT_ID,
    agentId: TEST_AGENT_ID,
    roomId: TEST_ROOM_ID,
    content: {
      paymentId: TEST_PAYMENT_ID,
      settlementId: TEST_SETTLEMENT_ID,
      unsignedTransaction: {
        chainId: 8453,
        to: "0xRecipientAddr0000000000000000000000000000",
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
      createdAt: Date.now(),
    } as unknown as { [key: string]: unknown },
    createdAt: Date.now(),
  } as Memory;
}

export function makeClient(overrides: Record<string, unknown> = {}) {
  return {
    walletAddress: TEST_WALLET_ADDRESS,
    requestRegistrationChallenge: vi.fn(),
    completeRegistration: vi.fn(),
    createSession: vi.fn(),
    translatePayment: vi.fn(),
    getPaymentStatus: vi.fn(),
    confirmPayment: vi.fn(),
    ...overrides,
  };
}

export function makeService(clientOverrides: Record<string, unknown> = {}) {
  return { client: makeClient(clientOverrides) };
}
