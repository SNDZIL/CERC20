// SPDX-License-Identifier: SEE LICENSE IN LICENSE
pragma solidity ^0.8.20;

import "./ConfidentialERC20.sol";

contract CERC20Faucet is Ownable2Step, ConfidentialERC20 {
    using RequestBuilder for Request;
    using ResponseResolver for CapsulatedValue;

    uint64 target;

    event FaucetLog(address indexed to, euint64 amount);

    constructor(
        string memory name_,
        string memory symbol_,
        address oracle_,
        bytes memory initial_
    ) ConfidentialERC20(name_, symbol_, oracle_, initial_) {}

    function faucet(address minter, uint64 min, uint64 max) external onlyInitialized {
        require(minter != address(0), "Confidential ERC20: mint to the zero address");
        _setBalanceInitialized(minter);
        require(_getInitialized(_balances[minter]), "Please initialize balance first.");
        _makeFaucet(minter, min, max);
    }

    function _makeFaucet(address to, uint64 min, uint64 max) internal onlyInitialized returns (bool) {
        Request memory r = RequestBuilder.newRequest(
            msg.sender, // Requester address
            5, // Number of operations
            address(this), // Callback address
            this.callbackMakeFaucet.selector, // Callback function
            "" // Payload
        );

        uint64 range = max - min + 1;
        uint64 shards = (type(uint64).max / range + 1);

        op encryptedValueA = r.rand();
        op scaled_random_value = r.div(encryptedValueA, shards);
        op mint_amount = r.add(scaled_random_value, min);
        op curr_balance = r.getEuint64(_balances[to]);
        r.add(mint_amount, curr_balance);

        latestReqId = oracle.send(r);
        _transferContexts[latestReqId] = TransferContext(address(0), to, uint8(1));

        return true;
    }

    function callbackMakeFaucet(bytes32 reqId, CapsulatedValue[] memory values) public onlyOracle {
        TransferContext memory transferContext = _transferContexts[reqId];
        // mint
        _balances[transferContext.receiver] = values[4].asEuint64();
        delete _supplyContexts[reqId];
        emit FaucetLog(transferContext.receiver, values[2].asEuint64());
        delete _transferContexts[reqId];
    }
}
