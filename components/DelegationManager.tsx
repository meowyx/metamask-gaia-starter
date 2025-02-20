"use client";

import { useState, useEffect } from "react";
import { useAccount } from "wagmi";
import { Button } from "@/components/ui/button";
import { publicClient } from "@/wagmi.config";
import {
  Implementation,
  toMetaMaskSmartAccount,
  createRootDelegation,
  createCaveatBuilder,
  getDelegationHashOffchain,
  type MetaMaskSmartAccount,
  type DelegationStruct
} from "@metamask-private/delegator-core-viem";
import { createWalletClient, custom, toHex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { randomBytes } from "crypto";
import { FACTORY_CONTRACT_ADDRESS, CREATE_TOKEN_SELECTOR } from "@/constants";

// Define a minimal interface for Ethereum Provider
interface EthereumProvider {
  request: (args: {method: string; params?: unknown[]}) => Promise<unknown>;
  on: (event: string, callback: (...args: unknown[]) => void) => void;
}

export function DelegationManager() {
  const { address, isConnected } = useAccount();
  const [delegatorAccount, setDelegatorAccount] = useState<MetaMaskSmartAccount<Implementation> | undefined>(undefined);
  const [aiDelegateAccount, setAiDelegateAccount] = useState<MetaMaskSmartAccount<Implementation> | undefined>(undefined);
  const [delegation, setDelegation] = useState<DelegationStruct | undefined>(undefined);
  const [isCreatingAccounts, setIsCreatingAccounts] = useState(false);
  const [isCreatingDelegation, setIsCreatingDelegation] = useState(false);
  const [delegationComplete, setDelegationComplete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Create a unique salt for account creation
  const createSalt = () => toHex(randomBytes(8));

  // Initialize accounts when user connects
  useEffect(() => {
    if (isConnected && address) {
      // Clear previous state if user changes
      setDelegatorAccount(undefined);
      setAiDelegateAccount(undefined);
      setDelegation(undefined);
      setDelegationComplete(false);
      setError(null);
    }
  }, [address, isConnected]);

  // Create delegator and AI delegate accounts
  const setupAccounts = async () => {
    if (!isConnected || !address) return;
    
    setIsCreatingAccounts(true);
    setError(null);
    
    try {
      // For delegator account, we'll use the connected wallet
      const provider = (window as Window & { ethereum?: EthereumProvider }).ethereum;
      if (!provider) {
        throw new Error("No provider found. Please make sure MetaMask is installed and connected.");
      }
      
      const walletClient = createWalletClient({
        transport: custom(provider),
        account: address as `0x${string}`
      });
      
      // Create delegator smart account
      const delegatorSmartAccount = await toMetaMaskSmartAccount({
        client: publicClient,
        implementation: Implementation.Hybrid,
        deployParams: [address, [], [], []],
        deploySalt: createSalt(),
        signatory: { walletClient },
      });
      
      // Create AI delegate account with a burner key
      const aiPrivateKey = generatePrivateKey();
      const aiAccount = privateKeyToAccount(aiPrivateKey);
      
      const aiSmartAccount = await toMetaMaskSmartAccount({
        client: publicClient,
        implementation: Implementation.Hybrid,
        deployParams: [aiAccount.address, [], [], []],
        deploySalt: createSalt(),
        signatory: { account: aiAccount },
      });
      
      // Store the AI account private key securely
      sessionStorage.setItem('aiDelegatePrivateKey', aiPrivateKey);
      
      setDelegatorAccount(delegatorSmartAccount);
      setAiDelegateAccount(aiSmartAccount);
    } catch (error: unknown) {
      console.error("Error setting up accounts:", error);
      setError(`Failed to set up accounts: ${error instanceof Error ? error.message : "Unknown error"}`);
    } finally {
      setIsCreatingAccounts(false);
    }
  };

  // Create delegation with caveats specifically for your ERC20 factory
  const createDelegationWithCaveats = async () => {
    if (!delegatorAccount || !aiDelegateAccount) return;
    
    setIsCreatingDelegation(true);
    setError(null);
    
    try {
      // Build caveats that restrict what the AI can do
      // These are specifically tailored to your ERC20Factory contract
      // Build caveats that restrict what the AI can do
// These are specifically tailored to your ERC20Factory contract
const caveats = createCaveatBuilder(delegatorAccount.environment)
// Only allow interaction with your factory contract
.addCaveat("allowedTargets", [FACTORY_CONTRACT_ADDRESS])
// Prevent ETH spending entirely since your createToken doesn't need ETH
.addCaveat("valueLte", BigInt(0))
// Only allow calling the createToken function
.addCaveat("allowedMethods", [CREATE_TOKEN_SELECTOR]);
      
      // Create root delegation with a unique salt
      const newDelegation = createRootDelegation(
        aiDelegateAccount.address,
        delegatorAccount.address,
        caveats,
        BigInt(createSalt())
      );
      
      // Sign the delegation using the delegator account
      const signature = await delegatorAccount.signDelegation({ 
        delegation: newDelegation 
      });
      
      const signedDelegation = {
        ...newDelegation,
        signature
      };
      
      setDelegation(signedDelegation);
      
      // Calculate the delegation hash
      const delegationHash = await getDelegationHashOffchain(signedDelegation);
      
      // Store delegation information
      const delegationInfo = {
        address: aiDelegateAccount.address,
        delegationHash,
        delegatorAddress: delegatorAccount.address
      };
      
      // Store for the chat context
      sessionStorage.setItem('aiDelegateInfo', JSON.stringify(delegationInfo));
      
      // Store the full delegation for later use - handle BigInt serialization
      sessionStorage.setItem('delegation', JSON.stringify({
        ...signedDelegation,
        salt: signedDelegation.salt.toString()
      }, (_, value) => 
        typeof value === 'bigint' ? value.toString() : value
      ));
      
      setDelegationComplete(true);
    } catch (error: unknown) {
      console.error("Error creating delegation:", error);
      setError(`Failed to create delegation: ${error instanceof Error ? error.message : "Unknown error"}`);
    } finally {
      setIsCreatingDelegation(false);
    }
  };

  return (
    <div className="space-y-4 p-4 border rounded-md mb-6">
      <h2 className="text-xl font-bold">AI Token Creation Delegation</h2>
      <p className="text-sm text-gray-600">
        This allows the AI to create ERC20 tokens on your behalf, with strict limitations:
      </p>
      <ul className="list-disc pl-5 mt-1 text-sm text-gray-600">
        <li>Can only interact with the specified token factory contract</li>
        <li>Cannot spend any of your ETH</li>
        <li>Can only call the createToken function</li>
      </ul>
      
      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded text-red-700">
          {error}
        </div>
      )}
      
      {!delegatorAccount && (
        <Button 
          onClick={setupAccounts} 
          disabled={!isConnected || isCreatingAccounts}
          className="bg-indigo-600 hover:bg-indigo-700"
        >
          {isCreatingAccounts ? "Setting up accounts..." : "Set Up Delegation Accounts"}
        </Button>
      )}
      
      {delegatorAccount && !delegation && (
        <div className="space-y-4">
          <div className="p-3 bg-gray-50 border rounded space-y-2">
            <div>
              <p className="text-sm font-medium">Delegator Account (Your Smart Account):</p>
              <code className="text-xs bg-gray-100 p-1 rounded block truncate">{delegatorAccount.address}</code>
            </div>
            
            {aiDelegateAccount && (
              <div>
                <p className="text-sm font-medium">AI Delegate Account:</p>
                <code className="text-xs bg-gray-100 p-1 rounded block truncate">{aiDelegateAccount.address}</code>
              </div>
            )}
          </div>
          
          <Button
            onClick={createDelegationWithCaveats}
            disabled={isCreatingDelegation}
            className="bg-green-600 hover:bg-green-700"
          >
            {isCreatingDelegation ? "Creating delegation..." : "Create Delegation with Restrictions"}
          </Button>
        </div>
      )}
      
      {delegationComplete && (
        <div className="p-4 bg-green-50 border border-green-200 rounded">
          <p className="text-green-800 font-medium">✓ Delegation complete!</p>
          <p className="text-sm text-green-700 mt-1">
            The AI can now deploy ERC20 tokens through the factory contract on your behalf,
            with strict limitations in place. Try asking it to create a token for you.
          </p>
          <div className="mt-3 p-2 bg-white rounded border border-green-100">
            <p className="text-xs text-gray-500">Delegation status:</p>
            <p className="text-sm font-medium">Active</p>
          </div>
        </div>
      )}
    </div>
  );
}