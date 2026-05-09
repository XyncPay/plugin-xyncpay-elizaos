// Environment configuration for plugin-xyncpay-elizaos. Reads, validates, and types the nine
// settings the plugin requires. Uses Zod for runtime validation. Throws on missing required values.

import { z } from "zod";
import type { IAgentRuntime } from "@elizaos/core";

export const xyncpayConfigSchema = z.object({
  apiUrl: z.string().url().default("https://www.xyncpay.com"),
  walletPrivateKey: z
    .string()
    .regex(/^0x[0-9a-fA-F]{64}$/, "Must be a 64-char hex string prefixed with 0x"),
  preferredChain: z.enum(["base", "solana"]).default("base"),
  agentName: z.string().min(1).max(64),
  baseRpcUrl: z.string().url().default("https://mainnet.base.org"),
  spendingCap: z
    .string({
      required_error:
        "XYNCPAY_SPENDING_CAP is required; set it to a numeric string (e.g. 100)",
    })
    .regex(/^\d+(\.\d+)?$/, "XYNCPAY_SPENDING_CAP must be a numeric string (e.g. 100)"),
  perTransactionLimit: z
    .string({
      required_error:
        "XYNCPAY_PER_TRANSACTION_LIMIT is required; set it to a numeric string (e.g. 10)",
    })
    .regex(
      /^\d+(\.\d+)?$/,
      "XYNCPAY_PER_TRANSACTION_LIMIT must be a numeric string (e.g. 10)"
    ),
  rateLimit: z.coerce
    .number({
      invalid_type_error: "XYNCPAY_RATE_LIMIT must be a positive integer (e.g. 60)",
    })
    .int("XYNCPAY_RATE_LIMIT must be a positive integer")
    .positive("XYNCPAY_RATE_LIMIT must be a positive integer"),
  sessionExpiresInSeconds: z.coerce
    .number({
      invalid_type_error:
        "XYNCPAY_SESSION_EXPIRES_IN must be a positive integer (e.g. 86400)",
    })
    .int("XYNCPAY_SESSION_EXPIRES_IN must be a positive integer")
    .positive("XYNCPAY_SESSION_EXPIRES_IN must be a positive integer"),
});

export type XyncPayConfigInput = z.infer<typeof xyncpayConfigSchema>;

function formatZodError(err: z.ZodError): string {
  const issues = err.errors.map((issue) => {
    const field = issue.path.length > 0 ? issue.path.join(".") : "unknown";
    return `${field}: ${issue.message}`;
  });
  return `XyncPay plugin configuration error. Invalid or missing fields: ${issues.join("; ")}`;
}

export function getConfig(runtime: IAgentRuntime): XyncPayConfigInput {
  const raw = {
    apiUrl: runtime.getSetting("XYNCPAY_API_URL") ?? undefined,
    walletPrivateKey: runtime.getSetting("WALLET_PRIVATE_KEY") ?? undefined,
    preferredChain: runtime.getSetting("XYNCPAY_PREFERRED_CHAIN") ?? undefined,
    agentName: runtime.getSetting("XYNCPAY_AGENT_NAME") ?? runtime.character.name,
    baseRpcUrl: runtime.getSetting("BASE_RPC_URL") ?? undefined,
    spendingCap: runtime.getSetting("XYNCPAY_SPENDING_CAP") ?? undefined,
    perTransactionLimit: runtime.getSetting("XYNCPAY_PER_TRANSACTION_LIMIT") ?? undefined,
    rateLimit: runtime.getSetting("XYNCPAY_RATE_LIMIT") ?? undefined,
    sessionExpiresInSeconds: runtime.getSetting("XYNCPAY_SESSION_EXPIRES_IN") ?? undefined,
  };

  try {
    return xyncpayConfigSchema.parse(raw);
  } catch (err) {
    if (err instanceof z.ZodError) {
      throw new Error(formatZodError(err));
    }
    throw err;
  }
}

export function validateConfig(input: unknown): XyncPayConfigInput {
  try {
    return xyncpayConfigSchema.parse(input);
  } catch (err) {
    if (err instanceof z.ZodError) {
      throw new Error(formatZodError(err));
    }
    throw err;
  }
}
