"use client";

// External library imports
import { ed25519 } from "@noble/curves/ed25519";
import { Nord, NordUser, Side, FillMode } from "@layer-n/nord-ts";
import { Web3Modal } from "./components/WalletModal";
import { BrowserProvider } from "ethers";
import {
  useWeb3ModalAccount,
  useWeb3ModalProvider,
} from "@web3modal/ethers/react";
import { getBytes, hexlify } from "ethers";
import { useRef, useState, useCallback, useEffect } from "react";
import crypto from "crypto";
import CreateAccount from "./components/CreateAccount";
import AccountSwitcher from "./components/AccountSwitcher";

// Environment variables
const CONTRACT_ADDRESS = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS!;
const NORD_URL = process.env.NEXT_PUBLIC_NORD_URL;
const EVM_URL = process.env.NEXT_PUBLIC_EVM_URL;

/**
 * Converts a Uint8Array to a hexadecimal string.
 * @param uint8Array - The Uint8Array to convert.
 * @returns The hexadecimal string representation.
 */
const uint8ArrayToHexString = (uint8Array: Uint8Array) =>
  Array.from(uint8Array, (byte) =>
    `0${(byte & 0xff).toString(16)}`.slice(-2)
  ).join("");

/**
 * Generates random values for a given buffer.
 * Uses crypto.getRandomValues in browser environments and crypto.randomFillSync in Node.js.
 * @param buffer - The buffer to fill with random values.
 * @returns The buffer filled with random values.
 */
const getRandomValues = (buffer: Uint8Array) =>
  typeof window !== "undefined" && window.crypto
    ? window.crypto.getRandomValues(buffer)
    : crypto.randomFillSync(buffer);

/**
 * Generates a random Uint8Array of specified length.
 * @param length - The length of the array to generate.
 * @returns A new Uint8Array filled with random values.
 */
const generateRandomUint8Array = (length: number) => {
  const randomValues = new Uint8Array(length);
  getRandomValues(randomValues);
  return randomValues;
};

/**
 * Generates and stores a new private key in local storage.
 */
const generateAndStoreTheKey = async () => {
  const key = hexlify(generateRandomUint8Array(32));
  localStorage.setItem("privateKey", key);
};

/**
 * Retrieves session data from local storage.
 * @returns An object containing the session public key and sign function.
 * @throws Error if no private key is found in local storage.
 */
const retrieveSessionData = async (): Promise<{
  sessionPublicKey: Uint8Array;
  signFn: (message: Uint8Array) => Promise<Uint8Array>;
}> => {
  const privateKeyHex = localStorage.getItem("privateKey");
  if (privateKeyHex) {
    const privateKey = getBytes(privateKeyHex);
    const signFn = async (message: Uint8Array) =>
      ed25519.sign(message, privateKey);
    const sessionPublicKey = ed25519.getPublicKey(privateKey);
    return { sessionPublicKey, signFn };
  }
  throw new Error("No private key found");
};

/**
 * Main component for the Nord trading interface.
 */
export default function Home() {
  // State management
  const [nordUser, setNordUser] = useState<NordUser | null>(null);
  const [nordClient, setNordClient] = useState<Nord | null>(null);
  const [newUser, setNewUser] = useState(false);
  const [privateSessionKey] = useState(() => generateRandomUint8Array(32));
  const { isConnected, address } = useWeb3ModalAccount();
  const { walletProvider } = useWeb3ModalProvider();
  const [stateBump, setStateBump] = useState(0);
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null);

  const interval = useRef<NodeJS.Timeout | null>(null);

  /**
   * Sign function for session-based operations.
   */
  const signFn = useCallback(
    async (message: Uint8Array) => ed25519.sign(message, privateSessionKey),
    [privateSessionKey]
  );

  /**
   * Effect to handle funding check for new users.
   */
  useEffect(() => {
    if (!walletProvider || !newUser || !nordUser) return;

    const checkFunding = async () => {
      try {
        await nordUser.updateAccountId();
        await nordUser.fetchInfo();

        const publicKey = ed25519.getPublicKey(privateSessionKey);
        await nordUser.refreshSession(publicKey);

        setNordUser(nordUser);
        if (nordUser.accountIds?.[0]) {
          setSelectedAccountId(nordUser.accountIds?.[0]);
        }
        setNewUser(false);
      } catch (e) {
        console.error("Error checking funding:", e);
      }
    };

    interval.current = setInterval(checkFunding, 10000);

    return () => {
      if (interval.current) clearInterval(interval.current);
    };
  }, [newUser, nordUser, privateSessionKey, walletProvider]);

  /**
   * Handles user login and initialization.
   */
  const handleLogin = useCallback(async () => {
    if (!isConnected || !walletProvider || !address) {
      console.log("Not connected");
      return;
    }

    // this is logout
    if (nordUser?.sessionId) {
      setNordUser(null);
      localStorage.removeItem("privateKey");
      return;
    }

    // this is login
    const newNordClient = await new Nord({
      webServerUrl: NORD_URL!,
      evmUrl: EVM_URL!,
      contractAddress: CONTRACT_ADDRESS!,
      tokenInfos: [],
    });

    await newNordClient.fetchNordInfo();
    setNordClient(newNordClient);

    const provider = new BrowserProvider(walletProvider);
    const signer = await provider.getSigner();

    const newNordUser = new NordUser({
      nord: newNordClient,
      address,
      walletSignFn: (message: Uint8Array | string) =>
        signer.signMessage.call(signer, message),
      sessionSignFn: signFn,
    });

    console.log("set public key");
    await newNordUser.setPublicKey();
    console.log("nord user set public key", newNordUser);

    try {
      console.log("update account id");
      await newNordUser.updateAccountId();
      console.log("nord user update account id", newNordUser);
    } catch (e) {
      if (e instanceof Error && e.message.includes("USER_NOT_FOUND")) {
        console.log("user not found");

        // first approve the contract to spend the user's tokens (this is a check and approve)
        let url = `/api/approve?address=${address}`;
        let resp = await fetch(url);
        console.log("approve response", resp);

        // wait 5 seconds for the approve to be processed
        await new Promise((resolve) => setTimeout(resolve, 5000));

        // fund the user
        url = `/api/fund?publicKey=${uint8ArrayToHexString(newNordUser.publicKey!)}`;
        resp = await fetch(url);
        console.log("funding response", resp);

        setNewUser(true);
        setNordUser(newNordUser);
        return;
      }
    }

    // if the user is new, we need to fund them
    if (newUser) return;

    // fetch the user's info
    await newNordUser.fetchInfo();
    setNordUser(newNordUser);

    // refresh the session
    const publicKey = ed25519.getPublicKey(privateSessionKey);
    try {
      await newNordUser.refreshSession(publicKey);
    } catch (e) {
      if (e instanceof Error && e.message.includes("USER_NOT_FOUND")) {
        console.log("User not found during session refresh. Funding the user.");

        // first approve the contract to spend the user's tokens (this is a check and approve)
        let url = `/api/approve?address=${address}`;
        let resp = await fetch(url);
        console.log("approve response", await resp.json());

        // wait 5 seconds for the approve to be processed
        await new Promise((resolve) => setTimeout(resolve, 5000));

        // fund the user
        url = `/api/fund?publicKey=${uint8ArrayToHexString(newNordUser.publicKey!)}`;
        resp = await fetch(url);
        console.log("funding response", await resp.json());
        setNewUser(true);
        setNordUser(newNordUser);
        return;
      }
      console.error("Error refreshing session:", e);
    }

    setNordUser(newNordUser);
    setStateBump((prev) => prev + 1);
  }, [
    isConnected,
    walletProvider,
    nordUser?.sessionId,
    address,
    signFn,
    newUser,
    privateSessionKey,
  ]);

  /**
   * Handles placing a new order.
   */
  const handlePlaceOrder = useCallback(async () => {
    if (!nordUser || !nordUser.accountIds) return;

    const size = (document.getElementById("orderSize") as HTMLInputElement)
      .value;
    const price = (document.getElementById("orderPrice") as HTMLInputElement)
      .value;

    try {
      const _order = {
        marketId: 0,
        side: Side.Bid,
        fillMode: FillMode.Limit,
        isReduceOnly: false,
        size,
        price,
        accountId: nordUser.accountIds?.[0],
      }

      console.log("placing order", _order);

      await nordUser.placeOrder(_order);

      await nordUser.fetchInfo();
      setNordUser(nordUser);
      setStateBump((prev) => prev + 1);
    } catch (e) {
      console.error("Error placing order:", e);
    }
  }, [nordUser]);

  /**
   * Handles cancelling an existing order.
   * @param orderId - The ID of the order to cancel.
   */
  const handleCancelOrder = useCallback(
    async (orderId: number) => {
      if (!nordUser) return;

      try {
        if (!nordUser.accountIds?.[0]) return;
        await nordUser.cancelOrder(orderId, nordUser.accountIds?.[0]);
        await nordUser.fetchInfo();

        setNordUser(nordUser);
        setStateBump((prev) => prev + 1);
      } catch (e) {
        console.error(`Error cancelling order ${orderId}:`, e);
      }
    },
    [nordUser]
  );

  console.log("nordUser", nordUser);

  return (
    <Web3Modal>
      <main
        className="min-h-screen p-4 md:p-8 bg-gray-900 text-gray-100"
        key={stateBump}
      >
        <div className="w-full max-w-5xl mx-auto space-y-8">
          <div className="flex flex-row items-center justify-between font-mono text-lg">
            <w3m-button />
            <AccountSwitcher nordUser={nordUser} setAccountId={setSelectedAccountId} />
          </div>

          {isConnected && (
            <div className="flex flex-row items-center justify-center font-mono text-lg">
              <button
                className="bg-blue-600 text-white px-6 py-3 rounded-lg shadow-lg hover:bg-blue-700 transition duration-300"
                onClick={handleLogin}
              >
                {nordUser?.sessionId ? "Logout" : "Login"}
              </button>
            </div>
          )}
        </div>
        {isConnected && newUser && (
          <div className="flex flex-row items-center justify-center font-mono text-lg mt-8">
            <div className="bg-gray-800 text-gray-100 p-6 rounded-lg shadow-lg w-full max-w-md">
              <h2 className="text-2xl font-bold mb-4">Funding in Progress</h2>
              <p className="mb-4">
                Please wait while we complete the funding process. This may take
                a few minutes.
              </p>
              <div className="flex justify-center">
                <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div>
              </div>
            </div>
          </div>
        )}
        {isConnected && nordUser && !newUser && (
          <div className="flex flex-row items-center justify-center font-mono text-lg mt-8">
            <div className="bg-gray-800 text-gray-100 p-6 rounded-lg shadow-lg w-full max-w-2xl">
              <h2 className="text-2xl font-bold mb-4">User Dashboard</h2>
              <div className="grid grid-cols-2 gap-4 mb-6">
                <div>
                  <p className="font-semibold">Address:</p>
                  <p className="text-sm">{`${nordUser.address.substring(
                    0,
                    6
                  )}...${nordUser.address.substring(
                    nordUser.address.length - 4
                  )}`}</p>
                </div>
                <div>
                  <p className="font-semibold">User ID:</p>
                  <p className="text-sm">{nordUser.accountIds?.[0]}</p>
                </div>
                <div>
                  <p className="font-semibold">Session ID:</p>
                  <p className="text-sm">{nordUser.sessionId?.toString()}</p>
                </div>
              </div>

              <h3 className="text-xl font-bold mt-6 mb-2">Balances</h3>
              <div className="bg-gray-700 p-4 rounded-lg mb-6">
               
              </div>

              {/*
              <h3 className="text-xl font-bold mt-6 mb-2">Positions</h3>
              <div className="bg-gray-700 p-4 rounded-lg mb-6">
                {
                  Object.entries(nordUser.positions).map(([token, position]) => (
                    <div
                      key={token}
                      className="flex justify-between items-center mb-2"
                    >
                      <span>{token}:</span>
                      <span className="font-semibold">{balance}</span>
                    </div>
                  ))}
              </div>
               */}

              <h3 className="text-xl font-bold mt-6 mb-2">Place Order</h3>
              <div className="bg-gray-700 p-4 rounded-lg mb-6">
                <div className="flex flex-col space-y-4">
                  <input
                    type="text"
                    placeholder="Size (BTC)"
                    className="bg-gray-600 text-white px-4 py-2 rounded-lg"
                    id="orderSize"
                    defaultValue="0.01"
                  />
                  <input
                    type="text"
                    placeholder="Price (USD)"
                    className="bg-gray-600 text-white px-4 py-2 rounded-lg"
                    id="orderPrice"
                    defaultValue="0.1"
                  />
                  <button
                    className="bg-green-600 text-white px-4 py-2 rounded-lg shadow-lg hover:bg-green-700 transition duration-300"
                    onClick={handlePlaceOrder}
                  >
                    Place Order
                  </button>
                </div>
              </div>

              <h3 className="text-xl font-bold mt-6 mb-2">Active Orders</h3>
              <div className="space-y-4">
                {/* {nordUser.orders &&
                  nordUser.orders.filter(order => order.accountId === selectedAccountId).map((order, index) => (
                    <div
                      key={index}
                      className="bg-gray-700 p-4 rounded-lg flex justify-between items-center"
                    >
                      <div>
                        <p>
                          <strong>ID:</strong> {order.orderId}
                        </p>
                        <p>
                          <strong>Market:</strong> {order.marketId}
                        </p>
                        <p>
                          <strong>Side:</strong>{" "}
                          {order.isLong ? "Long" : "Short"}
                        </p>
                        <p>
                          <strong>Size:</strong> {order.size}
                        </p>
                        <p>
                          <strong>Price:</strong> {order.price}
                        </p>
                      </div>
                      <button
                        className="bg-red-600 text-white px-4 py-2 rounded-lg shadow-lg hover:bg-red-700 transition duration-300"
                        onClick={() => handleCancelOrder(order.orderId)}
                      >
                        Cancel
                      </button>
                    </div>
                  ))} */}
              </div>
            </div>
          </div>
        )}
      </main>
    </Web3Modal>
  );
}
