// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20 {
    function transfer(address to, uint256 value) external returns (bool);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
}

contract XButtonEscrow {
    address public immutable usdc;
    address public authorizedCaller;

    event Deposited(address indexed player, uint256 amount);
    event PaidOut(address indexed winner, uint256 amount);

    constructor(address _usdc, address _authorizedCaller) {
        usdc = _usdc;
        authorizedCaller = _authorizedCaller;
    }

    modifier onlyAuthorized() {
        require(msg.sender == authorizedCaller, "NOT_AUTHORIZED");
        _;
    }

    function deposit(uint256 amount) external {
        require(
            IERC20(usdc).transferFrom(msg.sender, address(this), amount),
            "TRANSFER_FROM_FAILED"
        );
        emit Deposited(msg.sender, amount);
    }

    function payout(address winner, uint256 amount) external onlyAuthorized {
        require(IERC20(usdc).transfer(winner, amount), "TRANSFER_FAILED");
        emit PaidOut(winner, amount);
    }

    function setAuthorizedCaller(address newCaller) external onlyAuthorized {
        authorizedCaller = newCaller;
    }
}
