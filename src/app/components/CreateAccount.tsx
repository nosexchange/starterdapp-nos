"use client";

import React, { useEffect, useState } from "react";
import { Nord, NordUser } from "@layer-n/nord-ts";
import { Token } from "@layer-n/nord-ts/dist/gen/nord";


const CreateAccount = ({ nordClient, nordUser }: { nordClient: Nord | null, nordUser: NordUser | null }) => {
  const [tokens,] = useState<any[]>(nordClient?.tokens || []);
  const [userTokens,] = useState<any[]>(Object.entries(nordUser?.balances || {}).map(([token, balance]) => ({ token: token, balance: balance })));
  const [filteredTokens, setFilteredTokens] = useState<any[]>([]);

    useEffect(() => {
        console.log("userTokens: ", userTokens);
        console.log("tokens: ", tokens);
    }, [userTokens, tokens]);


  const handleCreateAccount = async (token: string) => {
    if (token === "") {
      console.log("No token selected");
      return;
    }
    // Empty action for creating account
    console.log(`Create new account.`);
    const tokenId = tokens.find((t) => t.symbol === token)?.tokenId;
    console.log("tokenId: ", tokenId);
    if (tokenId != null && tokenId != undefined) {
      console.log("creating account for token: ", tokenId, token);
      const account = await nordUser?.createAccount({tokenId: tokenId, amount: 10});
      console.log("account created: ", account);
    }
  };

  return (
    <div className="p-4 bg-gray-800 rounded-lg shadow-md">
      <div className="flex items-center space-x-2">
        <label className="text-xl font-semibold mb-3 inline-block mr-2">Create Account</label>
        <select className="bg-gray-600 text-white px-3 py-1 rounded-md">
          {userTokens.map((token: any) => (
            <option key={token.token} value={token.token}>{token.token}</option>
          ))}
        </select>
        <button
          className="bg-blue-500 text-white px-3 py-1 rounded-md shadow-md hover:bg-blue-600 transition duration-300"
          onClick={() => handleCreateAccount(document.querySelector('select')?.value || '')}
        >
          Create
        </button>
      </div>
    </div>
  );
};

export default CreateAccount;
