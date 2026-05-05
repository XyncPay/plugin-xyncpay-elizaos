// Environment configuration for plugin-xyncpay-elizaos. Reads, validates, and types the five
// settings the plugin requires. Uses Zod for runtime validation. Throws on missing required values.

import { z } from "zod";
import type { IAgentRuntime } from "@elizaos/core";
import type { XyncPayConfig } from "./types";

export const xyncpayConfigSchema = z.object({
  apiUrl: z.string().url().default("https://www.xyncpay.com"),
  walletPrivateKey: z
    .string()
    .regex(/^0x[0-9a-fA-F]{64}$/, "Must be a 64-char hex string prefixed with 0x"),
  preferredChain: z.enum(["base", "solana"]).default("base"),
  agentName: z.string().min(1).max(64),
  baseRpcUrl: z.string().url().default("https://mainnet.base.org"),
});

export type XyncPayConfigInput = z.infer<typeof xyncpayConfigSchema>;

function formatZodError(err: z.ZodError): string {
  const issues = err.errors.map((issue) => {
    const field = issue.path.length > 0 ? issue.path.join(".") : "unknown";
    return `${field}: ${issue.message}`;
  });
  return `XyncPay plugin configuration error. Invalid or missing fields: ${issues.join("; ")}`;
}

export function getConfig(runtime: IAgentRuntime): XyncPayConfig {
  const raw = {
    apiUrl: runtime.getSetting("XYNCPAY_API_URL") ?? undefined,
    walletPrivateKey: runtime.getSetting("WALLET_PRIVATE_KEY") ?? undefined,
    preferredChain: runtime.getSetting("XYNCPAY_PREFERRED_CHAIN") ?? undefined,
    agentName: runtime.getSetting("XYNCPAY_AGENT_NAME") ?? runtime.character.name,
    baseRpcUrl: runtime.getSetting("BASE_RPC_URL") ?? undefined,
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

export function validateConfig(input: unknown): XyncPayConfig {
  try {
    return xyncpayConfigSchema.parse(input);
  } catch (err) {
    if (err instanceof z.ZodError) {
      throw new Error(formatZodError(err));
    }
    throw err;
  }
}
