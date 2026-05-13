// Action: XYNCPAY_CONFIRM_PAYMENT. Signs the unsigned transaction from XYNCPAY_TRANSLATE_PAYMENT,
// broadcasts it on-chain, waits for inclusion, then reports the transaction hash to XyncPay
// to finalize the payment record. Partial failure handling: if the on-chain broadcast succeeds
// but the XyncPay API confirmation call fails, returns success with the txHash preserved AND
// an explicit apiConfirmationFailed flag in the data payload, with the API error message
// included so the developer can detect the partial failure and retry reconciliation.

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
import { elizaLogger } from "@elizaos/core";
import { Wallet, JsonRpcProvider } from "ethers";
import type { TransactionRequest } from "ethers";
import { XyncPayService } from "../services/xyncpayService";
import { getConfig } from "../environment";
import type { StoredPayment } from "../types";

const PAYMENT_TABLE = "xyncpay_payment";
const CONFIRMATION_TABLE = "xyncpay_confirmation";
const DEFAULT_CONFIRMATION_TIMEOUT_MS = 60_000;
const DEFAULT_CONFIRMATION_BLOCKS = 1;

async function findPendingPayment(
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
    // database adapters. Status filtering is not possible because
    // TranslatePaymentResponse.data has no status field; status lives on the API side,
    // so the most-recent payment is treated as the pending one.
    const sorted = [...memories].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
    return sorted[0].content as unknown as StoredPayment;
  } catch {
    return null;
  }
}

export const confirmPaymentAction: Action = {
  name: "XYNCPAY_CONFIRM_PAYMENT",
  similes: [
    "CONFIRM_PAYMENT",
    "BROADCAST_PAYMENT",
    "EXECUTE_PAYMENT",
    "FINALIZE_XYNCPAY_PAYMENT",
    "SIGN_AND_SEND_PAYMENT",
  ],
  description:
    "Sign the unsigned transaction from XYNCPAY_TRANSLATE_PAYMENT, broadcast it on-chain, wait for inclusion, and report the transaction hash to XyncPay to finalize the payment record.",

  validate: async (runtime: IAgentRuntime, message: Memory, _state?: State): Promise<boolean> => {
    const service = runtime.getService<XyncPayService>("xyncpay");
    if (!service) return false;
    try {
      const payment = await findPendingPayment(runtime, message.roomId);
      return payment !== null;
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

      const payment = await findPendingPayment(runtime, message.roomId);
      if (!payment) {
        const errMsg = "No pending payment found. Run XYNCPAY_TRANSLATE_PAYMENT first.";
        if (callback) await callback({ text: errMsg });
        return { success: false, error: errMsg };
      }

      const { unsignedTransaction: unsignedTx } = payment;

      const provider = new JsonRpcProvider(config.baseRpcUrl);
      const wallet = new Wallet(config.walletPrivateKey, provider);

      const txRequest: TransactionRequest = {
        to: unsignedTx.to,
        data: unsignedTx.data,
        value: BigInt(unsignedTx.value),
        gasLimit: BigInt(unsignedTx.gasLimit),
        chainId: BigInt(unsignedTx.chainId),
      };

      const txResponse = await wallet.sendTransaction(txRequest);

      elizaLogger.debug(
        { txHash: txResponse.hash, paymentId: payment.paymentId },
        "XYNCPAY_CONFIRM_PAYMENT: transaction broadcast"
      );

      let receipt;
      try {
        receipt = await txResponse.wait(
          DEFAULT_CONFIRMATION_BLOCKS,
          DEFAULT_CONFIRMATION_TIMEOUT_MS
        );
      } catch (waitErr) {
        const errMsg =
          "Transaction failed or reverted: " +
          (waitErr instanceof Error ? waitErr.message : String(waitErr));
        if (callback) await callback({ text: errMsg });
        return { success: false, error: errMsg };
      }

      if (!receipt) {
        const errMsg =
          `Transaction confirmation timed out after ${DEFAULT_CONFIRMATION_TIMEOUT_MS}ms. ` +
          `txHash: ${txResponse.hash}`;
        if (callback) await callback({ text: errMsg });
        return { success: false, error: errMsg };
      }

      if (receipt.status === 0) {
        const errMsg = `Transaction reverted on-chain. txHash: ${txResponse.hash}`;
        if (callback) await callback({ text: errMsg });
        return { success: false, error: errMsg };
      }

      elizaLogger.debug(
        { txHash: receipt.hash, blockNumber: receipt.blockNumber },
        "XYNCPAY_CONFIRM_PAYMENT: transaction confirmed"
      );

      // Report to XyncPay. If this fails the transaction is already on-chain, so
      // return success with the txHash so the caller can reconcile manually.
      let confirmData: Record<string, unknown> | undefined;
      let apiConfirmError: string | undefined;
      try {
        const confirmResponse = await client.confirmPayment(payment.paymentId, {
          txHash: receipt.hash,
        });

        await runtime.createMemory(
          {
            id: crypto.randomUUID() as UUID,
            entityId: runtime.agentId,
            agentId: runtime.agentId,
            roomId: message.roomId,
            // Content has [key: string]: unknown so ConfirmPaymentResponse data fields are
            // compatible. The cast through unknown is needed because TypeScript sees
            // Content's named optional fields and cannot confirm the shape without it.
            content: confirmResponse.data as unknown as { [key: string]: unknown },
            createdAt: Date.now(),
          },
          CONFIRMATION_TABLE
        );

        confirmData = confirmResponse.data as unknown as Record<string, unknown>;
      } catch (apiErr) {
        apiConfirmError =
          apiErr instanceof Error ? apiErr.message : "Unknown error reporting confirmation to XyncPay";
        elizaLogger.debug(
          { txHash: receipt.hash, paymentId: payment.paymentId, apiError: apiConfirmError },
          "XYNCPAY_CONFIRM_PAYMENT: on-chain success but API confirmation failed"
        );
      }

      let userMessage: string;
      if (apiConfirmError) {
        userMessage =
          `Payment broadcast and included on-chain (txHash: ${receipt.hash}), ` +
          `but reporting to XyncPay failed: ${apiConfirmError}. ` +
          `Save this txHash and retry XYNCPAY_GET_PAYMENT_STATUS later to reconcile.`;
      } else {
        userMessage = `Payment confirmed on-chain. txHash: ${receipt.hash}`;
      }
      if (callback) await callback({ text: userMessage });

      return {
        success: true,
        text: userMessage,
        data: confirmData ?? {
          txHash: receipt.hash,
          paymentId: payment.paymentId,
          apiConfirmationFailed: true,
          apiConfirmationError: apiConfirmError ?? "Unknown error",
        },
      };
    } catch (err) {
      const errMsg =
        err instanceof Error ? err.message : "Unknown error during payment confirmation";
      if (callback) await callback({ text: errMsg });
      return { success: false, error: errMsg };
    }
  },

  examples: [
    [
      {
        name: "{{user}}",
        content: { text: "Confirm and broadcast the payment" },
      },
      {
        name: "{{agent}}",
        content: {
          text: "Signing and broadcasting the transaction on-chain now.",
          actions: ["XYNCPAY_CONFIRM_PAYMENT"],
        },
      },
    ],
    [
      {
        name: "{{user}}",
        content: { text: "Send the payment transaction to the blockchain" },
      },
      {
        name: "{{agent}}",
        content: {
          text: "Broadcasting the XyncPay transaction and waiting for confirmation.",
          actions: ["XYNCPAY_CONFIRM_PAYMENT"],
        },
      },
    ],
    [
      {
        name: "{{user}}",
        content: { text: "Execute the pending XyncPay payment" },
      },
      {
        name: "{{agent}}",
        content: {
          text: "Signing the unsigned transaction and submitting it on-chain.",
          actions: ["XYNCPAY_CONFIRM_PAYMENT"],
        },
      },
    ],
  ],
};
