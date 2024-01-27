import { Event } from 'cosmjs-types/tendermint/abci/types';

// remove data string, as we shouldn't need it and I'm not sure how to parse it
export interface TxResponse extends Omit<ResponseDeliverTx, 'data'> {
  height: string;
  timestamp: string;
  txhash: string;
}

export interface ResponseDeliverTx {
  code: number;
  data: Uint8Array;
  /** nondeterministic */
  log: string;
  /** nondeterministic */
  info: string;
  gasWanted: Long;
  gasUsed: Long;
  events: Event[];
  codespace: string;
}