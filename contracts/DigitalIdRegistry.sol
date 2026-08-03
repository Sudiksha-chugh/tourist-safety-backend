// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title DigitalIdRegistry
 * @notice Stores a tamper-evident fingerprint (hash) for each tourist's
 *         digital ID record. The actual personal data never touches this
 *         contract — only the hash does. Anyone can verify a hash;
 *         nobody (not even the contract owner) can alter one once stored.
 */
contract DigitalIdRegistry {
    // Maps a tourist's ID (as a string, e.g. their UUID from our database)
    // to the hash we computed for their digital ID record.
    mapping(string => string) private touristIdToHash;

    // Tracks whether a tourist ID has already been registered,
    // so we can prevent silently overwriting an existing hash.
    mapping(string => bool) private isRegistered;

    // An "event" is how a smart contract announces that something
    // happened. Anyone watching the blockchain (like our backend, or a
    // block explorer) can see this without having to constantly ask
    // the contract "did anything change?"
    event HashStored(string touristId, string recordHash, uint256 timestamp);

    /**
     * @notice Store a hash for a tourist ID. Can only be called once per
     *         tourist ID — this contract deliberately does not allow
     *         updates, because allowing silent overwrites would defeat
     *         the whole point of tamper-evidence.
     */
    function storeHash(string memory touristId, string memory recordHash) public {
        require(!isRegistered[touristId], "Hash already stored for this tourist ID");

        touristIdToHash[touristId] = recordHash;
        isRegistered[touristId] = true;

        emit HashStored(touristId, recordHash, block.timestamp);
    }

    /**
     * @notice Look up the stored hash for a tourist ID.
     *         "view" means this function only reads data — it doesn't
     *         cost any gas to call, because it doesn't change anything
     *         on the blockchain.
     */
    function getHash(string memory touristId) public view returns (string memory) {
        require(isRegistered[touristId], "No hash stored for this tourist ID");
        return touristIdToHash[touristId];
    }
}