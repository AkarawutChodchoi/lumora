// Run payment reconciliation by hand (same as the daily cron): asks the gateway about
// recent unpaid payments and settles any that were paid but never got their webhook.
//   npm run reconcile
import { config } from "dotenv";

config({ path: process.env.ENV_FILE ?? ".env.local", quiet: true });
const { reconcilePayments } = await import("../src/lib/server/payments/reconcile.ts");
console.log(JSON.stringify(await reconcilePayments(), null, 2));
process.exit(0);
