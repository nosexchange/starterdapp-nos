"use client";

// External library imports
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
import { useMemo, useRef, useState, useCallback, useEffect } from "react";
import { JsonView } from "react-json-view-lite";
import "react-json-view-lite/dist/index.css";
import crypto from "crypto";

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
  Array.from(uint8Array, (byte) => `0${(byte & 0xff).toString(16)}`.slice(-2)).join('');

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
    const signFn = async (message: Uint8Array) => ed25519.sign(message, privateKey);
    const sessionPublicKey = ed25519.getPublicKey(privateKey);
    return { sessionPublicKey, signFn };
  }
  throw new Error("No private key found");
};

/**
 * Retrieves existing session signing info or creates new if not found.
 * @returns An object containing the session public key and sign function.
 */
export const retrieveOrCreateSessionSigningInfo = async () => {
  try {
    return await retrieveSessionData();
  } catch (_) {
    await generateAndStoreTheKey();
    return await retrieveSessionData();
  }
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
        await nordUser.updateUserId();
        const res = await fetch(
          `https://staging-api.layern.network/account?user_id=${nordUser.userId}`
        );
        const data = await res.json();

        nordUser.balances = data.balances;
        nordUser.orders = data.orders;

        const publicKey = ed25519.getPublicKey(privateSessionKey);
        await nordUser.refreshSession(publicKey);

        setNordUser(nordUser);
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
   * Effect to initialize NordUser when wallet is connected.
   */
  useEffect(() => {
    if (!isConnected || !walletProvider || !nordClient) return;

    const getNordUser = async () => {
      const provider = new BrowserProvider(walletProvider);
      const signer = await provider.getSigner();

      const newNordUser = new NordUser({
        nord: nordClient,
        address,
        walletSignFn: (message: Uint8Array | string) =>
          signer.signMessage.call(signer, message),
        sessionSignFn: signFn,
      });

      // setNordUser(newNordUser);
    };

    getNordUser();
  }, [isConnected, walletProvider, nordClient, address, signFn]);

  /**
   * Handles user login and initialization.
   */
  const handleLogin = useCallback(async () => {
    if (!isConnected || !walletProvider) {
      console.log("Not connected");
      return;
    }

    
    if (nordUser?.sessionId) {
      setNordUser(null);
      localStorage.removeItem("privateKey");
      return;
    }


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

    await newNordUser.setPublicKey();

    try {
      await newNordUser.updateUserId();
    } catch (e) {
      if (e instanceof Error && e.message.includes("user not found")) {
        const url = `/api/fund?contractAddress=${
          newNordClient.contractAddress
        }&publicKey=${uint8ArrayToHexString(newNordUser.publicKey!)}`;
        await fetch(url);
        setNewUser(true);
        setNordUser(newNordUser);
        return;
      }
    }

    if (newUser) return;

    const res = await fetch(
      `https://staging-api.layern.network/account?user_id=${newNordUser.userId}`
    );
    const data = await res.json();

    newNordUser.balances = data.balances;
    newNordUser.orders = data.orders;

    const publicKey = ed25519.getPublicKey(privateSessionKey);
    await newNordUser.refreshSession(publicKey);

    setNordUser(newNordUser);
  }, [isConnected, walletProvider, address, signFn, newUser, privateSessionKey]);

  /**
   * Handles placing a new order.
   */
  const handlePlaceOrder = useCallback(async () => {
    if (!nordUser) return;

    const size = (document.getElementById("orderSize") as HTMLInputElement).value;
    const price = (document.getElementById("orderPrice") as HTMLInputElement).value;

    try {
      await nordUser.placeOrder({
        marketId: 0,
        side: Side.Bid,
        fillMode: FillMode.Limit,
        isReduceOnly: false,
        size,
        price,
      });

      const res = await fetch(
        `https://staging-api.layern.network/account?user_id=${nordUser.userId}`
      );
      const data = await res.json();
      nordUser.balances = data.balances;
      nordUser.orders = data.orders;
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
  const handleCancelOrder = useCallback(async (orderId: number) => {
    if (!nordUser) return;

    try {
      await nordUser.cancelOrder(orderId);
      const res = await fetch(
        `https://staging-api.layern.network/account?user_id=${nordUser.userId}`
      );
      const data = await res.json();

      nordUser.balances = data.balances;
      nordUser.orders = data.orders;
      setNordUser(nordUser);
      setStateBump((prev) => prev + 1);
    } catch (e) {
      console.error(`Error cancelling order ${orderId}:`, e);
    }
  }, [nordUser]);

  return (
    <Web3Modal>
      <main className="min-h-screen p-4 md:p-8 bg-gray-900 text-gray-100" key={stateBump}>
        <div className="w-full max-w-5xl mx-auto space-y-8">
          <div className="flex flex-row items-center justify-between font-mono text-lg">
            <w3m-button />
          </div>

          {isConnected && (
            <div className="flex flex-row items-center justify-center font-mono text-lg">
              <button
                className="bg-blue-600 text-white px-6 py-3 rounded-lg shadow-lg hover:bg-blue-700 transition duration-300"
                onClick={handleLogin}
              >
                {nordUser?.sessionId ? 'Logout' : 'Login'}
              </button>
            </div>
          )}
        </div>
        {isConnected && newUser && (
          <div className="flex flex-row items-center justify-center font-mono text-lg mt-8">
            <div className="bg-gray-800 text-gray-100 p-6 rounded-lg shadow-lg w-full max-w-md">
              <h2 className="text-2xl font-bold mb-4">Funding in Progress</h2>
              <p className="mb-4">Please wait while we complete the funding process. This may take a few minutes.</p>
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
                  <p className="text-sm">{`${nordUser.address.substring(0, 6)}...${nordUser.address.substring(nordUser.address.length - 4)}`}</p>
                </div>
                <div>
                  <p className="font-semibold">User ID:</p>
                  <p className="text-sm">{nordUser.userId}</p>
                </div>
                <div>
                  <p className="font-semibold">Session ID:</p>
                  <p className="text-sm">{nordUser.sessionId?.toString()}</p>
                </div>
              </div>
              
              <h3 className="text-xl font-bold mt-6 mb-2">Balances</h3>
              <div className="bg-gray-700 p-4 rounded-lg mb-6">
                {Array.isArray(nordUser.balances) && nordUser.balances.map((balance) => (
                  <div key={balance.tokenId} className="flex justify-between items-center mb-2">
                    <span>{balance.token}:</span>
                    <span className="font-semibold">{balance.amount}</span>
                  </div>
                ))}
              </div>

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
                {nordUser.orders && nordUser.orders.map((order, index) => (
                  <div key={index} className="bg-gray-700 p-4 rounded-lg flex justify-between items-center">
                    <div>
                      <p><strong>ID:</strong> {order.orderId}</p>
                      <p><strong>Market:</strong> {order.marketId}</p>
                      <p><strong>Side:</strong> {order.side}</p>
                      <p><strong>Size:</strong> {order.size}</p>
                      <p><strong>Price:</strong> {order.price}</p>
                    </div>
                    <button
                      className="bg-red-600 text-white px-4 py-2 rounded-lg shadow-lg hover:bg-red-700 transition duration-300"
                      onClick={() => handleCancelOrder(order.orderId)}
                    >
                      Cancel
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </main>
    </Web3Modal>
  );
}
