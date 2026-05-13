// XyncPay plugin entry point for ElizaOS.
// Exports the Plugin object that the runtime uses to register actions and services.
// Reference: https://docs.elizaos.ai/plugins/development

import type { Plugin } from "@elizaos/core";
import { logger } from "@elizaos/core";

import { XyncPayService } from "./services/xyncpayService";
import { getConfig } from "./environment";

import { registerAgentAction } from "./actions/registerAgent";
import { createSessionAction } from "./actions/createSession";
import { translatePaymentAction } from "./actions/translatePayment";
import { confirmPaymentAction } from "./actions/confirmPayment";
import { getPaymentStatusAction } from "./actions/getPaymentStatus";

export const xyncpayPlugin: Plugin = {
  name: "xyncpay",
  description:
    "XyncPay protocol translation and settlement coordination for AI agent payments. Bridges x402, MPP, and AP2 with USDC settlement on Base.",
  services: [XyncPayService],
  actions: [
    registerAgentAction,
    createSessionAction,
    translatePaymentAction,
    confirmPaymentAction,
    getPaymentStatusAction,
  ],
  init: async (_config, runtime) => {
    try {
      const config = getConfig(runtime);
      logger.info(
        `XyncPay plugin initialized: agent=${config.agentName} api=${config.apiUrl} chain=${config.preferredChain}`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      logger.error(`XyncPay plugin init failed: invalid configuration: ${message}`);
      throw err;
    }
  },
};

export default xyncpayPlugin;

// Re-export the action handlers so consumers can register subsets if needed.
export {
  registerAgentAction,
  createSessionAction,
  translatePaymentAction,
  confirmPaymentAction,
  getPaymentStatusAction,
};

// Re-export the Service so consumers can extend or inspect.
export { XyncPayService };

// Re-export types so consumers can type their integration code.
export * from "./types";
