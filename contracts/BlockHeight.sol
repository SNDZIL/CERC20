// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract BlockHeight {
    // 返回当前区块链的高度
    function getBlockHeight() public view returns (uint256) {
        return block.number;
    }
}