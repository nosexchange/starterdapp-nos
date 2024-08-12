"use client";
import { ed25519 } from "@noble/curves/ed25519";
import {
  Nord,
  NordUser,
  ERC20_ABI,
  NORD_RAMP_FACET_ABI,
} from "@layer-n/nord-ts";
import { Web3Modal } from "./components/WalletModal";
import { BrowserProvider, JsonRpcProvider } from "ethers";
import {
  useWeb3ModalAccount,
  useWeb3ModalProvider,
} from "@web3modal/ethers/react";
import {
  Contract,
  getBytes,
  hexlify,
  formatUnits,
  parseUnits,
  hashMessage,
  SigningKey,
} from "ethers";
import * as monkey from "secp256k1";
import { useState } from "react";

import ReactJson from "react-json-view";

const CONTRACT_ADDRESS = "0x87aEe89F96296DC7f89bd2Aa44E428e6419D7497";
const PROJECT_ID = "f8a080c00d55d6a910f9986d3a835492";
const NORD_URL = "https://api.layern.network";
const EVM_URL =
  "https://virtual.holesky.rpc.tenderly.co/a8423a65-dd6b-4042-89dd-4420307b38af";
const PROMETHEUS_URL = "https://api.layern.network";
const ROLLMAN_URL = "https://api.layern.network";
const NORD_DEPLOYMENT = 1;

const PrettyPrintJSON = ({ jsonData }) => {
  const prettyJSON = JSON.stringify(jsonData, null, 2);

  return (
    <pre>
      <code>{prettyJSON}</code>
    </pre>
  );
};

function generateRandomUint8Array(length: number) {
  const randomValues = new Uint8Array(length);
  window.crypto.getRandomValues(randomValues);
  return randomValues;
}

// Function to generate key pair and store in IndexedDB
async function generateAndStoreTheKey() {
  const key = hexlify(generateRandomUint8Array(32));
  localStorage.setItem("privateKey", key);
}

// Function to retrieve key pair from IndexedDB
async function retrieveSessionData(): Promise<{
  sessionPublicKey: Uint8Array;
  signFn: (message: Uint8Array) => Promise<Uint8Array>;
}> {
  const privateKeyHex = localStorage.getItem("privateKey")!;
  if (privateKeyHex !== undefined && privateKeyHex !== "") {
    const privateKey = getBytes(privateKeyHex);
    const signFn = async (message: Uint8Array) => {
      return ed25519.sign(message, privateKey);
    };

    const sessionPublicKey = ed25519.getPublicKey(privateKey);
    return {
      sessionPublicKey,
      signFn,
    };
  }
  throw new Error();
}

export async function retrieveOrCreateSessionSigningInfo(): Promise<{
  sessionPublicKey: Uint8Array;
  signFn: (message: Uint8Array) => Promise<Uint8Array>;
}> {
  try {
    return await retrieveSessionData();
  } catch (_) {
    console.log(_);
    await generateAndStoreTheKey();
    return await retrieveSessionData();
  }
}

export default function Home() {
  // State Variables
  const [nordUser, setNordUser] = useState<any>(null);
  const [nordClient, setNordClient] = useState<any>(null);
  const [userBalances, setUserBalances] = useState<any>(null);

  const { isConnected, address } = useWeb3ModalAccount();
  const { walletProvider } = useWeb3ModalProvider();

  const buttonClick = async () => {
    console.log("click");
    const { signFn, sessionPublicKey } =
      await retrieveOrCreateSessionSigningInfo();

    // Create a Nord client
    const nordClient = await new Nord({
      nordUrl: NORD_URL!,
      evmUrl: EVM_URL!,
      prometheusUrl: PROMETHEUS_URL!,
      rollmanUrl: ROLLMAN_URL!,
      nordDeployment: NORD_DEPLOYMENT,
    });

    const provider = new JsonRpcProvider(EVM_URL);
    const signer = await provider.getSigner();

    const nordUser = await new NordUser(
      nordClient,
      address,
      (message: Uint8Array | string) =>
        signer.signMessage.call(signer, message),
      signFn
    );
    await nordUser.fetchInfo();
    console.log(nordUser);

    setNordUser(nordUser);

    await nordClient.fetchNordInfo();
    console.log(nordClient);

    setNordClient(nordClient);

    // UPDATE BALANCES
    if (!isConnected) {
      console.log("not connected");
      return;
    }
    let balances = [];
    for (const tokenInfo of nordClient.tokenInfos) {
      const erc20Contract = new Contract(
        tokenInfo.address,
        ERC20_ABI,
        provider
      );
      const ercBalance = Number(
        formatUnits(await erc20Contract.balanceOf(address))
      );

      balances.push({
        name: tokenInfo.name.toLowerCase(),
        balance: ercBalance * 10 ** (18 - tokenInfo.precision),
      });
    }

    const ethBalance = Number(formatUnits(await provider.getBalance(address)));
    balances.push({ name: "eth", balance: ethBalance });

    console.log("balances");
    console.log(balances);

    setUserBalances(balances);

    if (!walletProvider) {
      console.log("no wallet provider");
      return;
    }
    // do a signing to get publicKeyBuffer (maybe we can get this from another way )
    const _provider = new BrowserProvider(walletProvider);
    const _signer = await _provider.getSigner();
    const message = "Hello dapp";
    const msgHash = hashMessage(message);
    const msgHashBytes = getBytes(msgHash);
    const signature = await _signer.signMessage(message);
    const recoveredPubKey = SigningKey.recoverPublicKey(
      msgHashBytes,
      signature
    );
    const publicKeyBuffer = Buffer.from(recoveredPubKey.slice(2), "hex"); // Remove '0x' prefix and convert to Buffer
    const compressedPublicKey = monkey.publicKeyConvert(publicKeyBuffer, true);

    console.log("pubkeyBuffer", publicKeyBuffer);
    console.log("compPubKey", compressedPublicKey);
    console.log("contract_address", CONTRACT_ADDRESS);

    //on boarding approve and funding
    const erc20Contract = new Contract(
      nordClient.tokenInfos[0].address,
      ERC20_ABI,
      await provider.getSigner()
    );

    const approveTx = await erc20Contract.approve(
      CONTRACT_ADDRESS,
      parseUnits("10000", 6),
      { gasLimit: 1000000 }
    );
    console.log(await approveTx.wait());

    const nordContract = new Contract(
      CONTRACT_ADDRESS,
      NORD_RAMP_FACET_ABI,
      await provider.getSigner()
    );
    const depositTx = await nordContract.depositUnchecked(
      compressedPublicKey,
      BigInt(0),
      parseUnits("10000", 6),
      { gasLimit: 1000000 }
    );
    console.log(await depositTx.wait());
  };

  return (
    <Web3Modal>
      <main className="min-h-screen p-4 md:p-8">
        <div className="w-full max-w-5xl mx-auto space-y-4">
          <div className="flex flex-row items-center justify-between font-mono text-sm">
            <w3m-button />
          </div>
          <div className="flex flex-row items-center justify-between font-mono text-sm">
            <button className="border" onClick={buttonClick}>
              Action
            </button>
          </div>

          {nordUser && (
            <div className="flex flex-row items-center justify-between font-mono text-sm">
              <h2>Nord User Data</h2>
              <ReactJson src={nordUser} collapsed={true} />
            </div>
          )}

          {userBalances && (
            <div className="flex flex-row items-center justify-between font-mono text-sm">
              <h2>User Balances</h2>
              <ReactJson src={userBalances} collapsed={true} />
            </div>
          )}

          {nordClient && (
            <div className="flex flex-row items-center justify-between font-mono text-sm">
              <h2>Nord Client Data</h2>
              <ReactJson src={nordClient} collapsed={true} />
            </div>
          )}
        </div>
      </main>
    </Web3Modal>
  );
}
