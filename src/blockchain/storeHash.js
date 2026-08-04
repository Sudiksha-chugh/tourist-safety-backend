import { contractAbi, contractAddress, walletClient, publicClient } from "./client.js";

/**
 * Publishes a tourist's record hash to the DigitalIdRegistry smart
 * contract on Polygon Amoy. Returns the transaction hash once the
 * transaction is confirmed (mined into a block).
 *
 * @param {string} touristId - the tourist's UUID from our database
 * @param {string} recordHash - the SHA-256 hash we computed earlier
 * @returns {Promise<string>} the on-chain transaction hash
 */
export async function storeHashOnChain(touristId, recordHash) {
  const txHash = await walletClient.writeContract({
    address: contractAddress,
    abi: contractAbi,
    functionName: "storeHash",
    args: [touristId, recordHash],
  });

  const receipt = await publicClient.waitForTransactionReceipt({
    hash: txHash,
  });

  if (receipt.status !== "success") {
    throw new Error("Blockchain transaction failed");
  }

  return txHash;
}

/**
 * Reads the hash stored on-chain for a given tourist ID.
 * This is a read-only call — free, no gas needed, no wallet required.
 */
export async function getHashFromChain(touristId) {
  const hash = await publicClient.readContract({
    address: contractAddress,
    abi: contractAbi,
    functionName: "getHash",
    args: [touristId],
  });
  return hash;
}