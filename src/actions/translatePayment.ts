// Action: XYNCPAY_TRANSLATE_PAYMENT. Extracts payment parameters from the user message,
// translates them to a chain-ready unsigned transaction via XyncPay, and persists the
// resulting payment to Memory for XYNCPAY_CONFIRM_PAYMENT to consume.

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
import { ModelType, elizaLogger } from "@elizaos/core";
import { z } from "zod";
import { XyncPayService } from "../services/xyncpayService";
import { getConfig } from "../environment";
import type { CreateSessionResponse, SupportedCurrency } from "../types";

const SESSION_TABLE = "xyncpay_session";
const PAYMENT_TABLE = "xyncpay_payment";

// Local alias for the full session data shape stored by XYNCPAY_CREATE_SESSION.
type StoredSessionData = CreateSessionResponse["data"];

const TranslatePaymentSchema = z.object({
  recipient: z.string().min(1),
  amount: z.string().regex(/^\d+(\.\d+)?$/),
  currency: z.string().min(1),
  memo: z.string().optional(),
});

// Plain JSON schema passed to ModelType.OBJECT_SMALL for structured output guidance.
// Mirrors TranslatePaymentSchema without the Zod runtime validators.
const paymentExtractionJsonSchema = {
  type: "object",
  properties: {
    recipient: { type: "string" },
    amount: { type: "string" },
    currency: { type: "string" },
    memo: { type: "string" },
  },
  required: ["recipient", "amount", "currency"],
};

// composeContext does not exist in @elizaos/core 1.7.0. {{recentMessages}} is replaced
// with state.text (the conversation context string produced by runtime.composeState)
// before the model call.
const extractionTemplate = `{{recentMessages}}

Extract the payment details from the most recent user message above. Return a JSON object with these exact fields:
- recipient: the wallet address or identifier of the payment recipient (required)
- amount: the payment amount as a numeric string such as "10" or "10.50" (required)
- currency: the payment currency such as "USDC" (required)
- memo: a short optional note or description; return null if none is mentioned

Return only the JSON object, no explanation, no markdown.`;

async function findActiveSession(
  runtime: IAgentRuntime,
  roomId: UUID
): Promise<StoredSessionData | null> {
  try {
    const memories = await runtime.getMemories({
      tableName: SESSION_TABLE,
      roomId,
      agentId: runtime.agentId,
      count: 20,
    });
    const now = Date.now();
    for (const mem of memories) {
      // Content has [key: string]: unknown index signature; XYNCPAY_CREATE_SESSION stored
      // the full CreateSessionResponse.data object here via the same cast pattern.
      const session = mem.content as unknown as StoredSessionData;
      if (typeof session.expiresAt === "number" && session.expiresAt > now) {
        return session;
      }
    }
  } catch {
    // Memory lookup failure is non-fatal; caller handles null return
  }
  return null;
}

export const translatePaymentAction: Action = {
  name: "XYNCPAY_TRANSLATE_PAYMENT",
  similes: [
    "SEND_PAYMENT",
    "TRANSLATE_PAYMENT",
    "TRANSFER_USDC",
    "PAY_WITH_XYNCPAY",
    "MAKE_XYNCPAY_PAYMENT",
  ],
  description:
    "Extract recipient, amount, currency, and optional memo from the user message, translate them into a chain-ready unsigned transaction via XyncPay, and return the paymentId for downstream confirmation.",

  validate: async (runtime: IAgentRuntime, _message: Memory, _state?: State): Promise<boolean> => {
    return runtime.getService<XyncPayService>("xyncpay") !== null;
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state?: State,
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

      const session = await findActiveSession(runtime, message.roomId);
      if (!session) {
        const errMsg =
          "No active XyncPay session. Run XYNCPAY_CREATE_SESSION first.";
        if (callback) {
          await callback({ text: errMsg });
        }
        return { success: false, error: errMsg };
      }

      // updateRecentMessageState does not exist in @elizaos/core 1.7.0.
      // Use the passed-in state when available; compose fresh state otherwise.
      const composedState = state ?? (await runtime.composeState(message));
      const prompt = extractionTemplate.replace("{{recentMessages}}", composedState.text);

      const raw = await runtime.useModel(ModelType.OBJECT_SMALL, {
        prompt,
        schema: paymentExtractionJsonSchema,
        output: "object",
      });

      // Normalize null memo to undefined so z.string().optional() accepts it.
      const rawNormalized = { ...raw, ...(raw.memo === null ? { memo: undefined } : {}) };
      const parsed = TranslatePaymentSchema.safeParse(rawNormalized);

      if (!parsed.success) {
        const errMsg =
          "Could not extract payment details from the message. " +
          "Please specify a recipient, amount, and currency.";
        if (callback) {
          await callback({ text: errMsg });
        }
        return { success: false, error: errMsg };
      }

      const extracted = parsed.data;

      if (!extracted.recipient) {
        const errMsg = "Missing required field: recipient.";
        if (callback) await callback({ text: errMsg });
        return { success: false, error: errMsg };
      }
      if (!extracted.amount) {
        const errMsg = "Missing required field: amount.";
        if (callback) await callback({ text: errMsg });
        return { success: false, error: errMsg };
      }
      if (!extracted.currency) {
        const errMsg = "Missing required field: currency.";
        if (callback) await callback({ text: errMsg });
        return { success: false, error: errMsg };
      }

      if (!session.allowedCurrencies.includes(extracted.currency)) {
        const errMsg =
          `Currency ${extracted.currency} is not allowed in the active session. ` +
          `Allowed: ${session.allowedCurrencies.join(", ")}.`;
        if (callback) {
          await callback({ text: errMsg });
        }
        return { success: false, error: errMsg };
      }

      elizaLogger.debug(
        { recipient: extracted.recipient, amount: extracted.amount, currency: extracted.currency },
        "XYNCPAY_TRANSLATE_PAYMENT: extracted payment fields"
      );

      const response = await client.translatePayment({
        sourceProtocol: "x402",
        targetProtocol: "x402",
        payeeAddress: extracted.recipient,
        amount: extracted.amount,
        currency: extracted.currency as SupportedCurrency,
        chain: config.preferredChain,
        sessionId: session.sessionId,
        memo: extracted.memo,
      });

      await runtime.createMemory(
        {
          id: crypto.randomUUID() as UUID,
          entityId: runtime.agentId,
          agentId: runtime.agentId,
          roomId: message.roomId,
          // Content has [key: string]: unknown so TranslatePaymentResponse data fields are
          // compatible. The cast through unknown is needed because TypeScript sees
          // Content's named optional fields and cannot confirm the shape without it.
          content: response.data as unknown as { [key: string]: unknown },
          createdAt: Date.now(),
        },
        PAYMENT_TABLE
      );

      const confirmMsg =
        `Payment translated. paymentId: ${response.data.paymentId}. ` +
        "Sign and broadcast the unsigned transaction, then call XYNCPAY_CONFIRM_PAYMENT with the txHash.";
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
        err instanceof Error ? err.message : "Unknown error during payment translation";
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
        content: {
          text: "Send 10 USDC to 0xAbC1234567890AbC1234567890AbC1234567890Ab",
        },
      },
      {
        name: "{{agent}}",
        content: {
          text: "Translating the payment to an unsigned transaction now.",
          actions: ["XYNCPAY_TRANSLATE_PAYMENT"],
        },
      },
    ],
    [
      {
        name: "{{user}}",
        content: { text: "Pay alice.eth 5.50 USDC for the design work" },
      },
      {
        name: "{{agent}}",
        content: {
          text: "Preparing the XyncPay payment for alice.eth.",
          actions: ["XYNCPAY_TRANSLATE_PAYMENT"],
        },
      },
    ],
    [
      {
        name: "{{user}}",
        content: {
          text: "Transfer 0.01 USDC to 0xDeF9876543210DeF9876543210DeF9876543210De",
        },
      },
      {
        name: "{{agent}}",
        content: {
          text: "Translating the transfer request via XyncPay.",
          actions: ["XYNCPAY_TRANSLATE_PAYMENT"],
        },
      },
    ],
  ],
};
