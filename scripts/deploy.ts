import { createInstance as SightCreateInstance, SightInstance } from "@sight-oracle/sightjs";
import { BytesLike, Signer, keccak256 } from "ethers";
import hre, { ethers } from "hardhat";
import { HttpNetworkUserConfig } from "hardhat/types";

import { abiCoder, explainCapsulatedValue, sleep } from "./utils";

async function main() {
  const localSightFHEVM: HttpNetworkUserConfig = hre.userConfig.networks!.localSightFHEVM! as HttpNetworkUserConfig;
  const provider = new ethers.JsonRpcProvider(localSightFHEVM.url);
  const ethers_wallet = ethers.Wallet.fromPhrase(process.env.MNEMONIC!, provider);

  // 获取合约工厂
  const BlockHeight = await ethers.getContractFactory("BlockHeight", [ethers_wallet]);

  // 部署合约
  const blockHeight = await BlockHeight.deploy();
  await blockHeight.waitForDeployment();

  console.log("BlockHeight deployed to:", await blockHeight.getAddress());
}

// 异步调用并处理异常
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
