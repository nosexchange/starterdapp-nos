"use client";
import { ed25519 } from "@noble/curves/ed25519";
import {
  Nord,
  NordUser,
  ERC20_ABI,
  NORD_RAMP_FACET_ABI,
  Side,
  FillMode,
  assert,
} from "@layer-n/nord-ts";
import { Web3Modal } from "./components/WalletModal";
import { BrowserProvider, JsonRpcProvider, Wallet } from "ethers";
import {
  useWeb3ModalAccount,
  useWeb3ModalProvider,
} from "@web3modal/ethers/react";
import { getBytes, hexlify } from "ethers";
import { useMemo, useRef, useState } from "react";

import ReactJson from "react-json-view";

const CONTRACT_ADDRESS = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS!;
const NORD_URL = process.env.NEXT_PUBLIC_NORD_URL;
const EVM_URL = process.env.NEXT_PUBLIC_EVM_URL;
const ROLLMAN_URL = process.env.NEXT_PUBLIC_ROLLMAN_URL;

const uint8ArrayToHexString = (uint8Array: Uint8Array) => {
  return Array.prototype.map
    .call(uint8Array, function (byte) {
      // eslint-disable-next-line no-bitwise
      return `0${(byte & 0xff).toString(16)}`.slice(-2);
    })
    .join("");
};

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
    await generateAndStoreTheKey();
    return await retrieveSessionData();
  }
}

export default function Home() {
  // State Variables
  const [nordUser, setNordUser] = useState<any>(null);
  const [nordClient, setNordClient] = useState<any>(null);
  const [newUser, setNewUser] = useState<boolean>(false);
  const [newUserInterval, setNewUserInterval] = useState<NodeJS.Timeout | null>(
    null
  );
  const [privateSessionKey, setPrivateSessionKey] = useState<Uint8Array>(
    generateRandomUint8Array(32)
  );
  const { isConnected, address } = useWeb3ModalAccount();
  const { walletProvider } = useWeb3ModalProvider();
  const interval = useRef<NodeJS.Timeout | null>(null);

  useMemo(async () => {
    // If we are a new user, set an interval to watch for funding
    // Once funded refresh the session data
    if (newUser) {
      console.log("new user, set interval to watch for funding");

      interval.current = setInterval(async () => {
        console.log("checking if user is funded");
        try {
          // This should work
          // await nordUser.updateUserId();
          const res = await fetch(
            NORD_URL +
              "/user_id?pubkey=" +
              uint8ArrayToHexString(nordUser.publicKey!)
          );
          if (res.status === 404) {
            console.log("user not funded");
          } else {
            console.log("user funded");
            clearInterval(newUserInterval!);
            setNewUser(false);

            // create new user session
            try {
              await nordUser.refreshSession(
                ed25519.getPublicKey(privateSessionKey)
              );
            } catch (e) {
              console.log(e);
            }
          }
        } catch (e) {
          if (e instanceof Error && e.message.includes("user not found")) {
            console.log("user not funded");
          } else {
            console.log("user found, stopping interval");
            clearInterval(newUserInterval!);
            setNewUser(false);

            // create new user session
            try {
              await nordUser.refreshSession(
                ed25519.getPublicKey(privateSessionKey)
              );
            } catch (e) {
              console.log(e);
            }
          }
        }
      }, 10000);
    }
  }, [newUser]);

  const buttonClick = async () => {
    if (!isConnected || !walletProvider) {
      console.log("not connected");
      return;
    }

    // Create a Nord client
    const nordClient = await new Nord({
      webServerUrl: NORD_URL!,
      nordUrl: NORD_URL!,
      evmUrl: EVM_URL!,
      rollmanUrl: ROLLMAN_URL!,
      contractAddress: CONTRACT_ADDRESS!,
      tokenInfos: [],
    });

    await nordClient.fetchNordInfo();
    setNordClient(nordClient);

    // do a wallet sign to get the public key
    const signFn = async (message: Uint8Array) => {
      return ed25519.sign(message, privateSessionKey);
    };

    const provider = new BrowserProvider(walletProvider);
    const signer = await provider.getSigner();

    const nordUser = new NordUser(
      nordClient,
      address,
      (message: Uint8Array | string) =>
        signer.signMessage.call(signer, message),
      signFn,
      -1,
      -1
    );

    await nordUser.setPublicKey();
    setNordUser(nordUser);

    try {
      console.log("updating user id");

      // This should work, but doesnt at the moment, using fetch instead
      // await nordUser.updateUserId();
      const res = await fetch(
        NORD_URL +
          "/user_id?pubkey=" +
          uint8ArrayToHexString(nordUser.publicKey!)
      );
      if (res.status === 404) {
        console.log("user not found, funding");
        const url = `/api/fund?contractAddress=${
          nordClient.contractAddress
        }&publicKey=${uint8ArrayToHexString(nordUser.publicKey!)}`;
        const response = await fetch(url);
        console.log(await response.json());
        setNewUser(true);
        return;
      }
    } catch (e) {
      if (e instanceof Error && e.message.includes("user not found")) {
        console.log("user not found, funding");
        const url = `/api/fund?contractAddress=${
          nordClient.contractAddress
        }&publicKey=${uint8ArrayToHexString(nordUser.publicKey!)}`;
        const response = await fetch(url);
        console.log(await response.json());
        setNewUser(true);
        return;
      }
    }

    console.log("nordUser", nordUser);
    console.log("privateSessionKey", privateSessionKey);
    // refresh session data
    console.log("refreshing session data");

    // Broken section here, refreshSession doesnt work, cannot create orders without a session
    // try {
    //   const publicKey = ed25519.getPublicKey(privateSessionKey);
    //   console.log("publicKey", publicKey, publicKey.length);
    //   console.log("trying ", "await nordUser.refreshSession(publicKey);");
    //   console.log(assert(publicKey.length === 32));
    //   debugger;
    //   await nordUser.refreshSession(publicKey);
    // } catch (e) {
    //   console.log(e);
    // }

    // Create an order
    // const order = await nordUser.placeOrder(
    //   0,
    //   Side.Bid,
    //   FillMode.FillOrKill,
    //   false,
    //   "1",
    //   "1000",
    // );
    // console.log("order: ", order);
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
