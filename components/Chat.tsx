"use client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useChat } from "ai/react";
import { useAccount, useSendTransaction } from "wagmi";
import { parseEther } from "viem";
import { DelegationManager } from "@/components/DelegationManager";
import { useState, useEffect } from "react";

export const Chat = () => {
  const { address } = useAccount();
  const [delegationEnabled, setDelegationEnabled] = useState(false);
  
  // Check if delegation is set up
  useEffect(() => {
    const checkDelegation = () => {
      const delegateInfo = sessionStorage.getItem('aiDelegateInfo');
      setDelegationEnabled(!!delegateInfo);
    };
    
    // Check initially
    checkDelegation();
    
    // Set up event listener to detect changes in session storage
    window.addEventListener('storage', checkDelegation);
    
    return () => {
      window.removeEventListener('storage', checkDelegation);
    };
  }, []);

  const { messages, input, handleInputChange, handleSubmit, isLoading } =
    useChat({
      initialMessages: [
        {
          role: "system",
          content: `You have connected your wallet successfully. Your wallet address is ${address}. ${
            delegationEnabled 
              ? "You have delegated token creation permissions to me. I can deploy ERC20 tokens on your behalf through a factory contract. Just ask me to create a token and specify the name, symbol, and initial supply." 
              : "You can delegate token creation permissions to me using the delegation manager above. Once set up, I'll be able to create custom ERC20 tokens for you with limited permissions."
          }`,
          id: "system",
        },
      ],
    });
    
  const { data: hash, sendTransaction } = useSendTransaction();
  
  return (
    <div className="h-full w-full space-y-4 max-w-3xl">
      <DelegationManager />
      
      <div className="border h-full max-h-96 rounded-md p-4 space-y-6 justify-end overflow-y-scroll">
        {messages.map((message) => (
          <div key={message.id}>
            {message.role === "user" ? (
              <div className="flex w-full justify-start">
                <div className="w-fit max-w-md bg-gray-800 text-gray-50 rounded-md p-2">
                  <strong>User:</strong> {message.content}
                </div>
              </div>
            ) : (
              <div className="flex w-full justify-end">
                <div className="w-fit max-w-md bg-gray-100 text-gray-900 rounded-md p-2">
                  <strong>AI:</strong> {message.content}
                </div>
              </div>
            )}
            <div>
              {message.toolInvocations?.map((toolInvocation) => {
                const { toolName, toolCallId, state } = toolInvocation;
                if (state === "result") {
                  if (toolName === "sendTransaction") {
                    const {
                      result,
                    }: { result: { to: string; amount: string } } =
                      toolInvocation;
                    if (isLoading) {
                      return (
                        <div key={toolCallId}>
                          <p>Loading...</p>
                        </div>
                      );
                    }
                    return (
                      <div key={toolCallId}>
                        <Button
                          className="bg-orange-600 text-orange-100 py-2 px-5 rounded-sm w-fit"
                          onClick={() =>
                            sendTransaction({
                              to: result.to as `0x${string}`,
                              value: parseEther(result.amount),
                            })
                          }
                        >
                          Send Transaction
                        </Button>
                        <p>
                          {hash
                            ? `Transaction sent: ${hash}`
                            : "Transaction not sent"}
                        </p>
                      </div>
                    );
                  } else if (toolName === "deployERC20") {
                    const { result } = toolInvocation;
                    return (
                      <div key={toolCallId} className="p-3 my-2 rounded">
                        {result.success ? (
                          <div className="bg-green-50 border border-green-200 p-3 rounded">
                            <h3 className="font-bold text-green-800">Token Deployed Successfully!</h3>
                            <div className="mt-2 space-y-1">
                              <p><strong>Name:</strong> {result.tokenName}</p>
                              <p><strong>Symbol:</strong> {result.tokenSymbol}</p>
                              <p className="mt-2">
                                <a 
                                  href={`https://sepolia.etherscan.io/tx/${result.transactionHash}`}
                                  target="_blank"
                                  className="text-blue-600 underline"
                                >
                                  View transaction on Etherscan
                                </a>
                              </p>
                            </div>
                          </div>
                        ) : (
                          <div className="bg-red-50 border border-red-200 p-3 rounded">
                            <h3 className="font-bold text-red-800">Token Deployment Failed</h3>
                            <p className="text-red-700 mt-1">
                              {result.error}
                            </p>
                            {result.error.includes("Delegation not set up") && (
                              <p className="mt-2 text-sm">
                                Please set up delegation using the panel above before creating tokens.
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  }
                } else {
                  return (
                    <div key={toolCallId}>
                      {toolName === "displayBalance" ? (
                        <div className="text-gray-500 italic">Loading balance...</div>
                      ) : toolName === "deployERC20" ? (
                        <div className="flex items-center space-x-2 text-gray-500 italic">
                          <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                          </svg>
                          <span>Deploying token...</span>
                        </div>
                      ) : null}
                    </div>
                  );
                }
              })}
            </div>
          </div>
        ))}
      </div>
      <form className="flex gap-3" onSubmit={handleSubmit}>
        <Input
          value={input}
          onChange={handleInputChange}
          placeholder="Type a message..."
        />
        <Button type="submit">Send</Button>
      </form>
    </div>
  );
};