import React, { useState, useEffect } from 'react';
import { NordUser } from '@layer-n/nord-ts';
interface AccountSwitcherProps {
  nordUser: NordUser;
  setAccountId: (id: number) => void;
}

const AccountSwitcher: React.FC<AccountSwitcherProps> = ({ nordUser, setAccountId }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedAccountId, setSelectedAccountId] = useState<number | undefined>(undefined)
  
  useEffect(() => {
    setSelectedAccountId(nordUser.accountIds?.[0]);
  }, [nordUser])

  const handleAccountChange = (id: number) => {
    setSelectedAccountId(id);
    setAccountId(id);
    setIsOpen(false);
  };

  const handleAddAccount = () => {
    console.log("add account");
  };

  return (
    <div className="relative inline-block text-left">
      <div>
        <button
          type="button"
          className="inline-flex justify-center w-full rounded-md border border-gray-700 shadow-sm px-4 py-2 bg-gray-800 text-sm font-medium text-white hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
          onClick={() => setIsOpen(!isOpen)}
        >
          {selectedAccountId}
          <svg
            className="-mr-1 ml-2 h-5 w-5"
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
              clipRule="evenodd"
            />
          </svg>
        </button>
      </div>

      {isOpen && (
        <div className="origin-top-right absolute right-0 mt-2 w-56 rounded-md shadow-lg bg-gray-800 ring-1 ring-black ring-opacity-5">
          <div className="py-1" role="menu" aria-orientation="vertical" aria-labelledby="options-menu">
            {nordUser.accountIds?.map((id) => (
              <button
                key={id}
                onClick={() => handleAccountChange(id)}
                className="block px-4 py-2 text-sm text-white hover:bg-gray-700 w-full text-left"
                role="menuitem"
              >
                {id}
              </button>
            ))}
            <hr className="border-gray-700" />
            <button
              onClick={handleAddAccount}
              className="block px-4 py-2 text-sm text-white hover:bg-gray-700 w-full text-left"
              role="menuitem"
            >
              +Add new account
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default AccountSwitcher;

