import {
  registerEntitySecretCiphertext,
} from "@circle-fin/developer-controlled-wallets";
import fs from "fs";

async function main() {
  const apiKey = process.env.CIRCLE_API_KEY;
  const entitySecret = process.env.CIRCLE_ENTITY_SECRET;

  if (!apiKey || !entitySecret) {
    console.error("Missing CIRCLE_API_KEY or CIRCLE_ENTITY_SECRET");
    process.exit(1);
  }

  const response = await registerEntitySecretCiphertext({
    apiKey,
    entitySecret,
    recoveryFileDownloadPath: "./recovery",
  });

  console.log("\n✅ Registration succeeded\n");
  console.log("Recovery file saved to: ./recovery");
  console.log("\nResponse data keys:", Object.keys(response.data || {}));
}

main().catch((err) => {
  console.error("Error:", err.message || err);
  process.exit(1);
});
