# @xyncpay/plugin-elizaos

ElizaOS plugin for XyncPay. Cross-protocol payment translation for autonomous AI agents.

XyncPay bridges incompatible payment protocols (x402, MPP, AP2) into USDC settlement on Base. This plugin lets ElizaOS agents register a wallet, open spending sessions with configurable limits, translate natural-language payment requests into signed on-chain transactions, and confirm settlement.

## Installation

```bash
npm install @xyncpay/plugin-elizaos
```

## Quick Start

Add the plugin to your character configuration:

```typescript
import type { Character } from "@elizaos/core";
import { xyncpayPlugin } from "@xyncpay/plugin-elizaos";

export const character: Character = {
  name: "PaymentAgent",
  plugins: [xyncpayPlugin],
  system: "An autonomous agent that pays for goods and services on behalf of its user.",
  bio: [
    "Pays for things using XyncPay.",
    "Operates within configured spending limits.",
  ],
};
```

Configure environment variables in your `.env` file. All amounts are in human-readable USDC (e.g., `"100"` means 100 USDC, not smallest units):

```bash
# Required
WALLET_PRIVATE_KEY=0x_your_private_key_here
XYNCPAY_SPENDING_CAP=100
XYNCPAY_PER_TRANSACTION_LIMIT=10
XYNCPAY_RATE_LIMIT=30
XYNCPAY_SESSION_EXPIRES_IN=3600

# Optional (defaults shown)
XYNCPAY_API_URL=https://www.xyncpay.com
XYNCPAY_PREFERRED_CHAIN=base
XYNCPAY_AGENT_NAME=PaymentAgent
BASE_RPC_URL=https://mainnet.base.org
```

## Configuration Reference

| Variable | Required | Default | Description |
|---|---|---|---|
| `WALLET_PRIVATE_KEY` | yes | none | Agent wallet private key. Used to sign API requests and on-chain transactions. Never sent to XyncPay. |
| `XYNCPAY_SPENDING_CAP` | yes | none | Total session spending cap in USDC. Example: `"100"` for 100 USDC. |
| `XYNCPAY_PER_TRANSACTION_LIMIT` | yes | none | Maximum amount per transaction in USDC. Example: `"10"` for 10 USDC. |
| `XYNCPAY_RATE_LIMIT` | yes | none | Maximum transactions per minute. Example: `30`. |
| `XYNCPAY_SESSION_EXPIRES_IN` | yes | none | Session lifetime in seconds. Example: `3600` for 1 hour. |
| `XYNCPAY_API_URL` | no | `https://www.xyncpay.com` | Base URL for the XyncPay API. |
| `XYNCPAY_PREFERRED_CHAIN` | no | `base` | Default chain for settlement. Currently only `base` is supported. |
| `XYNCPAY_AGENT_NAME` | no | character.name | Human-readable name for the agent. |
| `BASE_RPC_URL` | no | `https://mainnet.base.org` | Base mainnet RPC endpoint for broadcasting signed transactions. |

## Actions

### XYNCPAY_REGISTER_AGENT

Registers the agent wallet with XyncPay using a two-step challenge-response flow that proves wallet ownership without exposing the private key. Idempotent: safe to call multiple times.

The action stores the resulting xyncId (e.g., `xync_6b8dd882f7a94bcb`) in agent memory. Subsequent actions read this xyncId automatically.

### XYNCPAY_CREATE_SESSION

Opens a spending session with the configured limits (spending cap, per-transaction limit, rate limit, expiry). The session is the authorization primitive: XyncPay only builds transactions for amounts within the active session's bounds. The agent must still sign every transaction locally.

Stores the session record (sessionId, agentId as xyncId, all limits) in agent memory for downstream actions.

### XYNCPAY_TRANSLATE_PAYMENT

Translates a payment request into a chain-ready unsigned transaction. Two invocation modes:

**Conversational mode (LLM extraction):** The user message contains natural language such as "send 10 USDC to 0xabc..." and the plugin uses `runtime.useModel` to extract recipient, amount, currency, and memo.

**Explicit-parameter mode (no LLM required):** The caller passes explicit fields in `message.content`:

```typescript
const message: Memory = {
  // standard Memory fields omitted
  content: {
    text: "explicit payment request",
    recipient: "0xd6c56b07A789C63047D3DfA314d69f8c63A109aB",
    amount: "10",       // human USDC string
    currency: "USDC",
    memo: "coffee",     // optional
  },
};
```

The explicit-parameter mode works in any runtime, including OpenClaw and other non-LLM-bound hosts.

Both modes produce an unsigned EIP-1559 transaction (chainId, to, data, value, gasLimit, maxFeePerGas, maxPriorityFeePerGas) plus a paymentId for downstream confirmation. The payment record is stored in agent memory.

### XYNCPAY_CONFIRM_PAYMENT

Signs the unsigned transaction returned by XYNCPAY_TRANSLATE_PAYMENT, broadcasts it on the configured chain, waits for inclusion, and reports the transaction hash to XyncPay to finalize the payment record.

The agent wallet signs locally using `WALLET_PRIVATE_KEY`. The signed transaction is broadcast through `BASE_RPC_URL`. If the transaction confirms on-chain but the XyncPay API call fails, the action returns partial success with `apiConfirmationFailed: true` and the txHash preserved in the response data so the caller can reconcile.

### XYNCPAY_GET_PAYMENT_STATUS

Queries the status of a payment by paymentId. Two resolution modes:

**By paymentId in message text:** If the user message contains a paymentId token (e.g., `xyn_pay_abc123`), the action extracts and queries it.

**By memory lookup:** If no paymentId is mentioned, the action falls back to the most recent payment in agent memory.

Returns the full status response including the settlement object (txHash and blockNumber once confirmed) and current status (`ready`, `pending`, `submitted`, `confirmed`, `failed`, or `expired`).

## Architecture

The plugin exposes a single ElizaOS Service (`XyncPayService`, serviceType `"xyncpay"`) that holds the `XyncPayClient`. The client owns the wallet and HTTP API layer. Actions retrieve it via `runtime.getService<XyncPayService>("xyncpay")` rather than constructing clients per-call.

```
src/
  index.ts                  Plugin export and init lifecycle hook
  environment.ts            Zod-validated config with USDC unit conversion
  types.ts                  Production-verified API contract types
  services/
    xyncpayClient.ts        HTTP client with wallet-signed request authentication
    xyncpayService.ts       ElizaOS Service singleton wrapping the client
  actions/
    registerAgent.ts        XYNCPAY_REGISTER_AGENT
    createSession.ts        XYNCPAY_CREATE_SESSION
    translatePayment.ts     XYNCPAY_TRANSLATE_PAYMENT
    confirmPayment.ts       XYNCPAY_CONFIRM_PAYMENT
    getPaymentStatus.ts     XYNCPAY_GET_PAYMENT_STATUS
```

Configuration is validated at plugin init time by `getConfig()` in `environment.ts`. Missing required variables throw immediately with a descriptive error listing every failing field. Human-readable USDC amounts (e.g., `"10.50"`) are converted to 6-decimal smallest units (e.g., `"10500000"`) at load time via a Zod transform.

## License

MIT. See [LICENSE](./LICENSE).
