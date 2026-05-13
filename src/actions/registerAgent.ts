// Action: XYNCPAY_REGISTER_AGENT. Performs two-step challenge-response registration with XyncPay.
// Stores the resulting xyncId in agent Memory for use by subsequent actions. Idempotent: if the
// wallet is already registered (409 AGENT_EXISTS), recovers the xyncId from local Memory or
// returns an error if not found locally.

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
import { Wallet } from "ethers";
import { XyncPayApiError } from "../services/xyncpayClient";
import { XyncPayService } from "../services/xyncpayService";
import { getConfig } from "../environment";
import type { StoredAgentRegistration, XyncId } from "../types";

const REGISTRATION_TABLE = "xyncpay_registration";

async function findStoredRegistration(
  runtime: IAgentRuntime,
  roomId: UUID,
  walletAddress: string
): Promise<StoredAgentRegistration | null> {
  try {
    const memories = await runtime.getMemories({
      tableName: REGISTRATION_TABLE,
      roomId,
      agentId: runtime.agentId,
      count: 10,
    });
    for (const mem of memories) {
      // Content has [key: string]: unknown index signature; we store StoredAgentRegistration
      // fields directly in content. The double cast through unknown is required because
      // TypeScript cannot verify the shape at compile time.
      const stored = mem.content as unknown as StoredAgentRegistration;
      if (stored.walletAddress === walletAddress) {
        return stored;
      }
    }
  } catch {
    // Memory lookup failure is non-fatal; caller handles null return
  }
  return null;
}

async function persistRegistration(
  runtime: IAgentRuntime,
  roomId: UUID,
  stored: StoredAgentRegistration
): Promise<void> {
  await runtime.createMemory(
    {
      id: crypto.randomUUID() as UUID,
      entityId: runtime.agentId,
      agentId: runtime.agentId,
      roomId,
      // Content has [key: string]: unknown so StoredAgentRegistration fields are
      // compatible. The cast through unknown is needed because TypeScript sees
      // Content's named optional fields and cannot confirm the shape without it.
      content: stored as unknown as { [key: string]: unknown },
      createdAt: Date.now(),
    },
    REGISTRATION_TABLE
  );
}

export const registerAgentAction: Action = {
  name: "XYNCPAY_REGISTER_AGENT",
  similes: ["REGISTER_WITH_XYNCPAY", "SETUP_XYNCPAY_AGENT", "INITIALIZE_XYNCPAY"],
  description:
    "Register the agent with XyncPay using its wallet address. Performs a two-step challenge-response flow that proves wallet ownership without exposing the private key. Idempotent: safe to call multiple times; subsequent calls return the existing registration.",

  validate: async (runtime: IAgentRuntime, _message: Memory, _state?: State): Promise<boolean> => {
    const service = runtime.getService<XyncPayService>("xyncpay");
    return service !== null;
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
    _options?: HandlerOptions,
    _callback?: HandlerCallback,
    _responses?: Memory[]
  ): Promise<ActionResult> => {
    try {
      const service = runtime.getService<XyncPayService>("xyncpay");
      if (!service) {
        return {
          success: false,
          error: "XyncPayService not available. Plugin initialization may have failed.",
        };
      }
      const client = service.client;
      const config = getConfig(runtime);

      // Return early if already registered locally
      const existing = await findStoredRegistration(
        runtime,
        message.roomId,
        client.walletAddress
      );
      if (existing) {
        return {
          success: true,
          text: `Already registered. xyncId: ${existing.xyncId}`,
          data: { ...existing } as Record<string, unknown>,
        };
      }

      // Step 1: Request challenge (unsigned)
      const challengeResp = await client.requestRegistrationChallenge(
        client.walletAddress,
        config.preferredChain
      );
      const { challenge, nonce } = challengeResp.data;

      // Sign the challenge text string. Registration step 2 requires a signature over
      // the challenge string itself, not over a JSON request body. A separate Wallet
      // instance is created here because XyncPayClient.signedFetch signs JSON bodies
      // and that signing path is not used for registration.
      const signingWallet = new Wallet(config.walletPrivateKey);
      const signature = await signingWallet.signMessage(challenge);

      // Step 2: Complete registration (unsigned)
      let xyncId: XyncId;
      try {
        const completeResp = await client.completeRegistration({
          walletAddress: client.walletAddress,
          preferredChain: config.preferredChain,
          signature,
          nonce,
          name: config.agentName,
          supportedProtocols: ["x402", "mpp"],
          supportedChains: [config.preferredChain],
        });
        xyncId = completeResp.data.xyncId;
      } catch (stepErr) {
        if (stepErr instanceof XyncPayApiError && stepErr.code === "AGENT_EXISTS") {
          const recovered = await findStoredRegistration(
            runtime,
            message.roomId,
            client.walletAddress
          );
          if (recovered) {
            return {
              success: true,
              text: `Already registered. xyncId: ${recovered.xyncId}`,
              data: { ...recovered } as Record<string, unknown>,
            };
          }
          return {
            success: false,
            error:
              "Wallet is registered with XyncPay but local Memory has no xyncId. " +
              "Clear local state or contact support to recover the xyncId.",
          };
        }
        throw stepErr;
      }

      const stored: StoredAgentRegistration = {
        xyncId,
        walletAddress: client.walletAddress,
        preferredChain: config.preferredChain,
        registeredAt: Date.now(),
      };

      await persistRegistration(runtime, message.roomId, stored);

      return {
        success: true,
        text: `Registered with XyncPay. xyncId: ${xyncId}`,
        data: { ...stored } as Record<string, unknown>,
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : "Unknown error during registration",
      };
    }
  },

  examples: [
    [
      {
        name: "{{user}}",
        content: { text: "Register with XyncPay so I can send payments" },
      },
      {
        name: "{{agent}}",
        content: {
          text: "Registering your agent wallet with XyncPay now.",
          actions: ["XYNCPAY_REGISTER_AGENT"],
        },
      },
    ],
    [
      {
        name: "{{user}}",
        content: { text: "Set up XyncPay for this agent" },
      },
      {
        name: "{{agent}}",
        content: {
          text: "Initiating XyncPay registration.",
          actions: ["XYNCPAY_REGISTER_AGENT"],
        },
      },
    ],
  ],
};
