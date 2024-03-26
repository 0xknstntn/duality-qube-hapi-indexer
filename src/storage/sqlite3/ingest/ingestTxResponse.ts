import { TxResponse } from '../../../@types/tx';
import { Buffer } from "buffer";
import insertDexTokensRows from './tables/dex.tokens';
import insertDexPairsRows from './tables/dex.pairs';
import insertBlockRows from './tables/block';
import insertTxRows from './tables/tx';
import insertTxMsgRows from './tables/tx_msg';
import insertTxEventRows from './tables/tx_result.events';

import insertEventTickUpdate from './tables/event.TickUpdate';
import insertEventPlaceLimitOrder from './tables/event.PlaceLimitOrder';
import insertEventDeposit from './tables/event.DepositLP';
import insertEventWithdraw from './tables/event.WithdrawLP';
import { upsertDerivedTickStateRows } from './tables/derived.tick_state';

import decodeEvent from './utils/decodeEvent';
import { getDexMessageAction, isValidResult } from './utils/utils';
import Timer from '../../../utils/timer';

let lastHeight = '0';
let lastTxIndex = 0;
export default async function ingestTxs(
  txPage: TxResponse[],
  timer = new Timer()
) {
  for (const tx_result of txPage) {
    // find this transaction's index
    lastTxIndex = tx_result.height === lastHeight ? lastTxIndex + 1 : 0;
    lastHeight = tx_result.height;
    const index = lastTxIndex;

    // skip invalid transactions
    if (!isValidResult(tx_result)) {
      continue;
    }

    const txEvents = (tx_result.events || []).map(decodeEvent);
    for (const txEvent of txEvents) {
      //console.log("QLABS: ", txEvent.attributes)
    }

    //console.log(JSON.parse(tx_result.log)[0].events)
    /*const txEvents = (JSON.parse(tx_result.log)[0].events || []).map(decodeEvent);
    let temp_event = tx_result.height == '1425112' ? (JSON.parse(tx_result.log)[0].events || []) : []
    for (let index = 0; index < temp_event.length; index++) {
      let event = temp_event[index]
      //console.log(event)
      if(event.type == "message"){
        console.log("\n\n\n\n\n\n\nEVENT ::::::: ", index)
        for (let index1 = 0; index1 < event.attributes.length; index1++) {
          console.log("QLABS: DEBUG: EVENT: ", event.attributes[index1] )
          
        }
        console.log("EVENT ::::::: END\n\n\n\n\n\n", index)
      } 

    }*/
    //const txEvents = (tx_result.events || []).map(decodeEvent);

    //console.log("QLABS: DEBUG: ",  tx_result.height == '1425112' ? JSON.parse(tx_result.log)[0].events : "")
    //console.log("QLABS: DEBUG: ", tx_result.events)
    //console.log(txEvents)


    // first add block rows
    timer.start('processing:txs:block');
    await insertBlockRows(tx_result);
    timer.stop('processing:txs:block');

    // then add token foreign keys
    for (const txEvent of txEvents) {
      timer.start('processing:txs:dex.tokens');
      await insertDexTokensRows(txEvent);
      timer.stop('processing:txs:dex.tokens');
    }

    // then add pair foreign keys
    for (const txEvent of txEvents) {
      timer.start('processing:txs:dex.pairs');
      await insertDexPairsRows(txEvent);
      timer.stop('processing:txs:dex.pairs');
    }

    // then add transaction rows
    timer.start('processing:txs:tx');
    await insertTxRows(tx_result, index);
    timer.stop('processing:txs:tx');

    // then add transaction event rows
    let lastMsgID: number | undefined = undefined;
    for (const txEvent of txEvents) {
      // get new or last know related Msg id
      timer.start('processing:txs:tx_msg');
      const newMsg = await insertTxMsgRows(txEvent);
      timer.stop('processing:txs:tx_msg');
      lastMsgID = newMsg ? newMsg.lastID : lastMsgID;

      // add transaction event
      timer.start('processing:txs:tx_result.events');
      await insertTxEventRows(tx_result, txEvent, index, lastMsgID);
      timer.stop('processing:txs:tx_result.events');

      // continue logic for dex events
      // if the event was a dex action then use that event to update tables
      const dexAction = getDexMessageAction(txEvent);
      //console.log("QLABS: txEvent: ", txEvent.type)
      if (dexAction) {
        // add event rows to specific event tables:
        switch (dexAction) {
          case 'DepositLP':
            timer.start('processing:txs:event.DepositLP');
            //console.log("\n\n\n\n\n\n\n")
            //console.log("QLABS: DEBUG: ", txEvent)
            await insertEventDeposit(tx_result, txEvent, index);
            timer.stop('processing:txs:event.DepositLP');
            break;
          case 'WithdrawLP':
            timer.start('processing:txs:event.WithdrawLP');
            await insertEventWithdraw(tx_result, txEvent, index);
            timer.stop('processing:txs:event.WithdrawLP');
            break;
          case 'PlaceLimitOrder':
            timer.start('processing:txs:event.PlaceLimitOrder');
            await insertEventPlaceLimitOrder(tx_result, txEvent, index);
            timer.stop('processing:txs:event.PlaceLimitOrder');
            break;
          case 'TickUpdate':
            timer.start('processing:txs:event.TickUpdate');
            await insertEventTickUpdate(tx_result, txEvent, index, timer);
            await upsertDerivedTickStateRows(tx_result, txEvent, index, timer);
            timer.stop('processing:txs:event.TickUpdate');
            break;
        }
      }
    }
  }
}
