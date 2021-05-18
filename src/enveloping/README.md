# Enveloping Arbiter

The Enveloping Arbiter is an off-chain component of the Enveloping solution. It is in charge of ensuring quality of service for the Enveloping clients and is part of the Relay Server.

- Keeps track of network activity analyzing its behavior to estimate and predict fees.
- Provides tiers of service, each one associated with a charge based on predicted fees and a relay time.
- Provides the above information to the Relay Clients so they can decide on the usage of the service and which tier is best suited for their purposes.
- Provides assurance of fulfillment of the relay service in the form of a verificable signed Commitment Receipt.
- Maintains multiple nonce queues (distinct accounts) so transactions pending to be relayed can be organized by deadline, allowing to expand it later to include other rules.

Components:

- **Fee Estimator** - estimates the current fees for different tolerated delays.
- **Nonce Queue Selector** - for each transaction that is submitted, chooses which nonce queue will be used, based on existing rules.
- **Commitment Validator** - component for verifying the signature of a Commitment Receipt

Structures:
- **Commitment** - represents the terms that the Relay Server agrees in order to relay the request, so it can be disputed in case it doesn't comply

Modifications:
- **Relay Server** - now it handles multiple workers. By default it will use 4, each one relaying with different delays, based on using different gas prices, being Tier 1 the lowest speed (< 30min), Tier 2 the standard (and default) speed (< 5min), Tier 3 the fast speed (< 2min) and Tier 4 the instant speed (next block). It now provides a worker signed Commitment Receipt to the client, that signature can be verified also on a smart contract using ecrecover.
- **Relay Client** - now it has a chance of specifying a maxTime field when relaying, a timestamp representing the intended expiration time for the transaction to be relayed and included in the blockchain.
- **Relay Provider** - added support for receiving the maxTime parameter from the user and sending it to the Relay Client.
- **Key Manager** - added a new method signMessage that uses the private key and ethers module to sign a message, used by the Enveloping Arbiter to sign Commitments