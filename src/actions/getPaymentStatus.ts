// Action: XYNCPAY_GET_PAYMENT_STATUS. Queries the XyncPay API for the status of a payment.
// Extracts the paymentId from the user message via the runtime LLM. If no paymentId is found
// in the message, falls back to the most recent payment in Memory. Returns status, txHash, and
// block number when available.

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
import type { StoredPayment } from "../types";

// Detects whether the message text mentions a paymentId. Production API
// returns UUIDs (e.g. "c6966234-0533-49f0-991a-1cd2bb77a1af"), but legacy
// xyn_pay_ format is also accepted for backward compatibility.
function messageMentionsPaymentId(message: Memory): boolean {
  const text = message.content?.text;
  if (typeof text !== "string") return false;
  // UUID v4 format: 8-4-4-4-12 hex digits
  if (/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(text)) {
    return true;
  }
  // Legacy xyn_pay_ format
  return /xyn_pay_[a-zA-Z0-9_-]+/i.test(text);
}

const PAYMENT_TABLE = "xyncpay_payment";
const STATUS_TABLE = "xyncpay_status_query";

const PaymentIdExtractionSchema = z.object({
  paymentId: z.string().optional(),
});

// Plain JSON schema passed to ModelType.OBJECT_SMALL for structured output guidance.
const paymentIdJsonSchema = {
  type: "object",
  properties: {
    paymentId: { type: "string" },
  },
  required: [],
};

// composeContext does not exist in @elizaos/core 1.7.0. {{recentMessages}} is replaced
// with state.text (the conversation context string produced by runtime.composeState)
// before the model call.
const extractionTemplate = `{{recentMessages}}

If the most recent user message above explicitly mentions a XyncPay paymentId (typically a string starting with xyn_pay_ or similar), extract it. If no paymentId is mentioned in the message, return null for paymentId. Return only the JSON object, no explanation, no markdown.`;

async function findMostRecentPayment(
  runtime: IAgentRuntime,
  roomId: UUID
): Promise<StoredPayment | null> {
  try {
    const memories = await runtime.getMemories({
      tableName: PAYMENT_TABLE,
      roomId,
      agentId: runtime.agentId,
      count: 20,
    });
    if (memories.length === 0) return null;
    // Sort by createdAt descending; getMemories does not guarantee order across
    // database adapters.
    const sorted = [...memories].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
    return sorted[0].content as unknown as StoredPayment;
  } catch {
    return null;
  }
}

export const getPaymentStatusAction: Action = {
  name: "XYNCPAY_GET_PAYMENT_STATUS",
  similes: [
    "GET_PAYMENT_STATUS",
    "CHECK_PAYMENT",
    "PAYMENT_STATUS",
    "VERIFY_PAYMENT",
    "QUERY_XYNCPAY_PAYMENT",
  ],
  description:
    "Query the status of a XyncPay payment by paymentId extracted from the user message, or fall back to the most recent payment in Memory if no paymentId is mentioned.",

  validate: async (runtime: IAgentRuntime, message: Memory, _state?: State): Promise<boolean> => {
    const service = runtime.getService<XyncPayService>("xyncpay");
    if (!service) return false;
    try {
      if (messageMentionsPaymentId(message)) return true;
      const payment = await findMostRecentPayment(runtime, message.roomId);
      return payment !== null;
    } catch {
      return false;
    }
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

      // Extract paymentId in priority order:
      //   1. message.content.paymentId (explicit param, works in any runtime)
      //   2. runtime.useModel LLM extraction (skipped if useModel unavailable)
      //   3. most recent payment in Memory (final fallback)
      let paymentIdToQuery: string | undefined;
      let extractionMode: "explicit" | "llm" | "memory" | "none" = "none";

      // Mode 1: explicit param from message content. The content.paymentId field
      // can be any unknown type, so verify it's a non-empty string.
      const explicitPaymentId = message.content?.paymentId;
      if (typeof explicitPaymentId === "string" && explicitPaymentId.length > 0) {
        paymentIdToQuery = explicitPaymentId;
        extractionMode = "explicit";
      }

      // Mode 2: LLM extraction. Only attempt if runtime.useModel is available
      // (full ElizaOS runtimes); skip silently in OpenClaw and other runtimes
      // that don't ship an LLM hook.
      if (!paymentIdToQuery && typeof runtime.useModel === "function") {
        try {
          const composedState = state ?? (await runtime.composeState(message));
          const prompt = extractionTemplate.replace("{{recentMessages}}", composedState.text);

          const raw = await runtime.useModel(ModelType.OBJECT_SMALL, {
            prompt,
            schema: paymentIdJsonSchema,
            output: "object",
          });

          // Normalize null paymentId to undefined so z.string().optional() accepts it.
          const rawNormalized = {
            ...raw,
            ...(raw.paymentId === null ? { paymentId: undefined } : {}),
          };
          const parsed = PaymentIdExtractionSchema.safeParse(rawNormalized);
          if (parsed.success && parsed.data.paymentId) {
            paymentIdToQuery = parsed.data.paymentId;
            extractionMode = "llm";
          }
        } catch (llmErr) {
          // Silently fall through to memory lookup. LLM extraction is best-effort.
          elizaLogger.debug(
            { error: llmErr instanceof Error ? llmErr.message : String(llmErr) },
            "XYNCPAY_GET_PAYMENT_STATUS: LLM extraction failed, falling back to memory"
          );
        }
      }

      // Mode 3: most recent payment in Memory.
      if (!paymentIdToQuery) {
        const recent = await findMostRecentPayment(runtime, message.roomId);
        if (recent?.paymentId) {
          paymentIdToQuery = recent.paymentId;
          extractionMode = "memory";
        }
      }

      if (!paymentIdToQuery) {
        const errMsg =
          "No paymentId found. Pass it as message.content.paymentId, include it in " +
          "message text, or run XYNCPAY_TRANSLATE_PAYMENT first.";
        if (callback) await callback({ text: errMsg });
        return { success: false, error: errMsg };
      }

      elizaLogger.debug(
        {
          paymentId: paymentIdToQuery,
          mode: extractionMode,
        },
        "XYNCPAY_GET_PAYMENT_STATUS: querying payment"
      );

      const response = await client.getPaymentStatus(paymentIdToQuery);

      await runtime.createMemory(
        {
          id: crypto.randomUUID() as UUID,
          entityId: runtime.agentId,
          agentId: runtime.agentId,
          roomId: message.roomId,
          // Content has [key: string]: unknown so GetPaymentStatusResponse data fields are
          // compatible. The cast through unknown is needed because TypeScript sees
          // Content's named optional fields and cannot confirm the shape without it.
          content: response.data as unknown as { [key: string]: unknown },
          createdAt: Date.now(),
        },
        STATUS_TABLE
      );

      const settlement = response.data.settlement;
      let statusMsg = `Payment ${response.data.id}: status ${settlement.status}.`;
      if (settlement.txHash) {
        statusMsg += ` txHash: ${settlement.txHash}.`;
      }
      if (settlement.blockNumber !== undefined) {
        statusMsg += ` Included at block ${settlement.blockNumber}.`;
      }

      if (callback) await callback({ text: statusMsg });

      return {
        success: true,
        text: statusMsg,
        data: response.data as unknown as Record<string, unknown>,
      };
    } catch (err) {
      const errMsg =
        err instanceof Error ? err.message : "Unknown error querying payment status";
      if (callback) await callback({ text: errMsg });
      return { success: false, error: errMsg };
    }
  },

  examples: [
    [
      {
        name: "{{user}}",
        content: { text: "What is the status of my payment?" },
      },
      {
        name: "{{agent}}",
        content: {
          text: "Checking the status of your most recent XyncPay payment.",
          actions: ["XYNCPAY_GET_PAYMENT_STATUS"],
        },
      },
    ],
    [
      {
        name: "{{user}}",
        content: { text: "Check on payment xyn_pay_abc123def456" },
      },
      {
        name: "{{agent}}",
        content: {
          text: "Querying XyncPay for the status of payment xyn_pay_abc123def456.",
          actions: ["XYNCPAY_GET_PAYMENT_STATUS"],
        },
      },
    ],
    [
      {
        name: "{{user}}",
        content: { text: "Did the payment to alice go through?" },
      },
      {
        name: "{{agent}}",
        content: {
          text: "Looking up the status of your most recent XyncPay payment.",
          actions: ["XYNCPAY_GET_PAYMENT_STATUS"],
        },
      },
    ],
  ],
};
