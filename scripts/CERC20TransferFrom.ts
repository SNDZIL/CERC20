import { createInstance as SightCreateInstance, SightInstance } from "@sight-oracle/sightjs";
import { TIMEOUT } from "dns";
import { BytesLike, Signer, keccak256 } from "ethers";
import hre, { ethers } from "hardhat";
import { HttpNetworkUserConfig } from "hardhat/types";
import { question } from "readline-sync";

import { ConfidentialERC20 } from "../typechain-types/contracts/ConfidentialERC20";
import { abiCoder, explainCapsulatedValue, sleep } from "./utils";

const ORACLE_CONTRACT_ADDRESS = process.env.ORACLE_CONTRACT_ADDRESS!;
const FHE_LIB_ADDRESS = "0x000000000000000000000000000000000000005d";

async function main() {
  const localSightFHEVM: HttpNetworkUserConfig = hre.userConfig.networks!.localSightFHEVM! as HttpNetworkUserConfig;
  const provider = new ethers.JsonRpcProvider(localSightFHEVM.url);
  const ethers_wallet = ethers.Wallet.fromPhrase(process.env.MNEMONIC!, provider);
  const walletAddress = ethers_wallet.getAddress();
  const user1 = ethers.Wallet.createRandom(provider);
  const user1Address = user1.getAddress();
  // 1. Get chain id
  let chainId: number;
  let publicKey: string | undefined;
  // const provider = hre.ethers.provider;

  const network1 = await provider.getNetwork();
  chainId = +network1.chainId.toString(); // Need to be a number
  try {
    // Get blockchain public key
    const ret = await provider.call({
      to: FHE_LIB_ADDRESS,
      // first four bytes of keccak256('fhePubKey(bytes1)') + 1 byte for library
      data: "0xd9d47bb001"
    });
    console.log(`fhe-publicKey size/keccak256:`, ret.length, keccak256(ret));
    const decoded = hre.ethers.AbiCoder.defaultAbiCoder().decode(["bytes"], ret);
    publicKey = decoded[0];
  } catch (e) {
    console.error(e);
    publicKey = undefined;
  }
  // Get public key to perform encryption
  const sightInstance = await SightCreateInstance({
    chainId: hre.network.config.chainId!,
    publicKey
  });
  await generatePublicKey(ORACLE_CONTRACT_ADDRESS, ethers_wallet, sightInstance);
  // This will be used in Compute Proxy
  const token = sightInstance.getPublicKey(ORACLE_CONTRACT_ADDRESS);
  if (!token) {
    console.error("null token!");
    return;
  }
  // crypted 0 for initialization
  let Uint64Zero = BigInt(0);
  const cipherZero = sightInstance.encrypt64(Uint64Zero);
  // console.log(`Uint64Zero: `, Uint64Zero);
  // console.log(`cipherZero: `, cipherZero);
  let initialValue: any;
  let result: any;
  let results: any[];
  let latestReqId: string;
  let balance: any;
  let nextTest: boolean = false;
  let userBalance: any;
  let decryptBlance: any;
  let approve: any;

  // Fund user wallet
  console.log("---------------------------Fund user wallet---------------------------");
  userBalance = await provider.getBalance(user1.address);
  console.log(`user ETH before fund: `, userBalance);
  const tx = await ethers_wallet.sendTransaction({
    to: user1Address,
    value: BigInt(100000000000000)
  });
  await tx.wait();
  userBalance = await provider.getBalance(user1.address);
  console.log(`user ETH after fund: `, userBalance);

  const CERC20Factory = await hre.ethers.getContractFactory("ConfidentialERC20", [ethers_wallet]);
  const CERC20Contract = await CERC20Factory.deploy("MyCToken", "MCT", ORACLE_CONTRACT_ADDRESS, cipherZero);
  await CERC20Contract.waitForDeployment();
  console.log(`Contract Deployed At: ${await CERC20Contract.getAddress()}`);

  CERC20Contract.once(CERC20Contract.filters.InitializeOracleCallback, async (reqId, event) => {
    console.log("---------------------------Initialize---------------------------");
    initialValue = await CERC20Contract.getInitialValue();
    result = await CERC20Contract.getResult();
    console.log(`initialValue after Oracle make callback: `, initialValue);
    console.log(`result after Oracle make callback: `, result);
    balance = await CERC20Contract.balanceOf(walletAddress);
    console.log("-----------------------Mint 1000000000 to owner-----------------------");
    console.log(`owner balance(euint64) before mint callback: `, balance);
    CERC20Contract.mint(BigInt(1000));
  });

  CERC20Contract.once(CERC20Contract.filters.OracleCallback, async (reqId, event) => {
    const totalsuply = await CERC20Contract.getTotalSupply();
    balance = await CERC20Contract.balanceOf(walletAddress);
    userBalance = await CERC20Contract.balanceOf(user1Address);
    console.log(`totalsuply after mint callback: `, totalsuply);
    console.log(`owner balance(euint64) after burn callback: `, balance);
    console.log("-------------------------Approve 10000 to user---------------------------");
    approve = await CERC20Contract.getAllowance(walletAddress, walletAddress);
    console.log(`user allowance(euint64) before approve: ${approve}`);
    CERC20Contract.approve(walletAddress, 10000);
    nextTest = true;
  });

  while (!nextTest) {
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  nextTest = false;

  CERC20Contract.once(CERC20Contract.filters.OracleCallback, async (reqId, event) => {
    approve = await CERC20Contract.getAllowance(walletAddress, walletAddress);
    console.log(`user allowance(euint64) after approve: ${approve}`);
    console.log("-------------------user spend 5000 from owner's wallet---------------------");
    // CERC20Contract.connect(user1).transferFrom(walletAddress, walletAddress, 5000);
    CERC20Contract.transferFrom(walletAddress, walletAddress, 5000);
    nextTest = true;
  });

  while (!nextTest) {
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  nextTest = false;

  CERC20Contract.once(CERC20Contract.filters.Transfer, async (sender, receiver) => {
    balance = await CERC20Contract.balanceOf(walletAddress);
    console.log(`owner balance(euint64) after this spending: ${balance}`);
    approve = await CERC20Contract.getAllowance(walletAddress, walletAddress);
    console.log(`user allowance(euint64) before approve: ${approve}`);
    nextTest = true;
  });

  // while (!nextTest) {
  //   await new Promise((resolve) => setTimeout(resolve, 500));
  // }
  // nextTest = false;

  // CERC20Contract.once(CERC20Contract.filters.OracleCallback, async (reqId, event) => {
  //   approve = await CERC20Contract.getAllowance(walletAddress, user1Address);
  //   console.log(`user allowance(euint64) after approve: ${approve}`);
  // });
}

const generatePublicKey = async (contractAddress: string, signer: Signer, instance: SightInstance) => {
  // Generate token to decrypt
  const generatedToken = instance.generatePublicKey({
    verifyingContract: contractAddress
  });
  // Sign the public key
  const signature = await signer.signTypedData(
    generatedToken.eip712.domain,
    { Reencrypt: generatedToken.eip712.types.Reencrypt }, // Need to remove EIP712Domain from types
    generatedToken.eip712.message
  );
  instance.setSignature(contractAddress, signature);
};

main();
