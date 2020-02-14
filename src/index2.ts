// src/index.ts

//
// Duplex streaming navigator
// The standard version that allows you to navigate
// this version only refresh the stats when doing a new loading
//

import { SkipchainRPC, SkipBlock } from '@dedis/cothority/skipchain'
import { Roster } from '@dedis/cothority/network/proto'
import { IConnection, WebSocketConnection, RosterWSConnection } from "@dedis/cothority/network/connection";
import { StatusRequest, StatusResponse } from "@dedis/cothority/status/proto";
import StatusRPC from "@dedis/cothority/status/status-rpc";
import { ByzCoinRPC } from "@dedis/cothority/byzcoin";
import { DataBody } from '@dedis/cothority/byzcoin/proto'
import { GetSingleBlockByIndexReply, GetSingleBlock } from '@dedis/cothority/skipchain/proto';
import { StreamingRequest, StreamingResponse, PaginateRequest, PaginateResponse } from '@dedis/cothority/byzcoin/proto/stream'
import { WebSocketAdapter } from '@dedis/cothority/network';


var lastBlock: SkipBlock
var numBlocksInput: HTMLInputElement
var numPagesInput: HTMLInputElement
var inputBlock: HTMLInputElement
var logEachInput: HTMLInputElement
var detailsInput: HTMLInputElement
var ws: WebSocketAdapter
var statsTarget: HTMLElement

var logEach: number
var printDetails: boolean

export function sayHi() {
    numBlocksInput = document.getElementById("num-blocks-input") as HTMLInputElement
    numPagesInput = document.getElementById("num-pages-input") as HTMLInputElement
    inputBlock = document.getElementById("block-input") as HTMLInputElement
    logEachInput = document.getElementById("log-each-input") as HTMLInputElement
    statsTarget = document.getElementById("stats-info")
    detailsInput = document.getElementById("details-input") as HTMLInputElement

    document.getElementById("load-button").addEventListener("click", (e: Event) => {
        const firstBlockID = inputBlock.value
        const numBlocks = parseInt(numBlocksInput.value)
        const numPages = parseInt(numPagesInput.value)
        logEach = parseInt(logEachInput.value)
        printDetails = detailsInput.checked
        statsTarget.innerText = ""

        if(ws != undefined) {
            ws.close(1000, "new load")
            ws = undefined
        }
        document.getElementById("status").innerHTML = ""
        printBlocks(firstBlockID, numBlocks, numPages, false);
    });

    document.getElementById("forward-button").addEventListener("click", load);
    document.getElementById("backward-button").addEventListener("click", load);
}

// Called by the "next" and "previous" buttons.
function load(e: Event) {
    if(lastBlock === undefined) {
        prependLog("please first load a page")
        return
    }

    var reversed: boolean
    var nextID: string

    if((<HTMLInputElement>e.currentTarget).dataset.reversed === "true") {
        reversed = true
        if(lastBlock.backlinks.length == 0) {
            prependLog("no more blocks to fetch (list of backlinks empty")
            return
        }
        nextID = lastBlock.backlinks[0].toString("hex")
    } else {
        reversed = false
        if(lastBlock.forwardLinks.length == 0) {
            prependLog("no more blocks to fetch (list of forwardlinks empty")
            return
        }
        nextID = lastBlock.forwardLinks[0].to.toString("hex")
    }
    const numBlocks = parseInt(numBlocksInput.value)
    const numPages = parseInt(numPagesInput.value)
    logEach = parseInt(logEachInput.value)
    printDetails = detailsInput.checked
    printBlocks(nextID, numBlocks, numPages, reversed)
}

function printBlocks(firstBlockID: string, numBlocks: number, numPages: number, backward: boolean) {
    var startTime = performance.now();

    const roster = Roster.fromTOML(rosterStr);
    if (!roster) {
        console.error("roster is undefined")
        return
    }

    var bid: Buffer
    try {
      bid = hex2Bytes(firstBlockID) 
    } catch (error) {
      prependLog("failed to parse the block ID: ", error)
      return
    }

    try {
      var conn = new WebSocketConnection(roster.list[0].getWebSocketAddress(), SkipchainRPC.serviceName);
    } catch (error) {
      prependLog("error creating conn: ", error)
    }
    try {
      var conn2 = new RosterWSConnection(roster, SkipchainRPC.serviceName, 1);
    } catch (error) {
      prependLog("error creating conn2: ", error)
    }

    const conn3 = conn2.copy(ByzCoinRPC.serviceName)

    var count = 0
    if(ws === undefined) {
      ws = conn3.sendStream<PaginateResponse>(new PaginateRequest({
        startid: bid, pagesize: numBlocks, numpages: numPages,
        backward: backward}), PaginateResponse,
        (data, ws) => {

        if(data.errorcode != 0) {
          prependLog("got an error with code ", data.errorcode, " : ", data.errortext)
          return
        }
        for(var i=0; i<data.blocks.length; i++) {
          if(data.backward){
            count--
          } else {
            count++
          }
          if (count % logEach == 0) {
            var output = `- block: ${count}, page ${data.pagenumber}, hash: ${data.blocks[i].hash.toString("hex")}`
            if(printDetails) {
              const payload = data.blocks[i].payload
              const body = DataBody.decode(payload)
              body.txResults.forEach((transaction, i) => {
                  output += `\n-- Transaction ${i}`
                  transaction.clientTransaction.instructions.forEach((instruction, j) => {
                      output += `\n--- Instruction ${j}`
                      output += `\n---- Hash: ${instruction.hash().toString("hex")}`
                      output += `\n---- Instance ID: ${instruction.instanceID.toString("hex")}`
                      if (instruction.spawn !== null) {
                        output += `\n---- Spawn:`
                        output += `\n----- ContractID: ${instruction.spawn.contractID}`
                        output += `\n----- Args:`
                        instruction.spawn.args.forEach((arg, _) => {
                          output += `\n------ Arg:`
                          output += `\n------- Name: ${arg.name}`
                          output += `\n------- Value: ${arg.value}`
                        })
                      } else if (instruction.invoke !== null) {
                        output += `\n---- Invoke:`
                        output += `\n----- ContractID: ${instruction.invoke.contractID}`
                        output += `\n----- Args:`
                        instruction.invoke.args.forEach((arg, _) => {
                          output += `\n------ Arg:`
                          output += `\n------- Name: ${arg.name}`
                          output += `\n------- Value: ${arg.value}`
                        })
                      } else if (instruction.delete !== null) {
                        output += `\n---- Delete: ${instruction.delete}`
                      }
                  });
              });
            }
            prependLog(output);
          }
          if (count == numBlocks*numPages) {
            printStat(startTime, count)
          }
        }
        lastBlock = data.blocks[data.blocks.length-1]

      }, (code, reason) => {
        prependLog("closed: ", code, reason)
      }, (err) => {
        prependLog("error: ", err)
        ws = undefined;
        printStat(startTime, count)
      });
    } else {
        const message = new PaginateRequest({startid: bid, pagesize: numBlocks, numpages: numPages, backward: backward});
        const messageByte = Buffer.from(message.$type.encode(message).finish());
        ws.send(messageByte)
    }
}

var logCounter = 0;
var blockCounter = 0;
var statusHolder: HTMLElement;
var keepScroll: HTMLInputElement;
var t0: number;

export function prependLog(...nodes: Array<Node | any>) {
    const wrapper = document.createElement("div");
    wrapper.classList.add("log-entry-wrapper");
    const contentWrapper = document.createElement("pre");
    contentWrapper.classList.add("nice-scroll2");
    const infos = document.createElement("div");
    infos.classList.add("log-info");
    infos.append(logCounter + "");
    contentWrapper.append(...nodes);
    wrapper.append(infos, contentWrapper);
    if (statusHolder === undefined) {
        statusHolder = document.getElementById("status");
    }
    statusHolder.append(wrapper);
    logCounter++;
    updateScroll()
}

function updateScroll(){
  if (keepScroll === undefined) {
    keepScroll = document.getElementById("keep-scroll") as HTMLInputElement;
  }
  if (keepScroll.checked == true) {
    statusHolder.scrollTop = statusHolder.scrollHeight;
  }
}

function hex2Bytes (hex:string) {
    if (!hex) {
        return Buffer.allocUnsafe(0)
    }

    return Buffer.from(hex, 'hex')
}

function printStat(startTime: number, count: number) {
    const elapsed = performance.now() - startTime;
    statsTarget.innerText = "Took " + elapsed + "ms for " + count + " blocks (" + (count / elapsed)*1000 + " blocks/s)"
}

const chainId = "763d28aa5a2cb9d2811f6c86ac72c653c3a8350ee7e4441a9ae4f53148f93e48"
const blockId = "7878ac2ed5010190f955a2c23b2f8e95f1c33d815e1d2351da39286e17980ca4"
const genesis = "0000000000000000000000000000000000000000000000000000000000000000"

const rosterStr = `[[servers]]
  Address = "tls://188.166.35.173:7770"
  Url = "https://wookiee.ch/conode"
  Suite = "Ed25519"
  Public = "a59fc58c0a445b70dcd57e01603a714a2ee99c1cc14ca71780383abada5d7143"
  Description = "Wookiee's Cothority"
  [servers.Services]
    [servers.Services.ByzCoin]
      Public = "70c192537778a53abb9315979f48e170da9182b324c7974462cbdde90fc0c51d440e2de266a81fe7a3d9d2b6665ef07ba3bbe8df027af9b8a3b4ea6569d7f72a41f0dfe4dc222aa8fd4c99ced2212d7d1711267f66293732c88e8d43a2cf6b3e2e1cd0c57b8f222a73a393e70cf81e53a0ce8ed2a426e3b0fa6b0da30ff27b1a"
      Suite = "bn256.adapter"
    [servers.Services.Skipchain]
      Public = "63e2ed93333bd0888ed2b5e51b5e2544831b4d79dead571cf67604cdd96bc0212f68e582468267697403d7ed418e70ed9fcb01940e4c603373994ef00c04542c24091939bddca515381e0285ab805826cec457346be482e687475a973a20fca48f16c76e352076ccc0c866d7abb3ac50d02f9874d065f85404a0127efc1acf49"
      Suite = "bn256.adapter"`
