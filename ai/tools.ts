import { tool as createTool } from "ai";
import { z } from "zod";
import { publicClient } from "@/wagmi.config";
import { 
 formatEther, 
 parseEther, 
 http, 
 Hex, 
 Address, 
 encodeFunctionData 
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import {
 DelegationFramework,
 SINGLE_DEFAULT_MODE,
 createExecution,
 Implementation,
 toMetaMaskSmartAccount,
 getDelegationHashOffchain,
 type DelegationStruct
} from "@metamask-private/delegator-core-viem";
import {
 createBundlerClient,
 createPaymasterClient,
} from "viem/account-abstraction";
import { 
 FACTORY_CONTRACT_ADDRESS, 
 FACTORY_ABI, 
 BUNDLER_URL, 
 CHAIN_ID 
} from "@/constants";

// Define Linea Sepolia network configuration
export const lineaSepolia = {
 id: 59141,
 name: 'Linea Sepolia',
 network: 'linea-sepolia',
 nativeCurrency: {
   decimals: 18,
   name: 'Linea Ether',
   symbol: 'ETH',
 },
 rpcUrls: {
   public: { http: ['https://rpc.sepolia.linea.build'] },
   default: { http: ['https://rpc.sepolia.linea.build'] },
 },
 blockExplorers: {
   etherscan: { name: 'Lineascan', url: 'https://sepolia.lineascan.build' },
   default: { name: 'Lineascan', url: 'https://sepolia.lineascan.build' },
 },
};

// Select the appropriate chain based on CHAIN_ID
const selectedChain = CHAIN_ID === 59141 ? lineaSepolia : sepolia;

// Initialize bundler client if URL is available
const bundlerClient = BUNDLER_URL 
 ? createBundlerClient({
     transport: http(BUNDLER_URL),
     chain: selectedChain,
     paymaster: createPaymasterClient({
       transport: http(BUNDLER_URL),
     }),
   })
 : null;

// Helper function to safely access storage (works in browser and server contexts)
const getStorageItem = (key: string): string | null => {
 if (typeof window !== 'undefined' && window.sessionStorage) {
   return sessionStorage.getItem(key);
 }
 return null;
};

// Helper function to parse delegation with proper BigInt handling
const parseDelegation = (delegationStr: string): DelegationStruct => {
 const parsed = JSON.parse(delegationStr);
 
 // Handle BigInt values
 return {
   ...parsed,
   salt: BigInt(parsed.salt),
   // Any other BigInt fields that need to be reconstructed
 };
};

// Get the appropriate block explorer URL based on the selected chain
const getExplorerUrl = (transactionHash: string): string => {
 const baseUrl = selectedChain.blockExplorers?.default?.url || 'https://sepolia.etherscan.io';
 return `${baseUrl}/tx/${transactionHash}`;
};

// Get the appropriate token explorer URL based on the selected chain
const getTokenExplorerUrl = (tokenAddress: string): string => {
 const baseUrl = selectedChain.blockExplorers?.default?.url || 'https://sepolia.etherscan.io';
 return `${baseUrl}/token/${tokenAddress}`;
};

export const balanceTool = createTool({
 description: "Request the account balance of the user",
 parameters: z.object({
   address: z.string().describe("The address of the user"),
 }),
 execute: async ({ address }) => {
   try {
     const balance = await publicClient.getBalance({
       address: address as `0x${string}`,
     });
     return { 
       balance: formatEther(balance),
       chainName: selectedChain.name
     };
   } catch (error: unknown) {
     console.error("Error fetching balance:", error);
     return { 
       balance: "0",
       chainName: selectedChain.name,
       error: error instanceof Error ? error.message : "Unknown error occurred"
     };
   }
 },
});

export const sendTransactionTool = createTool({
 description:
   "You're going to provide a button that will initiate a transaction to the wallet address the user provided, you are not going to send the transaction",
 parameters: z.object({
   to: z.string().describe("The wallet address of the user"),
   amount: z.string().describe("The amount of eth the transaction"),
 }),
 execute: async ({ to, amount }) => {
   try {
     // Validate the address format
     if (!to.startsWith('0x') || to.length !== 42) {
       return { 
         success: false,
         error: "Invalid Ethereum address format" 
       };
     }
     
     // Validate the amount format
     if (isNaN(Number(amount)) || Number(amount) <= 0) {
       return {
         success: false,
         error: "Amount must be a positive number"
       };
     }
     
     return { 
       success: true,
       to, 
       amount,
       chainName: selectedChain.name 
     };
   } catch (error: unknown) {
     return {
       success: false,
       error: error instanceof Error ? error.message : "Unknown error occurred"
     };
   }
 },
});

// Tool for deploying ERC20 tokens through delegation
export const deployERC20Tool = createTool({
 description: "Deploy a new ERC20 token using the delegated permission from the user. Only use this if the user has set up delegation.",
 parameters: z.object({
   name: z.string().min(1).max(50).describe("The name of the ERC20 token"),
   symbol: z.string().min(1).max(8).describe("The symbol of the ERC20 token (max 8 characters)"),
   initialSupply: z.string().min(1).describe("The initial supply of tokens (in whole tokens)"),
 }),
 execute: async ({ name, symbol, initialSupply }) => {
   try {
     // Check if necessary configuration exists
     if (!FACTORY_CONTRACT_ADDRESS) {
       return {
         success: false,
         error: "Factory contract address not configured. Please check environment variables."
       };
     }
     
     if (!bundlerClient) {
       return {
         success: false,
         error: "Bundler service not configured. Please check the BUNDLER_URL environment variable."
       };
     }
     
     // Check if delegation is set up
     const delegateInfoStr = getStorageItem('aiDelegateInfo');
     const delegationStr = getStorageItem('delegation');
     const privateKeyStr = getStorageItem('aiDelegatePrivateKey');
     
     if (!delegateInfoStr || !delegationStr || !privateKeyStr) {
       return { 
         success: false, 
         error: "Delegation not set up. Please set up delegation first." 
       };
     }
     
     // Parse stored data
     const delegateInfo = JSON.parse(delegateInfoStr);
     const parsedDelegation = parseDelegation(delegationStr);
     
     // Recreate the AI account
     const aiAccount = privateKeyToAccount(privateKeyStr as `0x${string}`);
     
     // Recreate the smart account
     const aiSmartAccount = await toMetaMaskSmartAccount({
       client: publicClient,
       implementation: Implementation.Hybrid,
       signatory: { account: aiAccount },
     });
     
     // Encode the call to the factory contract
     const createTokenCalldata = encodeFunctionData({
       abi: FACTORY_ABI,
       functionName: 'createToken',
       args: [name, symbol, parseEther(initialSupply)]
     });
     
     // Create the execution for the delegation
     const execution = createExecution({
       target: FACTORY_CONTRACT_ADDRESS,
       value: 0n, // Your contract doesn't require ETH to create tokens
       callData: createTokenCalldata,
     });
     
     // Encode the redemption of the delegation
     const redeemDelegationCalldata = DelegationFramework.encode.redeemDelegations(
       [[parsedDelegation]],
       [SINGLE_DEFAULT_MODE],
       [[execution]]
     );
     
     // Send the user operation
     const userOpHash = await bundlerClient.sendUserOperation({
       account: aiSmartAccount,
       calls: [
         {
           to: aiSmartAccount.address,
           data: redeemDelegationCalldata,
         },
       ],
     });
     
     // Wait for receipt
     const receipt = await bundlerClient.waitForUserOperationReceipt({
       hash: userOpHash,
     });
     
     // Extract the created token address from event logs
     let tokenAddress = '';
     try {
       // Look through transaction logs for the TokenCreated event
       const logs = await publicClient.getLogs({
         address: FACTORY_CONTRACT_ADDRESS,
         event: {
           type: 'event',
           name: 'TokenCreated',
           inputs: [
             { indexed: true, name: 'tokenAddress', type: 'address' },
             { indexed: false, name: 'name', type: 'string' },
             { indexed: false, name: 'symbol', type: 'string' },
             { indexed: false, name: 'initialSupply', type: 'uint256' },
             { indexed: false, name: 'owner', type: 'address' }
           ]
         },
         fromBlock: receipt.receipt.blockNumber,
         toBlock: receipt.receipt.blockNumber
       });
       
       if (logs.length > 0) {
         tokenAddress = logs[0].args.tokenAddress as string;
       }
     } catch (error) {
       console.error("Error extracting token address:", error);
       // Continue even if we can't extract the address
     }
     
     const explorerUrl = getExplorerUrl(receipt.receipt.transactionHash);
     const tokenExplorerUrl = tokenAddress ? getTokenExplorerUrl(tokenAddress) : '';
     
     return {
       success: true,
       transactionHash: receipt.receipt.transactionHash,
       userOpHash: receipt.userOpHash,
       tokenName: name,
       tokenSymbol: symbol,
       tokenAddress: tokenAddress || 'Address extraction failed',
       explorerUrl,
       tokenExplorerUrl,
       chainName: selectedChain.name,
       chainId: selectedChain.id
     };
     
   } catch (error: unknown) {
     console.error("Error deploying ERC20:", error);
     
     // Provide meaningful error messages based on error type
     if (error instanceof Error) {
       // Check for common errors
       if (error.message.includes("insufficient funds")) {
         return {
           success: false,
           error: "Insufficient funds to deploy token. The operation requires gas."
         };
       } else if (error.message.includes("user denied")) {
         return {
           success: false,
           error: "Transaction was rejected by the user."
         };
       } else if (error.message.includes("delegation")) {
         return {
           success: false,
           error: "Delegation error. The AI might not have permission to perform this action."
         };
       } else if (error.message.includes("network")) {
         return {
           success: false,
           error: `Network error. Please make sure you're connected to ${selectedChain.name}.`
         };
       }
       
       return {
         success: false,
         error: error.message
       };
     }
     
     return {
       success: false,
       error: "Failed to deploy token. An unknown error occurred."
     };
   }
 },
});

export const tools = {
 displayBalance: balanceTool,
 sendTransaction: sendTransactionTool,
 deployERC20: deployERC20Tool,
};