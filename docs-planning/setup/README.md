# Storehouse — One-Time Setup Scripts

These scripts were used **once** to bootstrap Storehouse's Circle Developer-Controlled Wallet infrastructure on Arc Testnet (May 16, 2026). They are kept here as reference documentation, not as part of the running application.

The actual Storehouse app does not call these scripts. Wallet operations during runtime happen via the Circle SDK directly inside the app's backend.

## Order of execution (already completed)

1. **`01-generate-entity-secret.js`** — Generated the 32-byte Entity Secret used to authorize all wallet operations. Output was a 64-character hex string printed to terminal.
2. **`02-register-entity-secret.js`** — Encrypted the Entity Secret with Circle's public key and registered the ciphertext with Circle's servers. Wrote a recovery file to disk.
3. **`03-create-wallets.js`** — Created one Wallet Set named "Storehouse v1 — Testnet" and 5 EOA wallets within it on Arc Testnet:
   - `storehouse-main` — receives inbound USDC
   - `storehouse-tithe` — destination for tithe routing (10%)
   - `storehouse-tax-escrow` — destination for tax escrow (15%)
   - `storehouse-savings` — destination for savings goal (10%)
   - `storehouse-operating` — destination for remainder

Note: Circle's docs state that EVM wallets in a set share an address, but in practice on Arc Testnet each wallet received a unique address. This is favorable for Storehouse — each bucket is independently inspectable on testnet.arcscan.app. (Worth verifying in Circle Product Feedback.)

## Where the credentials live

NONE of the secrets used by these scripts are stored in this repo or on disk. All values are in 1Password:

- `Circle Testnet API Key — Storehouse`
- `Circle Testnet Entity Secret — Storehouse`
- `Circle Recovery File — Storehouse Testnet` (the encrypted recovery blob)
- `Storehouse Wallets — Arc Testnet` (Wallet Set ID + 5 Wallet IDs + 5 addresses)

If credentials are ever needed in the future (e.g., to rerun a script or initialize a new environment), retrieve from 1Password and inject via environment variables at runtime:

```bash
CIRCLE_API_KEY='...' CIRCLE_ENTITY_SECRET='...' node script-name.js
```

Never write these values to files. Never commit them to git.

## When would these scripts run again?

- **`01-generate-entity-secret.js`** — only if rotating the Entity Secret. This rotates wallet authorization access, not the wallets themselves. Use with caution.
- **`02-register-entity-secret.js`** — only after a fresh Entity Secret generation or after Entity Secret rotation.
- **`03-create-wallets.js`** — if creating additional wallets in the existing wallet set, modify the `labels` array and `count` parameter. To create wallets in a new set, the script also works as-is.

## Dependencies

These scripts require:
- Node.js 22+
- `@circle-fin/developer-controlled-wallets` (the Circle SDK)
- `package.json` with `"type": "module"` (ESM)

The original scratch directory (`~/circle-setup`) had a proper npm setup. If rerunning, recreate:

```bash
mkdir scratch && cd scratch
npm init -y
npm pkg set type=module
npm install @circle-fin/developer-controlled-wallets
# Copy the script you want to run into this directory
# Run with inline env vars (see above)
```

## Security checklist before any rerun

- [ ] Pulling secrets from 1Password (not from a file)
- [ ] Pasting into terminal carefully (single quotes around values to prevent shell interpretation)
- [ ] Running `clear && history -c` after any command containing secrets
- [ ] Working in a scratch directory, not in the Storehouse repo
- [ ] No `.env` or similar file is created
