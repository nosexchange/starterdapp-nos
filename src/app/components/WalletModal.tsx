import { createWeb3Modal, defaultConfig } from '@web3modal/ethers/react'

// 1. Get projectId at https://cloud.walletconnect.com
const projectId = 'f8a080c00d55d6a910f9986d3a835492'

// 2. Set chains
const mainnet = {
	chainId: 31337,
	name: 'Anvil',
	currency: 'ETH',
	explorerUrl: 'https://etherscan.io',
	rpcUrl: process.env.NEXT_PUBLIC_EVM_URL!,
}

// 3. Create a metadata object
const metadata = {
	name: 'Nord',
	description: 'Layer N - Testnet',
	url: 'http://localhost:3000', // origin must match your domain & subdomain
	icons: [''],
}

// 4. Create Ethers config
const ethersConfig = defaultConfig({
	/* Required */
	metadata,

	/* Optional */
	enableEIP6963: true, // true by default
	enableInjected: true, // true by default
	enableCoinbase: true, // true by default
	rpcUrl: '...', // used for the Coinbase SDK
	defaultChainId: 1, // used for the Coinbase SDK
})

// 5. Create a Web3Modal instance
createWeb3Modal({
	ethersConfig,
	chains: [mainnet],
	projectId,
	enableAnalytics: true, // Optional - defaults to your Cloud configuration
	enableOnramp: true, // Optional - false as default
})

//@ts-ignore
export function Web3Modal({ children }) {
	return children
}