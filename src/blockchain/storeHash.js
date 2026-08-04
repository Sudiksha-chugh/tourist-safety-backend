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
  // writeContract() builds the transaction, signs it with our wallet's
  // private key, and sends it to the network. This costs gas.
  const txHash = await walletClient.writeContract({
    address: contractAddress,
    abi: contractAbi,
    functionName: "storeHash",
    args: [touristId, recordHash],
  });

  // At this point, the transaction has been SENT but not necessarily
  // MINED yet (blockchains take a few seconds to confirm). We wait
  // for a receipt so we know it actually succeeded before telling
  // our own database it's done.
  const receipt = await publicClient.waitForTransactionReceipt({
    hash: txHash,
  });

  if (receipt.status !== "success") {
    throw new Error("Blockchain transaction failed");
  }

  return txHash;
}