import { chains } from 'chain-registry';
import { ChainRegistryClient } from '@chain-registry/client';
import { Asset, AssetList } from '@chain-registry/types';
import { Policy, PolicyOptions } from '@hapi/catbox';
import { Plugin, ServerRegisterOptions } from '@hapi/hapi';

import { devDenomMap, getAsset } from '../storage/sqlite3/db/assetUtils';
import { hours, inMs, seconds } from '../storage/sqlite3/db/timeseriesUtils';
import defaultLogger from '../logger';

const { REST_API = 'http://89.108.83.252:1317', CHAIN_REGISTRY_CHAIN_NAME = 'qube' } = process.env;

type AssetListsCache = Policy<AssetList[], PolicyOptions<AssetList[]>>;
type ChainIdQueryCache = Policy<string | null, PolicyOptions<string | null>>;
type ChainQueryCache = Policy<Asset, PolicyOptions<Asset>>;

interface GetAssetOptions {
  defaultToStaticAsset?: boolean;
}

const name = 'cachedAssets' as const;
export interface PluginContext {
  [name]: {
    getAsset: (
      chainDenom: string,
      opts?: GetAssetOptions
    ) => Promise<Asset | undefined>;
    getAssetLists: (chainName: string) => Promise<AssetList[]>;
  };
}
const ibcDenomRegex = /^ibc\/([0-9A-Fa-f]+)$/;
const qubeAsset: AssetList = {
  $schema: undefined,
  chain_name: "qube",
  assets: [
    <Asset>{
      description: "ATOM-backed algoritmic stablecoin issued by Qube DAO.",
      denom_units: [
        {
          denom: "uusd",
          exponent: 0
        },
        {
          denom: "usd",
          exponent: 6
        }
      ],
      base: "uusd",
      name: "USQ Testnet",
      display: "usd",
      symbol: "USQ",
      logo_URIs: {
        png: "https://apricot-grubby-booby-751.mypinata.cloud/ipfs/QmcfLWPcB5MXxzc21jBktVVgnuXoCWNE5t19MUmLtdWSuw",
        svg: "https://apricot-grubby-booby-751.mypinata.cloud/ipfs/QmcfLWPcB5MXxzc21jBktVVgnuXoCWNE5t19MUmLtdWSuw"
      },
      images: [
        {
          png: "https://apricot-grubby-booby-751.mypinata.cloud/ipfs/QmcfLWPcB5MXxzc21jBktVVgnuXoCWNE5t19MUmLtdWSuw",
          svg: "https://apricot-grubby-booby-751.mypinata.cloud/ipfs/QmcfLWPcB5MXxzc21jBktVVgnuXoCWNE5t19MUmLtdWSuw"
        }
      ]
    },
    <Asset>{
      description: "The native token of Qube chain.",
      denom_units: [
        {
          denom: "uqube",
          exponent: 0
        },
        {
          denom: "qube",
          exponent: 6
        }
      ],
      base: "uqube",
      name: "Qube Testnet",
      display: "qube",
      symbol: "QUBE",
      logo_URIs: {
        png: "https://apricot-grubby-booby-751.mypinata.cloud/ipfs/QmfJEqcjheC56qrs9cpW86RaGUW2xsJrB1suGWoZJScbXc",
        svg: "https://apricot-grubby-booby-751.mypinata.cloud/ipfs/QmfJEqcjheC56qrs9cpW86RaGUW2xsJrB1suGWoZJScbXc"
      },
      images: [
        {
          png: "https://apricot-grubby-booby-751.mypinata.cloud/ipfs/QmfJEqcjheC56qrs9cpW86RaGUW2xsJrB1suGWoZJScbXc",
          svg: "https://apricot-grubby-booby-751.mypinata.cloud/ipfs/QmfJEqcjheC56qrs9cpW86RaGUW2xsJrB1suGWoZJScbXc"
        }
      ]
    },
    <Asset>{
      denom_units: [
        {
          denom: "uatom",
          exponent: 0
        },
        {
          denom: "atom",
          exponent: 6
        }
      ],
      base: "uatom",
      name: "Cosmo",
      display: "atom",
      symbol: "ATOM",
      logo_URIs: {
        png: "https://raw.githubusercontent.com/cosmos/chain-registry/master/cosmoshub/images/atom.png",
        svg: "https://raw.githubusercontent.com/cosmos/chain-registry/master/cosmoshub/images/atom.svg"
      },
      images: [
        {
          "png": "https://raw.githubusercontent.com/cosmos/chain-registry/master/cosmoshub/images/atom.png",
          "svg": "https://raw.githubusercontent.com/cosmos/chain-registry/master/cosmoshub/images/atom.svg"
        }
      ]
    }
  ]
}

export const plugin: Plugin<ServerRegisterOptions> = {
  name,
  register: async function (server) {
    // create cache for assets
    const assetListsCache: AssetListsCache = server.cache({
      segment: 'chain-assets-registered',
      // allow data to be replaced infrequently, and return stale data quick
      staleIn: 24 * hours * inMs,
      staleTimeout: 1 * seconds * inMs,
      // don't expire data, old data is better than no data here
      expiresIn: Number.MAX_SAFE_INTEGER,
      // generate a main chain AssetList and IBC chain AssetList if passed as ID
      generateFunc: async (id): Promise<AssetList[]> => {
        const ibcChainName = `${id}`;
        const chainName = CHAIN_REGISTRY_CHAIN_NAME;
        if (chainName) {
          let assetList: AssetList[] = []
          switch(chainName){
            case "qube": {
              assetList.push(qubeAsset)
            }
            case "cosmoshubtestnet": {
              const client = new ChainRegistryClient({
                chainNames: ibcChainName ? [chainName, ibcChainName] : [chainName],
              });
              //console.log("QLABS: client: ", client)
    
              // get the current data for the expected chain
              try {
                await client.fetchUrls();
              } catch(e) {
                //console.log("QLABS: error: ", e)
              }
    
              // get asset lists
              const assetList_temp = client.getChainAssetList(chainName);
              assetList = (
                !ibcChainName
                  ? [assetList_temp]
                  : // place generated assets first because they hold more detail:
                    // some IBC denoms assets may be placed on the chain asset list
                    // because they are used as fee denoms: and may have sparse info
                    [...client.getGeneratedAssetLists(chainName), assetList_temp]
              ).filter(Boolean);
            }
          }
          return assetList
        } else {
          throw new Error('main CHAIN_NAME is not defined');
        }
      },
      generateTimeout: 60 * seconds * inMs,
    });

    // create cache for assets
    const chainIdQueryCache: ChainIdQueryCache = server.cache({
      segment: 'chain-id-queries',
      // allow data to be replaced infrequently, and return stale data quick
      staleIn: 24 * hours * inMs,
      staleTimeout: 1 * seconds * inMs,
      // don't expire data, old data is better than no data here
      expiresIn: Number.MAX_SAFE_INTEGER,
      // generate a main chain AssetList and IBC chain AssetList if passed as ID
      generateFunc: async (id): Promise<string | null> => {
        const ibcTracePath = `${id}`;
        if (!ibcTracePath) {
          throw new Error(
            `no IBC trace path information was found for: ${id}`,
            {
              cause: 404,
            }
          );
        }

        // search chain for IBC asset data
        // "path" is just the combination of "port" and "channel"
        const [port, channel] = ibcTracePath.split('/');
        const clientState = await getIbcClientState(channel, port);
        const chainId = clientState?.client_state?.chain_id;
        if (!chainId) {
          throw new Error(`no chain ID was found for IBC path ${id}`, {
            cause: 404,
          });
        }
        return chainId;
      },
      generateTimeout: 60 * seconds * inMs,
    });

    // create cache for assets
    const chainQueryCache: ChainQueryCache = server.cache({
      segment: 'chain-asset-queries',
      // allow data to be replaced infrequently, and return stale data quick
      staleIn: 24 * hours * inMs,
      staleTimeout: 1 * seconds * inMs,
      // don't expire data, old data is better than no data here
      expiresIn: Number.MAX_SAFE_INTEGER,
      // generate a main chain AssetList and IBC chain AssetList if passed as ID
      generateFunc: async (id): Promise<Asset> => {
        const chainDenom = `${id}`;
        const ibcHash = chainDenom.match(ibcDenomRegex)?.[1];
        const ibcTrace = ibcHash && (await getIbcTraceInfo(chainDenom));
        if (!ibcHash || !ibcTrace) {
          throw new Error('no IBC trace denom information was found', {
            cause: 404,
          });
        }

        // search chain for IBC asset data
        // "path" is just the combination of "port" and "channel"
        const [port, channel] = ibcTrace.path.split('/');
        const chainId = await chainIdQueryCache.get(ibcTrace.path);

        // note: the chains dependency from chain-registry here means we cannot
        //       identify chains newer than the version saved in chain-registry
        const chain = chains.find((chain) => chain.chain_id === chainId);

        // look up chain ID in Chain Registry
        if (!chain) {
          throw new Error('no registered Chain was found for IBC denom', {
            cause: 404,
          });
        }

        const chainName = chain.chain_name;
        //console.log("QLABS: chainName: ", chainName)
        const assetsLists = await assetListsCache.get(chainName);
        if (!assetsLists) {
          throw new Error(
            `no asset lists were found for denom chain ${chainName}`,
            { cause: 404 }
          );
        }

        const asset = assetsLists
          .flatMap((assetList) => assetList)
          .flatMap((assetList) => assetList.assets)
          .find((asset) => {
            return (
              asset.base === ibcTrace.base_denom &&
              asset.ibc?.dst_channel === channel &&
              asset.traces?.find((trace) => {
                // note: this check might be too specific for non-Cosmos chains
                return (
                  trace.type === 'ibc' &&
                  trace.chain.port === port &&
                  trace.chain.channel_id === channel &&
                  trace.counterparty.chain_name === chainName &&
                  trace.counterparty.base_denom === ibcTrace.base_denom
                );
              })
            );
          });

        if (!asset) {
          throw new Error(`no asset was found for denom chain ${chainName}`, {
            cause: 404,
          });
        }

        return asset;
      },
      generateTimeout: 60 * seconds * inMs,
    });

    // add cache method into response context
    const pluginContext: PluginContext['cachedAssets'] = {
      getAsset: async (maybeDevDenom: string, opts?: GetAssetOptions) => {
        const chainDenom = devDenomMap?.[maybeDevDenom] ?? maybeDevDenom;
        //console.log("QLABS: ", ibcDenomRegex.test(chainDenom))
        if (ibcDenomRegex.test(chainDenom)) {
          // lookup IBC denom information
          try {
            const asset = await chainQueryCache.get(chainDenom);
            if (!asset) {
              throw new Error(
                `Cannot find query cache value for: ${chainDenom}`,
                { cause: 404 }
              );
            }
            return asset;
          } catch (e) {
            defaultLogger.error(
              `Get cachedAssets error for lookup ${chainDenom}: ${
                (e as Error)?.message
              }`
            );
          }
        }
        // for a non-IBC denom: attempt to look through main chain's dynamic info
        else {
          const mainChainAssetLists = await assetListsCache.get('');
          // use found dynamic list for looking up main chain tokens
          if (mainChainAssetLists) {
            return getAsset(maybeDevDenom, mainChainAssetLists);
          }
        }
        // if a dynamic asset was not found, perhaps a static asset is ok
        if (opts?.defaultToStaticAsset) {
          const staticAsset = getAsset(maybeDevDenom);
          if (staticAsset) {
            defaultLogger.info(
              `Get cachedAssets using found static asset for ${chainDenom}`
            );
            return staticAsset;
          }
        }
      },
      getAssetLists: async (chainName: string) => {
        const assetLists = await assetListsCache.get(chainName);
        if (!assetLists) {
          throw new Error(`Cannot find asset lists for: ${chainName}`, {
            cause: 404,
          });
        }
        return assetLists;
      },
    };

    // add plugin context methods to plugin under server.plugin[pluginName][key]
    server.expose(pluginContext);
  },
};

interface DenomTrace {
  path: string;
  base_denom: string;
}
interface QueryDenomTraceResponse {
  denom_trace: DenomTrace;
}

async function getIbcTraceInfo(chainDenom: string) {
  const ibcHash = chainDenom.match(ibcDenomRegex)?.[1];
  if (REST_API && ibcHash) {
    const url = `${REST_API}/ibc/apps/transfer/v1/denom_traces/${ibcHash}`;
    //console.log("QLABS: ", url)
    try {
      // query chain for IBC denom information
      const response = await fetch(url);
      const data = (await response.json()) as QueryDenomTraceResponse;
      return data?.denom_trace;
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(`Unable to get IBC asset info for ${url}`, e);
    }
  }
}

interface QueryClientStateResponse {
  identified_client_state: {
    client_id: string;
    client_state: {
      chain_id: string;
    };
  };
  proof: string;
  proof_height: {
    revision_number: string;
    revision_height: string;
  };
}

async function getIbcClientState(channelId: string, portId: string) {
  const url = `${REST_API}/ibc/core/channel/v1/channels/${channelId}/ports/${portId}/client_state`;
  try {
    // query chain for IBC information
    const response = await fetch(url);
    const data = (await response.json()) as QueryClientStateResponse;
    return data?.identified_client_state;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(`Unable to get IBC asset info for ${url}`, e);
  }
}
