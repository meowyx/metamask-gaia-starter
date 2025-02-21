import type { Hex } from "viem";
import type { DelegationStruct } from "@metamask-private/delegator-core-viem";
import {
  DelegationStorageClient,
  DelegationStoreFilter,
  Environment
} from "@metamask-private/delegator-core-viem";

let instance: DelegationStorageClient | null = null;

export const getDelegationStorageClient = (): DelegationStorageClient => {
  if (!instance) {
    if (!process.env.NEXT_PUBLIC_DELEGATION_STORAGE_API_KEY || !process.env.NEXT_PUBLIC_DELEGATION_STORAGE_API_KEY_ID) {
      throw new Error('Delegation storage API key and key ID are required');
    }

    instance = new DelegationStorageClient({
      apiKey: process.env.NEXT_PUBLIC_DELEGATION_STORAGE_API_KEY,
      apiKeyId: process.env.NEXT_PUBLIC_DELEGATION_STORAGE_API_KEY_ID,
      environment: (process.env.NEXT_PUBLIC_DELEGATION_STORAGE_ENVIRONMENT || "development") as unknown as Environment,
      fetcher: window.fetch.bind(window),
    });
  }
  return instance;
};

export const storeDelegation = async (delegation: DelegationStruct) => {
  const delegationStorageClient = getDelegationStorageClient();
  return delegationStorageClient.storeDelegation(delegation);
};

export const getDelegationChain = async (hash: Hex) => {
  const delegationStorageClient = getDelegationStorageClient();
  return await delegationStorageClient.getDelegationChain(hash);
};

export const fetchDelegations = async (address: Hex, filter: typeof DelegationStoreFilter.Given | typeof DelegationStoreFilter.Received) => {
  const delegationStorageClient = getDelegationStorageClient();
  return await delegationStorageClient.fetchDelegations(address, filter);
};

export { DelegationStoreFilter };