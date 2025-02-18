import { tool as createTool } from "ai";
import { z } from "zod";
import { publicClient } from "@/wagmi.config";
import { 
  formatEther, 
  parseEther, 
  http, 
  Hex, 
  Address, 
  encodeAbiParameters, 
  parseAbiParameters 
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

// Configuration
const BUNDLER_URL = process.env.NEXT_PUBLIC_BUNDLER_URL || "https://api.pimlico.io/v1/sepolia/rpc?apikey=YOUR_API_KEY";
const FACTORY_CONTRACT_ADDRESS = "0xYourFactoryContractAddress" as `0x${string}`;
const DEPLOY_TOKEN_SELECTOR = "0x7f4ee5f8" as const; // Function selector for deployToken(string,string,uint256)

// Factory contract ABI for the deployToken function
const factoryABI = [
  {
    "inputs": [
      {
        "internalType": "string",
        "name": "name",
        "type": "string"
      },
      {
        "internalType": "string",
        "name": "symbol",
        "type": "string"
      },
      {
        "internalType": "uint256",
        "name": "initialSupply",
        "type": "uint256"
      }
    ],
    "name": "deployToken",
    "outputs": [
      {
        "internalType": "address",
        "name": "tokenAddress",
        "type": "address"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "function"
  }
];

// Properly encode ERC20 deployment call using viem's encoding functions
function encodeDeployTokenCall(name: string, symbol: string, initialSupply: string): Hex {
  // Use viem's encode functions for safer parameter encoding
  const functionSelector = DEPLOY_TOKEN_SELECTOR;
  const encodedParams = encodeAbiParameters(
    parseAbiParameters('string, string, uint256'),
    [name, symbol, parseEther(initialSupply)]
  );
  
  return `${functionSelector}${encodedParams.slice(2)}` as Hex;
}

// Initialize bundler client
const bundlerClient = createBundlerClient({
  transport: http(BUNDLER_URL),
  chain: sepolia,
  paymaster: createPaymasterClient({
    transport: http(BUNDLER_URL),
  }),
});

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
  
  // Handle all potential BigInt values
  return {
    ...parsed,
    salt: BigInt(parsed.salt),
    // Any other BigInt values that need to be reconstructed
    // Check the structure of DelegationStruct to ensure all BigInt fields are handled
  };
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
      return { balance: formatEther(balance) };
    } catch (error: unknown) {
      console.error("Error fetching balance:", error);
      return { 
        balance: "0",
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
        amount 
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
      
      // Parse the stored data
      const delegateInfo = JSON.parse(delegateInfoStr);
      
      // Safely parse and reconstruct the delegation
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
      const deployTokenCalldata = encodeDeployTokenCall(name, symbol, initialSupply);
      
      // Create the execution for the delegation
      const execution = createExecution({
        target: FACTORY_CONTRACT_ADDRESS,
        value: 0n,
        callData: deployTokenCalldata,
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
      
      // You could implement logic to extract the token address from events
      // For example:
      // const tokenAddress = extractTokenAddressFromLogs(receipt.receipt.logs);
      
      return {
        success: true,
        transactionHash: receipt.receipt.transactionHash,
        userOpHash: receipt.userOpHash,
        tokenName: name,
        tokenSymbol: symbol,
        // If you implement the extraction:
        // tokenAddress: tokenAddress,
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