"use client";
import { ed25519 } from "@noble/curves/ed25519";
import {
  Nord,
  NordUser,
  ERC20_ABI,
  EVM_URL as NORD_EVM_URL,
  NORD_RAMP_FACET_ABI,
} from "@layer-n/nord-ts";
import { Web3Modal } from "./components/WalletModal";
import { BrowserProvider, JsonRpcProvider, Wallet } from "ethers";
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

const CONTRACT_ADDRESS = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS!;
const NORD_URL = process.env.NEXT_PUBLIC_NORD_URL;
const EVM_URL = process.env.NEXT_PUBLIC_EVM_URL;
const PROMETHEUS_URL = process.env.NEXT_PUBLIC_PROMETHEUS_URL;
const ROLLMAN_URL = process.env.NEXT_PUBLIC_ROLLMAN_URL;
const NORD_DEPLOYMENT = process.env.NEXT_PUBLIC_NORD_DEPLOYMENT;
const SECRET_FAUCET_RPC = process.env.NEXT_PUBLIC_SECRET_FAUCET_RPC;
const SECRET_FAUCET_PRIVATE_ADDRESS = process.env.NEXT_PUBLIC_SECRET_FAUCET_PRIVATE_ADDRESS;
const SECRET_FUNDING_AMOUNT = process.env.NEXT_PUBLIC_SECRET_FUNDING_AMOUNT;
const SECRET_FUNDING_PRECISION = process.env.NEXT_PUBLIC_SECRET_FUNDING_PRECISION;


const hexStringToUint8Array = (hexString: string) => {
  const bytes = []
  for (let i = 0; i < hexString.length; i += 2) {
    bytes.push(parseInt(hexString.substr(i, 2), 16))
  }
  return new Uint8Array(bytes)
}


// Function to generate key pair and store in localStorage
function generateRandomUint8Array(length: number) {
  const randomValues = new Uint8Array(length);
  window.crypto.getRandomValues(randomValues);
  return randomValues;
}

async function generateAndStoreTheKey() {
  const key = hexlify(generateRandomUint8Array(32));
  localStorage.setItem("privateKey", key);
}

// Function to retrieve key pair from localStorage
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
      nordDeployment: Number(NORD_DEPLOYMENT),
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

    console.log("recoveredPubKey", recoveredPubKey);
    console.log("pubkeyBuffer", publicKeyBuffer);
    console.log("compPubKey", compressedPublicKey);
    console.log("contract_address", CONTRACT_ADDRESS);

    //on boarding funding
    const __provider = new JsonRpcProvider(SECRET_FAUCET_RPC);
    const wallet = new Wallet(SECRET_FAUCET_PRIVATE_ADDRESS!, __provider);
    
    const nordContract = new Contract(
      CONTRACT_ADDRESS,
      NORD_RAMP_FACET_ABI,
      wallet,
    );

    const depositTx = await nordContract.depositUnchecked(
      hexStringToUint8Array(address),
      BigInt(0),
      parseUnits(Math.round((Math.random() * 0.1 + 1) * Number(SECRET_FUNDING_AMOUNT)).toString(), SECRET_FUNDING_PRECISION),
      {
        gasLimit: 1_000_000,
        maxFeePerGas: parseUnits("100", "gwei"),
        maxPriorityFeePerGas: parseUnits("0.01", "gwei"),
      },
    );

    console.log(depositTx.hash)  

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
