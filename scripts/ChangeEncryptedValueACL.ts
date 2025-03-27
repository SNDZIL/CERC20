import hre from "hardhat";

import DecryptCapsulatedValueExampleModule from "../ignition/modules/DecryptCapsulatedValueExample";
import DecryptExampleModule from "../ignition/modules/DecryptExample";
import { explainCapsulatedValue } from "./utils";

async function main() {
  const accounts = await hre.ethers.getSigners();
  const oracleAddress = process.env.ORACLE_CONTRACT_ADDRESS!;
  const { DecryptCapsulatedValueExample: example } = await hre.ignition.deploy(DecryptCapsulatedValueExampleModule, {
    parameters: {
      DecryptCapsulatedValueExample: {
        oracleAddress
      }
    },
    config: {
      requiredConfirmations: 1
    }
  });
  console.log(`Contract Deployed At: ${example.target}`);
  const { DecryptExample: decryptExample } = await hre.ignition.deploy(DecryptExampleModule, {
    parameters: {
      DecryptExample: {
        oracleAddress
      }
    },
    config: {
      requiredConfirmations: 1
    }
  });
  console.log(`Contract DecryptExample Deployed At: ${decryptExample.target}`);
  let target: any;
  let latestReqId: string;
  target = await example.getTarget();
  console.log(`target before decryptCapsulatedValue: `, explainCapsulatedValue(target));
  target = await decryptExample.capsulatedValue();
  console.log(`DecryptExample's capsulatedValue before decryptCapsulatedValue: `, explainCapsulatedValue(target));
  const txRcpt = await (await decryptExample.shareACL(example.target, true)).wait();
  console.log(`Share DecryptExample ACL to ${example.target} ${txRcpt.status == 1 ? "success" : "failed"}`);
  console.log(`DecryptExample's callback addrs: ${JSON.stringify(await decryptExample.getACL())}`);

  // First, call decryptRandomEuint64() to generate and decrypt a random value
  console.log("Calling decryptRandomEuint64() to generate and decrypt a random value...");
  const decryptTx = await decryptExample.decryptRandomEuint64();
  await decryptTx.wait(1);
  latestReqId = await decryptExample.getLatestReqId();

  // Set up event listener for Oracle callback
  decryptExample.on(decryptExample.filters.OracleCallback, async (reqId, event) => {
    if (reqId === latestReqId) {
      console.log("Oracle callback received for decryptRandomEuint64");
      const capsValue = await decryptExample.capsulatedValue();
      console.log(`DecryptExample's capsulatedValue after callback: `, explainCapsulatedValue(capsValue));

      // Now that we have the capsulatedValue initialized, we can share it
      try {
        const txRcpt1 = await (await decryptExample.shareEncryptedValue(example.target, true)).wait();
        console.log(
          `Share DecryptExample capsulatedValue to ${example.target} as true: ${txRcpt1.status == 1 ? "success" : "failed"}`
        );
        console.log(
          `DecryptExample's capsulatedValue owners: ${JSON.stringify(await decryptExample.getEncryptedValueOwners())}`
        );

        // Continue with the example.decryptCapsulatedValue call
        console.log("Calling decryptCapsulatedValue with the initialized capsulatedValue...");

        // Properly format the CapsulatedValue struct as expected by the contract
        const formattedCapsValue = {
          data: capsValue[0],
          valueType: capsValue[1]
        };

        console.log("Formatted CapsulatedValue:", formattedCapsValue);

        const tx = await example.decryptCapsulatedValue(formattedCapsValue);
        await tx.wait(1);
        latestReqId = await example.getLatestReqId();
        console.log(`Sent decryptCapsulatedValue request with reqId: ${latestReqId}`);
      } catch (error) {
        console.error("Error sharing encrypted value:", error);
      }
    } else {
      console.error("NOT MATCHED reqId");
    }

    // Only remove this listener, keep the one for example
    decryptExample.off(decryptExample.filters.OracleCallback);
  });

  example.on(example.filters.OracleCallback, async (reqId, event) => {
    if (latestReqId === reqId) {
      target = await example.getTarget();
      console.log(`target after Oracle make callback: `, explainCapsulatedValue(target));
    } else {
      console.error("NOT MATCHED reqId");
    }
    example.off(example.filters.OracleCallback);
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
