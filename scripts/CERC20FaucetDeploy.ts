import { createInstance as SightCreateInstance, SightInstance } from "@sight-oracle/sightjs";
import { BytesLike, Signer, keccak256 } from "ethers";
import hre, { ethers } from "hardhat";
import { HttpNetworkUserConfig } from "hardhat/types";

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

  const CERC20FaucetFactory = await hre.ethers.getContractFactory("CERC20Faucet", [ethers_wallet]);
  const CERC20Contract = await CERC20FaucetFactory.deploy("MyCToken", "MCT", ORACLE_CONTRACT_ADDRESS, cipherZero);
  await CERC20Contract.waitForDeployment();
  console.log(`Contract Deployed At: ${await CERC20Contract.getAddress()}`);

  let initialValue: any;
  let result: any;
  let balance: any;
  let nextTest: boolean = false;
  let decryptBlance: any;
  let target: any;

  CERC20Contract.once(CERC20Contract.filters.InitializeOracleCallback, async () => {
    console.log("---------------------------Initialize---------------------------");
    initialValue = await CERC20Contract.getInitialValue();
    result = await CERC20Contract.getResult();
    console.log(`initialValue after Oracle make callback: `, initialValue);
    console.log(`Owner wallet: `, walletAddress);
  });
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
