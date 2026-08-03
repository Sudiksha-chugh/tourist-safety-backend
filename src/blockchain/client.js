import { createWalletClient, createPublicClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load the contract's ABI from the artifact Ignition generated when we deployed.
// The ABI tells viem what functions exist and what arguments they expect.
const artifactPath = path.join(
  __dirname,
  "../../ignition/deployments/chain-80002/artifacts/DigitalIdRegistryModule#DigitalIdRegistry.json"
);
const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf-8"));
export const contractAbi = artifact.abi;

export const contractAddress = process.env.DIGITAL_ID_REGISTRY_ADDRESS;

// Amoy testnet's network details — viem needs to know things like
// chain ID to build valid transactions.
const amoyChain = {
  id: 80002,
  name: "Polygon Amoy",
  nativeCurrency: { name: "POL", symbol: "POL", decimals: 18 },
  rpcUrls: {
    default: { http: [process.env.AMOY_RPC_URL] },
  },
};

// A "public client" is for read-only calls (like getHash) — no wallet needed.
export const publicClient = createPublicClient({
  chain: amoyChain,
  transport: http(process.env.AMOY_RPC_URL),
});

// A "wallet client" can sign and send transactions (like storeHash) —
// this is where our private key gets used, turning our backend into
// something that can act on-chain on our behalf.
const account = privateKeyToAccount(process.env.BACKEND_WALLET_PRIVATE_KEY);

export const walletClient = createWalletClient({
  account,
  chain: amoyChain,
  transport: http(process.env.AMOY_RPC_URL),
});