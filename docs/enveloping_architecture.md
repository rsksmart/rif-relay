# Enveloping architecture

The system is designed to achieve deployments and transaction sponsorship at low cost. The cost of the relay service provided by "sponsors" is agreed among the parties off-chain. The low cost of transactions on RSK contributes to keeping overall service costs low as well.

The core Enveloping architecture is defined by the following components:

- **Relay Request** - a structure that wraps the transaction sent by an end-user including the required data for the relay (e.g. address of the payer, address of the original requester, token payment data).
- **Relay Hub** - a core contract on the blockchain which serves as the interface for the on-chain system. It manages the balances of the accounts involved and forwards Relay Requests to the rest of the contracts. 
- **Verifier** - an abstract contract that authorizes a specific relay request.
- **Smart Wallet** - a contract that verifies forwarded data and invokes the receipient contract of the transaction. The smart wallet is created *counterfactually* at the moment it is needed. This happens, for instance, when a user with some token balances wants to move those tokens without spending gas, i.e. using the enveloping system.
- **Relay Server** - a relay service daemon, running as a  HTTP service.  Advertises itself (through the RelayHub) and waits for client requests.
- **Relay Client** - a typescript library for a client to access the blockchain through a relay. Provides APIs to find a good relay, and to send transactions through it. The library hooks the local web3, so that any loade. Id contract API will go through the relay.


## Documentation
For more detailed documentation, go [here](https://docs.google.com/document/d/1kan8xUFYgjWNozBfpkopn35P9E6IuRjC-PNhwcrQLN4/edit)