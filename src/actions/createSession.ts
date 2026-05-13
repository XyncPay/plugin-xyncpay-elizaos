// Action: XYNCPAY_CREATE_SESSION. Opens a spending session for a registered XyncPay agent.
// Reads the stored xyncId from Memory written by XYNCPAY_REGISTER_AGENT and submits a
// signed session-creation request. The full session response is persisted under the
// xyncpay_session table so subsequent actions can read every session field.

import type {
  Action,
  IAgentRuntime,
  Memory,
  State,
  HandlerCallback,
  HandlerOptions,
  ActionResult,
  UUID,
} from "@elizaos/core";
import { XyncPayService } from "../services/xyncpayService";
import { getConfig } from "../environment";
import type { StoredAgentRegistration, XyncId } from "../types";

const REGISTRATION_TABLE = "xyncpay_registration";
const SESSION_TABLE = "xyncpay_session";

async function findStoredXyncId(
  runtime: IAgentRuntime,
  roomId: UUID,
  walletAddress: string
): Promise<XyncId | null> {
  try {
    const memories = await runtime.getMemories({
      tableName: REGISTRATION_TABLE,
      roomId,
      agentId: runtime.agentId,
      count: 10,
    });
    for (const mem of memories) {
      // Content has [key: string]: unknown index signature; we stored StoredAgentRegistration
      // fields directly in content. The double cast through unknown is required because
      // TypeScript cannot verify the shape at compile time.
      const stored = mem.content as unknown as StoredAgentRegistration;
      if (stored.walletAddress === walletAddress) {
        return stored.xyncId;
      }
    }
  } catch {
    // Memory lookup failure is non-fatal; caller handles null return
  }
  return null;
}

export const createSessionAction: Action = {
  name: "XYNCPAY_CREATE_SESSION",
  similes: [
    "CREATE_XYNCPAY_SESSION",
    "START_PAYMENT_SESSION",
    "OPEN_SPENDING_SESSION",
    "INITIALIZE_XYNCPAY_SESSION",
  ],
  description:
    "Open a spending session for the registered XyncPay agent with configurable limits on per-transaction amount, total spend cap, and session duration.",

  validate: async (runtime: IAgentRuntime, message: Memory, _state?: State): Promise<boolean> => {
    const service = runtime.getService<XyncPayService>("xyncpay");
    if (!service) return false;
    try {
      const xyncId = await findStoredXyncId(
        runtime,
        message.roomId,
        service.client.walletAddress,
      );
      return xyncId !== null;
    } catch {
      return false;
    }
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
    _options?: HandlerOptions,
    callback?: HandlerCallback,
    _responses?: Memory[]
  ): Promise<ActionResult> => {
    try {
      const service = runtime.getService<XyncPayService>("xyncpay");
      if (!service) {
        const errMsg = "XyncPayService not available. Plugin initialization may have failed.";
        if (callback) await callback({ text: errMsg });
        return { success: false, error: errMsg };
      }
      const client = service.client;
      const config = getConfig(runtime);

      const xyncId = await findStoredXyncId(runtime, message.roomId, client.walletAddress);
      if (!xyncId) {
        const errMsg =
          "No XyncPay registration found. Run XYNCPAY_REGISTER_AGENT before creating a session.";
        if (callback) {
          await callback({ text: errMsg });
        }
        return { success: false, error: errMsg };
      }

      const response = await client.createSession({
        agentId: xyncId,
        spendingCap: config.spendingCap,
        perTransactionLimit: config.perTransactionLimit,
        rateLimit: config.rateLimit,
        allowedChains: [config.preferredChain],
        allowedCurrencies: ["USDC"],
        expiresInSeconds: config.sessionExpiresInSeconds,
      });

      await runtime.createMemory(
        {
          id: crypto.randomUUID() as UUID,
          entityId: runtime.agentId,
          agentId: runtime.agentId,
          roomId: message.roomId,
          // Content has [key: string]: unknown so CreateSessionResponse data fields are
          // compatible. The cast through unknown is needed because TypeScript sees
          // Content's named optional fields and cannot confirm the shape without it.
          content: response.data as unknown as { [key: string]: unknown },
          createdAt: Date.now(),
        },
        SESSION_TABLE
      );

      const confirmMsg = `Session created. sessionId: ${response.data.sessionId}`;
      if (callback) {
        await callback({ text: confirmMsg });
      }

      return {
        success: true,
        text: confirmMsg,
        data: response.data as unknown as Record<string, unknown>,
      };
    } catch (err) {
      const errMsg =
        err instanceof Error ? err.message : "Unknown error during session creation";
      if (callback) {
        await callback({ text: errMsg });
      }
      return { success: false, error: errMsg };
    }
  },

  examples: [
    [
      {
        name: "{{user}}",
        content: { text: "Create a payment session so I can start transacting" },
      },
      {
        name: "{{agent}}",
        content: {
          text: "Creating a XyncPay spending session for your agent now.",
          actions: ["XYNCPAY_CREATE_SESSION"],
        },
      },
    ],
    [
      {
        name: "{{user}}",
        content: { text: "Open a XyncPay session with a 50 USDC cap" },
      },
      {
        name: "{{agent}}",
        content: {
          text: "Opening a new XyncPay spending session.",
          actions: ["XYNCPAY_CREATE_SESSION"],
        },
      },
    ],
  ],
};
