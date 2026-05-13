// XyncPayService: ElizaOS Service wrapping XyncPayClient as a runtime-managed singleton.
// Lifecycle: runtime calls XyncPayService.start() once during plugin load; the service
// holds the XyncPayClient and exposes it to actions via runtime.getService('xyncpay').
// Actions read service.client.<method> instead of constructing a new client per-call.

import { Service, type IAgentRuntime, logger } from "@elizaos/core";
import { XyncPayClient } from "./xyncpayClient";
import { getConfig } from "../environment";

export class XyncPayService extends Service {
  static serviceType = "xyncpay";
  capabilityDescription =
    "XyncPay protocol translation and settlement coordination for AI agent payments";

  // Assigned in start() before the instance is returned; safe to assert non-null.
  public client!: XyncPayClient;

  static async start(runtime: IAgentRuntime): Promise<XyncPayService> {
    const config = getConfig(runtime);
    const client = new XyncPayClient(config);
    const service = new XyncPayService(runtime);
    service.client = client;
    logger.info(
      `XyncPayService started: wallet=${client.walletAddress} api=${config.apiUrl} chain=${config.preferredChain}`,
    );
    return service;
  }

  async stop(): Promise<void> {
    // XyncPayClient has no persistent connections or in-flight cleanup needs.
    // This method exists to satisfy the Service contract.
    logger.info("XyncPayService stopped");
  }
}
