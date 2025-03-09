// SPDX-License-Identifier: SEE LICENSE IN LICENSE
pragma solidity ^0.8.20;

import "@sight-oracle/contracts/Oracle/Types.sol";
import "@sight-oracle/contracts/Oracle/Oracle.sol";
import "@sight-oracle/contracts/Oracle/RequestBuilder.sol";
import "@sight-oracle/contracts/Oracle/CapsulatedValueResolver.sol";


contract ConfidentialERC20 is Ownable2Step{
    using RequestBuilder for Request;
    using ResponseResolver for CapsulatedValue;

    event Transfer(address indexed from, address indexed to);
    event Mint(address indexed to, uint64 amount);
    event Burn(address indexed from, uint64 amount);
    event Approve(address indexed from, address indexed to);
    event OracleCallback(bytes32 indexed reqId);
    event InitializeOracleCallback(bytes32 indexed reqId);

    // totalsupply & name & symbol & decimals
    uint64 private _totalSupply;
    string private _name;
    string private _symbol;
    uint8 private _decimals = 6;

    euint64 private initialValue;
    bool private isInitialized = false;

    Oracle public oracle;

    bytes32 latestReqId;
    uint64 private result;

    // transfer context, for callback function
    struct TransferContext {    // transfer info
    address sender;
    address receiver;
    uint8 isSpecial;    // 0: normal, 1: mint, 2: burn, 3: transferFrom
    }
    mapping(bytes32 => TransferContext) internal _transferContexts;     
    mapping(bytes32 => address) internal _addressContexts;
    mapping(bytes32 => uint64) internal _supplyContexts;

    // balance & allowance
    mapping(address account => euint64) internal _balances;
    mapping(address account => mapping(address spender => euint64)) internal _allowances;

    // decryptBalance & viewACL
    mapping(address account => uint64) internal _decryptBalance;
    mapping(address account => mapping(address viewer => bool)) internal _viewBalanceApproval;


    constructor(string memory name_, string memory symbol_, address oracle_, bytes memory initial_) Ownable() {
        _name = name_;
        _symbol = symbol_;
        oracle = Oracle(payable(oracle_));
        initializeValue(initial_);
    }

    // initialize the defalut zero value
    function initializeValue(bytes memory zero) public onlyOwner {
        Request memory r = RequestBuilder.newRequest(
            msg.sender,              // Requester address
            2,                       // Number of operations
            address(this),           // Callback address
            this.callbackInitializeValue.selector,  // Callback function
            ""                       // Payload
        );
        op savedZero = r.saveEuint64Bytes(zero);
        r.decryptEuint64(savedZero);

        latestReqId = oracle.send(r);
    }

    function callbackInitializeValue(bytes32 reqId, CapsulatedValue[] memory values) public onlyOracle {
        require(values.length > 0, "Invalid response from Oracle");
        initialValue = values[0].asEuint64();
        result = values[1].asUint64();
        isInitialized = true;
        emit InitializeOracleCallback(reqId);
    }

    // public functions

    // name, symbol, decimals
    function name() public view virtual returns (string memory) {
        return _name;
    }

    function symbol() public view virtual returns (string memory) {
        return _symbol;
    }

    function decimals() public view virtual returns (uint8) {
        return _decimals;
    }

    // total supply
    function getTotalSupply() public view virtual returns (uint64) {
        return _totalSupply;
    }

    // Retrieves the balance of a specified wallet
    function balanceOf(address account) public view virtual returns (euint64) {
        return _balances[account];
    }

    // get the initialized zero
    function getInitialValue() public view returns (euint64) {
        return initialValue;
    }

    // for testing
    function getResult() public view returns (uint64) {
        return result;
    }

    // mint
    function mint(uint64 amount) public virtual onlyOwner{
        _mint(msg.sender, amount * uint64(10) **_decimals);
    }

    // burn
    function burn(uint64 amount) public virtual{
        _burn(msg.sender, amount * uint64(10) **_decimals);
    }

    
    // transfer
    function transfer(address to, uint64 value) public virtual returns (bool){
        _transfer(msg.sender, to, value);
        return true;
    }

    // get allowance
    function getAllowance(address approver, address spender) public view virtual returns (euint64) {
        return _allowances[approver][spender];
    }

    // approve
    function approve(address spender, uint64 value) public virtual returns (bool) {
        address approver = msg.sender;
        require(approver != address(0), "Confidential ERC20: approve from the zero address");
        require(spender != address(0), "Confidential ERC20: approve to the zero address");

        _setAllowanceInitialized(approver, spender);
        require(_getInitialized(_allowances[approver][spender]), "Please initialize balance first.");
        _approve(approver, spender, value);
        return true;
    }

    // transferFrom
    function transferFrom(address from, address to, uint64 value) public virtual returns (bool) {
        require(from != address(0), "Confidential ERC20: transfer from the zero address");
        require(to != address(0), "Confidential ERC20: transfer to the zero address");
        address spender = msg.sender;
        require(_getInitialized(_allowances[from][spender]), "Please initialize approval first.");
        makeTransfer(from, to, value, true);
        return true;
    } 

    // decrypt a user's balance
    function decrypteUserBalance(address user) public {
        require(msg.sender == user || _viewBalanceApproval[user][msg.sender] || msg.sender == owner(), "Not Approval.");      // add owner for testing
        _setBalanceInitialized(user);
        require(_getInitialized(_balances[user]), "Please initialize balance first.");
        _decrypteUserBalance(user);
    }

    // get a user's decrypt balance
    function getDecryptBalance(address user) public view returns(uint64) {
        require(msg.sender == user || _viewBalanceApproval[user][msg.sender] || msg.sender == owner(), "Not approval.");    // add owner for testing
        return _decryptBalance[user];
    }

    // approve a user to view the decrypt balance
    function approveView(address viewer) public {
        address user = msg.sender;
        require(user != address(0), "Confidential ERC20: approve from the zero address");
        require(viewer != address(0), "Confidential ERC20: approve to the zero address");
        _viewBalanceApproval[user][viewer] = true;
    }
    // withdraw the approval
    function withdrawApproval(address viewer) public {
        address user = msg.sender;
        require(user != address(0), "Confidential ERC20: withdraw from the zero address");
        require(viewer != address(0), "Confidential ERC20: withdraw to the zero address");
        _viewBalanceApproval[user][viewer] = false;
    }


    // internal function and callback function

    // mint
    function _mint(address minter, uint64 value) internal {
        require(minter != address(0), "Confidential ERC20: mint to the zero address");
        _setBalanceInitialized(minter);
        require(_getInitialized(_balances[minter]), "Please initialize balance first.");
        makeTransfer(address(0), minter, value);
    }
    
    // burn
    function _burn(address burner, uint64 value) internal {
        require(burner != address(0), "Confidential ERC20: burn from the zero address");
        _setBalanceInitialized(burner);
        require(_getInitialized(_balances[burner]), "Please initialize balance first.");
        makeTransfer(burner, address(0), value);
    }

    // transfer
    function _transfer(address from, address to, uint64 amount) internal {
        require(from != address(0), "Confidential ERC20: transfer from the zero address");
        require(to != address(0), "Confidential ERC20: transfer to the zero address");
        _setBalanceInitialized(from);
        _setBalanceInitialized(to);
        require(_getInitialized(_balances[to]) && _getInitialized(_balances[from]), "Please initialize balance first.");

        makeTransfer(from, to, amount);
    }

    // get the state of default zero initialization (if initialized: true, uninitialized: false)
    function _getInitialized(euint64 value) internal pure returns (bool) {
        return uint256(euint64.unwrap(value)) == 0? false: true;
    }

    // initialize the balance and allowance with default zero
    function _setBalanceInitialized(address user) internal onlyInitialized {
        if(!_getInitialized(_balances[user])) {
            _balances[user] = initialValue;
        }
    }
    function _setAllowanceInitialized(address approver, address spender) internal onlyInitialized {
        if(!_getInitialized(_allowances[approver][spender])) {
            _allowances[approver][spender] = initialValue;
        }
    }

    // approve
    function _approve(address approver, address spender, uint64 value) internal virtual returns(bool){
        Request memory r = RequestBuilder.newRequest(
            msg.sender,              // Requester address
            2,                       // Number of operations
            address(this),           // Callback address
            this.callbackApprove.selector,  // Callback function
            ""                       // Payload
        );            
        op loadSenderAllowance = r.getEuint64(_allowances[approver][spender]);
        r.add(loadSenderAllowance, value);

        latestReqId = oracle.send(r);
        _transferContexts[latestReqId] = TransferContext(approver, spender, uint8(0));

        return true;
    }

    function callbackApprove(bytes32 reqId, CapsulatedValue[] memory values) public onlyOracle {      
        address approver = _transferContexts[reqId].sender;
        address spender = _transferContexts[reqId].receiver;
        _allowances[approver][spender] = values[1].asEuint64();
        emit Approve(approver, spender);
        emit OracleCallback(reqId);     // for testing
        delete _transferContexts[reqId];
    }

    // request to decrypt a user's balance
    function _decrypteUserBalance(address user) internal {
        // Initialize new FHE computation request of a single step.
        Request memory r = RequestBuilder.newRequest(
            msg.sender,
            2,
            address(this),
            this.callbackDecrypteUserBalance.selector // specify the callback for Oracle
        );

        // Generate a random encrypted value and store in Sight Network
        op userBalance = r.getEuint64(_balances[user]);
        r.decryptEuint64(userBalance);

        // Send the request via Sight FHE Oracle
        latestReqId = oracle.send(r);
        _addressContexts[latestReqId] = user;
    }

    function callbackDecrypteUserBalance(bytes32 reqId, CapsulatedValue[] memory values) public onlyOracle {        
        _decryptBalance[_addressContexts[reqId]] = values[1].asUint64();
        delete _addressContexts[reqId];
        emit OracleCallback(reqId);
    }

    // request other kinds of txns to Oracle
    function makeTransfer(address from, address to, uint64 value) internal virtual returns (bool) {
        return _makeTransfer(from, to, value, false);
    }   
    function makeTransfer(address from, address to, uint64 value, bool isTransferFrom) internal virtual returns (bool) {
        return _makeTransfer(from, to, value, isTransferFrom);
    }   

    function _makeTransfer(address from, address to, uint64 value, bool isTransferFrom) internal virtual onlyInitialized returns (bool) {
        //transferFrom
        if(isTransferFrom) {
            return _makeTransferFrom(from, to, value);
        }else {
            if(from == address(0)) {
                // mint
                return _makeMint(to, value);
            }else if(to == address(0)) {
                // burn
                return _makBurn(from, value);
            }else {
                return _makeNormalTransfer(from, to, value);
            }
        } 
    }

    // detailed function of _makeTransfer
    function _makeTransferFrom(address from, address to, uint64 value) internal virtual onlyInitialized returns(bool) {
        Request memory r = RequestBuilder.newRequest(
            msg.sender,              // Requester address
            6,                       // Number of operations
            address(this),           // Callback address
            this.callbackMakeTransfer.selector,  // Callback function
            ""                       // Payload
        );
        op loadCallerAllance = r.getEuint64(_allowances[from][msg.sender]);
        r.sub(loadCallerAllance, value);

        op loadSenderBalance = r.getEuint64(_balances[from]);
        r.sub(loadSenderBalance, value);
        op loadReceiverBalance = r.getEuint64(_balances[to]);
        r.add(loadReceiverBalance, value);

        latestReqId = oracle.send(r);
        _transferContexts[latestReqId] = TransferContext(from, to, uint8(3));
        _addressContexts[latestReqId] = msg.sender;

        return true;
    }

    function _makeMint(address to, uint64 value) internal virtual onlyInitialized returns(bool) {
        Request memory r = RequestBuilder.newRequest(
            msg.sender,              // Requester address
            2,                       // Number of operations
            address(this),           // Callback address
            this.callbackMakeTransfer.selector,  // Callback function
            ""                       // Payload
        );
        
        op loadReceiverBalance = r.getEuint64(_balances[to]);
        r.add(loadReceiverBalance, value);

        latestReqId = oracle.send(r);
        _transferContexts[latestReqId] = TransferContext(address(0), to, uint8(1));
        _supplyContexts[latestReqId] = value;

        return true;
    }

    function _makBurn(address from, uint64 value) internal virtual onlyInitialized returns(bool) {
        Request memory r = RequestBuilder.newRequest(
            msg.sender,              // Requester address
            2,                       // Number of operations
            address(this),           // Callback address
            this.callbackMakeTransfer.selector,  // Callback function
            ""                       // Payload
        );
        
        op loadSenderBalance = r.getEuint64(_balances[from]);
        r.sub(loadSenderBalance, value);

        latestReqId = oracle.send(r);
        _transferContexts[latestReqId] = TransferContext(from, address(0), uint8(2));
        _supplyContexts[latestReqId] = value;

        return true;
    }

    function _makeNormalTransfer(address from, address to, uint64 value) internal virtual onlyInitialized returns(bool) {
        Request memory r = RequestBuilder.newRequest(
            msg.sender,              // Requester address
            4,                       // Number of operations
            address(this),           // Callback address
            this.callbackMakeTransfer.selector,  // Callback function
            ""                       // Payload
        );            
        op loadSenderBalance = r.getEuint64(_balances[from]);
        r.sub(loadSenderBalance, value);
        op loadReceiverBalance = r.getEuint64(_balances[to]);
        r.add(loadReceiverBalance, value);

        latestReqId = oracle.send(r);
        _transferContexts[latestReqId] = TransferContext(from, to, uint8(0));

        return true;
    }

    function callbackMakeTransfer(bytes32 reqId, CapsulatedValue[] memory values) public onlyOracle {
        TransferContext memory transferContext = _transferContexts[reqId];
        if (transferContext.isSpecial == uint8(0)) {
            // normal transfer
            _balances[transferContext.sender] = values[1].asEuint64();
            _balances[transferContext.receiver] = values[3].asEuint64();
            emit Transfer(transferContext.sender, transferContext.receiver);
        } else if (transferContext.isSpecial == uint8(3)) {
            // transferFrom
            _balances[transferContext.sender] = values[3].asEuint64();
            _balances[transferContext.receiver] = values[5].asEuint64();
            _allowances[transferContext.sender][_addressContexts[reqId]] = values[1].asEuint64();
            delete _addressContexts[reqId];
            emit Transfer(transferContext.sender, transferContext.receiver);
        } else if (transferContext.isSpecial == uint8(1)) {
            // mint
            uint64 mintAmount = _supplyContexts[reqId];
            _totalSupply += mintAmount;
            _balances[transferContext.receiver] = values[1].asEuint64();
            delete _supplyContexts[reqId];
            emit Mint(transferContext.receiver, mintAmount);
        } else if (transferContext.isSpecial == uint8(2)) {
            // burn
            uint64 burnAmount = _supplyContexts[reqId];
            _totalSupply -= burnAmount;
            _balances[transferContext.sender] = values[1].asEuint64();
            delete _supplyContexts[reqId];
            emit Burn(transferContext.sender, burnAmount);
        }
        delete _transferContexts[reqId];
        emit OracleCallback(reqId); // for testing
    }

    modifier onlyOracle() {
        require(msg.sender == address(oracle), "Only Oracle Can Do This");
        _;
    }

    modifier onlyInitialized() {
        require(isInitialized, "Not initialized");
        _;
    }

}
