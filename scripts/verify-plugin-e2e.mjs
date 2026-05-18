// Build verification: exercise every action in the built plugin against production xyncpay.com.
// Reads the demo wallet from /home/g/xyncpay/.env (DEMO_AGENT_PRIVATE_KEY).
// Imports the plugin from dist/index.mjs (the actual published artifact, not source).
// Exits 0 if all 5 actions succeed, non-zero otherwise.
//
// Run: node scripts/verify-plugin-e2e.mjs

import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = join(__dirname, "..");

// Load env vars from both repos in order: .env.local first, then .env, no overwriting.
function loadEnv() {
  const sources = [
    join(PLUGIN_ROOT, ".env.local"),
    join(PLUGIN_ROOT, ".env"),
    "/home/g/xyncpay/.env.local",
    "/home/g/xyncpay/.env",
  ];
  for (const p of sources) {
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, "utf8").split("\n")) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.+)$/);
      if (m) process.env[m[1]] ??= m[2].trim().replace(/^["']|["']$/g, "");
    }
  }
}

loadEnv();

const DEMO_AGENT_PRIVATE_KEY = process.env.DEMO_AGENT_PRIVATE_KEY;
const DEMO_MERCHANT_ADDRESS =
  process.env.DEMO_MERCHANT_ADDRESS ?? "0xd6c56b07A789C63047D3DfA314d69f8c63A109aB";
const XYNCPAY_API_URL = process.env.XYNCPAY_API_URL ?? "https://www.xyncpay.com";
const BASE_RPC_URL = process.env.BASE_RPC_URL ?? "https://mainnet.base.org";

if (!DEMO_AGENT_PRIVATE_KEY) {
  console.error("DEMO_AGENT_PRIVATE_KEY not found. Set it in /home/g/xyncpay/.env or .env.local");
  process.exit(2);
}

// Import the built plugin
const { xyncpayPlugin, XyncPayService } = await import(join(PLUGIN_ROOT, "dist", "index.mjs"));

// Settings used by the plugin (these are what runtime.getSetting() returns)
const SETTINGS = {
  WALLET_PRIVATE_KEY: DEMO_AGENT_PRIVATE_KEY,
  XYNCPAY_API_URL,
  XYNCPAY_PREFERRED_CHAIN: "base",
  XYNCPAY_AGENT_NAME: "VerifyAgent",
  XYNCPAY_SPENDING_CAP: "10",
  XYNCPAY_PER_TRANSACTION_LIMIT: "1",
  XYNCPAY_RATE_LIMIT: "30",
  XYNCPAY_SESSION_EXPIRES_IN: "3600",
  BASE_RPC_URL,
};

// In-memory memory store. Each table is a flat array of memory objects.
const memoryStore = {};

const ROOM_ID = "00000000-0000-0000-0000-000000000aaa";
const AGENT_ID = "00000000-0000-0000-0000-000000000001";

// Minimal mock runtime implementing only what the actions need.
function createRuntime() {
  return {
    agentId: AGENT_ID,
    character: { name: "VerifyAgent", bio: [], system: "", plugins: [] },
    getSetting: (key) => SETTINGS[key],
    getService: (name) => null, // populated after XyncPayService.start()
    getMemories: async ({ tableName, roomId, count }) => {
      const all = memoryStore[tableName] ?? [];
      return all.filter((m) => m.roomId === roomId).slice(0, count ?? 20);
    },
    createMemory: async (memory, tableName) => {
      if (!memoryStore[tableName]) memoryStore[tableName] = [];
      memoryStore[tableName].unshift({ ...memory, createdAt: Date.now() });
    },
    composeState: async () => ({ text: "", values: {}, data: {} }),
    // useModel intentionally not provided: actions should fall back to explicit params
  };
}

// Pretty-print PASS/FAIL with optional payload
function logResult(label, ok, payload) {
  const status = ok ? "PASS" : "FAIL";
  console.log(`${status}  ${label}`);
  if (payload !== undefined) {
    const formatted = typeof payload === "string"
      ? payload
      : JSON.stringify(payload, null, 2).split("\n").map((l) => "  " + l).join("\n");
    console.log(`  ${formatted}`);
  }
}

let totalPass = 0;
let totalFail = 0;

async function runStep(label, fn) {
  try {
    const result = await fn();
    if (result?.success === false) {
      totalFail++;
      logResult(label, false, result.error ?? "action returned success: false");
      return null;
    }
    totalPass++;
    logResult(label, true, result?.text ?? "ok");
    return result;
  } catch (err) {
    totalFail++;
    logResult(label, false, err instanceof Error ? err.message : String(err));
    return null;
  }
}

async function main() {
  console.log("=".repeat(60));
  console.log(`XyncPay plugin end-to-end verification`);
  console.log(`Target: ${XYNCPAY_API_URL}`);
  console.log(`Plugin: ${PLUGIN_ROOT}/dist/index.mjs`);
  console.log("=".repeat(60));

  // Step 0: Init the plugin and start the service
  const runtime = createRuntime();

  console.log("\n=== STEP 0: Plugin init and service start ===");
  try {
    if (xyncpayPlugin.init) {
      await xyncpayPlugin.init({}, runtime);
    }
    const service = await XyncPayService.start(runtime);
    runtime.getService = (name) => (name === "xyncpay" ? service : null);
    totalPass++;
    logResult("Plugin init + XyncPayService.start()", true, `wallet=${service.client.walletAddress}`);
  } catch (err) {
    totalFail++;
    logResult("Plugin init + XyncPayService.start()", false, err instanceof Error ? err.message : String(err));
    console.log("\nCannot proceed without service. Aborting.");
    process.exit(1);
  }

  // Find each action by name for clarity
  const actions = new Map(xyncpayPlugin.actions.map((a) => [a.name, a]));

  function makeMessage(content) {
    return {
      id: randomUUID(),
      entityId: AGENT_ID,
      agentId: AGENT_ID,
      roomId: ROOM_ID,
      content: { text: "", ...content },
      createdAt: Date.now(),
    };
  }

  // Step 1: Register agent
  console.log("\n=== STEP 1: XYNCPAY_REGISTER_AGENT ===");
  const registerAction = actions.get("XYNCPAY_REGISTER_AGENT");
  await runStep("XYNCPAY_REGISTER_AGENT", async () => {
    return await registerAction.handler(runtime, makeMessage({}));
  });

  // Step 2: Create session
  console.log("\n=== STEP 2: XYNCPAY_CREATE_SESSION ===");
  const createSessionAction = actions.get("XYNCPAY_CREATE_SESSION");
  await runStep("XYNCPAY_CREATE_SESSION", async () => {
    return await createSessionAction.handler(runtime, makeMessage({}));
  });

  // Step 3: Translate payment using explicit-params mode (no LLM needed)
  console.log("\n=== STEP 3: XYNCPAY_TRANSLATE_PAYMENT (explicit params) ===");
  const translateAction = actions.get("XYNCPAY_TRANSLATE_PAYMENT");
  const translateResult = await runStep("XYNCPAY_TRANSLATE_PAYMENT", async () => {
    return await translateAction.handler(
      runtime,
      makeMessage({
        recipient: DEMO_MERCHANT_ADDRESS,
        amount: "0.01",  // 0.01 USDC, well under the $1 per-tx limit
        currency: "USDC",
        memo: "plugin verification",
      }),
    );
  });

  if (!translateResult) {
    console.log("\nTranslate failed; skipping confirm and status steps.");
    console.log("\n" + "=".repeat(60));
    console.log(`SUMMARY  ${totalPass + totalFail} checked | ${totalPass} pass | ${totalFail} fail`);
    console.log("=".repeat(60));
    process.exit(1);
  }

  // Step 4: Confirm payment (signs and broadcasts the transaction)
  console.log("\n=== STEP 4: XYNCPAY_CONFIRM_PAYMENT ===");
  const confirmAction = actions.get("XYNCPAY_CONFIRM_PAYMENT");
  await runStep("XYNCPAY_CONFIRM_PAYMENT", async () => {
    return await confirmAction.handler(runtime, makeMessage({}));
  });

  // Step 5: Get payment status. Pass paymentId explicitly to exercise the
  // explicit-param path (Mode 1) shipped in fix(status). Without this, the
  // action would attempt LLM extraction (Mode 2) and fail because the mock
  // runtime has no useModel hook.
  console.log("\n=== STEP 5: XYNCPAY_GET_PAYMENT_STATUS ===");
  const getStatusAction = actions.get("XYNCPAY_GET_PAYMENT_STATUS");
  const paymentIdForStatus = translateResult?.data?.paymentId;
  if (!paymentIdForStatus || typeof paymentIdForStatus !== "string") {
    console.log("FAIL  XYNCPAY_GET_PAYMENT_STATUS");
    console.log("  Could not extract paymentId from translate result");
    totalFail++;
  } else {
    await runStep("XYNCPAY_GET_PAYMENT_STATUS", async () => {
      return await getStatusAction.handler(
        runtime,
        makeMessage({ paymentId: paymentIdForStatus })
      );
    });
  }

  console.log("\n" + "=".repeat(60));
  console.log(`SUMMARY  ${totalPass + totalFail} checked | ${totalPass} pass | ${totalFail} fail`);
  console.log("=".repeat(60));

  process.exit(totalFail === 0 ? 0 : 1);
}

await main();
