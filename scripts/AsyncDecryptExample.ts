import { BytesLike } from "ethers";
import hre from "hardhat";

import { abiCoder, explainCapsulatedValue } from "./utils";

async function main() {
  const AsyncDecryptExampleFactory = await hre.ethers.getContractFactory("AsyncDecryptExample");
  const example = await AsyncDecryptExampleFactory.deploy(process.env.ORACLE_CONTRACT_ADDRESS!);
  await example.waitForDeployment();
  console.log(`Contract Deployed At: ${await example.getAddress()}`);
  let result: any;
  let results: any[];
  let latestReqId: string;
  result = await example.result();
  results = await example.getResults();
  console.log(`result before asyncDecryptRandomEuint64: `, explainCapsulatedValue(result));
  console.log(
    `results before asyncDecryptRandomEuint64: `,
    results.map((result) => explainCapsulatedValue(result))
  );
  example.once(example.filters.OracleCallback, async (reqId, event) => {
    if (latestReqId === reqId) {
      result = await example.result();
      results = await example.getResults();
      console.log(`result after asyncDecryptRandomEuint64: `, explainCapsulatedValue(result));
      console.log(
        `results after asyncDecryptRandomEuint64: `,
        results.map((result: [BytesLike, bigint]) => explainCapsulatedValue(result))
      );
      let results_1 = abiCoder.decode(["uint64"], results[1].data)[0];
      let results_5 = abiCoder.decode(["uint64"], results[5].data)[0];
      let results_7 = abiCoder.decode(["uint64"], results[7].data)[0];
      let sumMod = (results_1 + results_5) % 2n ** 64n;
      if (sumMod == results_7) {
        console.log(`Result: (${results_1} + ${results_5})'s Mod(2**64) Value ${sumMod} == ${results_7} Is Correct.`);
      } else {
        console.error(`Result: (${results_1} + ${results_5})'s Mod(2**64) Value ${sumMod} == ${results_7} Not Matched`);
      }
    } else {
      console.error("NOT MATCHED reqId");
    }
  });
  const txResp = await example.asyncDecryptRandomEuint64();
  await txResp.wait(1);
  latestReqId = await example.latestReqId();
}

main();
