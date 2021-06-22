# PR 128 changelog


The main purpose of this PR is to improve the gas cost calculation of the relay calls, but there are also other improvements:


## Relay Hub:

* gasOverhead check removed. It is unnecessary, it needed a hardcoded gasOverhead value.
A new check was added in the SmartWallet contracts before calling the destination contract, to make sure there’s enough gas for calling it.

* Deploy calls now return the reason, when it reverts.

* relayCall now returns a boolean indicating if the call succeeded or if it reverted in the destination contract (if the call reverts in the destination contract, the relayCall does not revert because the worker must be paid).
This boolean is used by the RelayClient when validating a locall call. If the destination reverts, then it prevents the user from submitting a request that will revert in the destination contract.



## Deploy Request:

* The gas attribute was removed from the DeployRequest structure. The reason is because there’s no gasleft() validation during the deploy, since it either reverts or not, there’s no special scenario where it could fail but the worker should be paid anyway.


## RelayProvider:

tokenAmount?: BN | number | string;
tokenContract?: string;
forceGas?: BN | number | string;

* These 3 fields can now be set when using the RelayProvider. The only one new to the system is forceGas, which allows the user to specify the gas to send to the destination contract when using the relay provider. The native gas field already existing in the provider will get overriden by the inner provider's estimation. That's why a new field was introduced

* Now, when the relayCall didn’t revert but it did revert in the destination contract, it is going to throw the proper error instead of treating it as a succesfull call (it was a successful execution, but not for the user) .


## ContractInteractor:

* getMaxViewableDeployGasLimit()  and getMaxViewableRelayGasLimit() introduced to replace the buggy getMaxViewableGasLimit(). Now the max gas to use during the local view call made by the RelayClient is accurate.


* estimateRelayTransactionMaxPossibleGas() introduced. It is used by the relayServer, and also exposed in a utility function in the relayClient. This fucntion just estimates the max possible gas a specific relay transaction (as a whole) is going to require

* estimateDestinationContractCallGas() gives the estimate gas that needs to be put in the RelayRequest.gas attribute. It is not the same as calling web3.eth.estimateGas() since that would estimate the call as if it where called externally, which is not the case.
This function is also exposed in Enveloping.ts


## Utils:

* estimateMaxPossibleRelayCallWithLinearFit() introduced.
This function can be used in applications that want to get an estimate of how much gas is needed to relay a transaction, but without having to sign the payload that is required as one of the params in a relayCall. It is a linear fit calculated by simulating several calls to relayCall and using as X the sum of req.gas and req.tokenGas and as Y the cummulative gas used.
This function is exposed in the RelayClient as estimateMaxPossibleRelayGasWithLinearFit()



## RelayClient:

* All the new functions in relayClient are for calculating the proper amount of gas and tokenGas to put in the transaction. And it’s only called when the user didn’t specify those values.
* The relayClient now also checks that the local view call didn’t revert in the destination contract before attempting to relay.



## RelayServer:

* It now calculates the maximum amount of gas to send to the transaction properly
* It also checks that the request.gas put by the user is consistent with the current gas required by that same function (using same data, caller, gasPrice, and destination contract put by the user in the request)
