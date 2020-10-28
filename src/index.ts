// Columbus
//
// Duplex streaming navigator
// An improved version using Observable
//
import { ByzCoinRPC } from "@dedis/cothority/byzcoin";
import { DataBody, DataHeader } from "@dedis/cothority/byzcoin/proto";
import {
  PaginateRequest,
  PaginateResponse,
} from "@dedis/cothority/byzcoin/proto/stream";
import {
  WebSocketAdapter,
  WebSocketConnection,
} from "@dedis/cothority/network";
import { Roster } from "@dedis/cothority/network/proto";
import { SkipBlock } from "@dedis/cothority/skipchain";
import { StatusRPC } from "@dedis/cothority/status";
import { Observable, Subject } from "rxjs";
import { takeUntil } from "rxjs/operators";

// To keep track of the latest block fetched
let lastBlock: SkipBlock;
// HTML form elements that holds the user's options
let numBlocksInput: HTMLInputElement;
let numPagesInput: HTMLInputElement;
let inputBlock: HTMLInputElement;
let logEachInput: HTMLInputElement;
let detailsInput: HTMLInputElement;
let rosterInput: HTMLInputElement;
let repeatCmdInput: HTMLInputElement;
let statsTarget: HTMLElement;
let boatTarget: HTMLElement;
// To re-use the same ws connection across runs
let ws: WebSocketAdapter;
// The roster
let roster: Roster;
// Used from the ws callback to send events to the caller
const subject = new Subject<[number, SkipBlock]>();
// Those three need to be global so we can update them across multiple ws
// callback
let printDetails: boolean;
let printRoster: boolean;
let logEach: number;

export function sayHi() {
  numBlocksInput = document.getElementById(
    "num-blocks-input"
  ) as HTMLInputElement;
  numPagesInput = document.getElementById(
    "num-pages-input"
  ) as HTMLInputElement;
  inputBlock = document.getElementById("block-input") as HTMLInputElement;
  logEachInput = document.getElementById("log-each-input") as HTMLInputElement;
  statsTarget = document.getElementById("stats-info");
  detailsInput = document.getElementById("details-input") as HTMLInputElement;
  rosterInput = document.getElementById("roster-input") as HTMLInputElement;
  repeatCmdInput = document.getElementById(
    "repeat-cmd-input"
  ) as HTMLInputElement;
  boatTarget = document.getElementById("boat");

  roster = Roster.fromTOML(rosterStr);
  if (!roster) {
    prependLog("roster is undefined");
    return;
  }
  document
    .getElementById("load-button")
    .addEventListener("click", (e: Event) => {
      const firstBlockID = inputBlock.value;
      const pageSize = parseInt(numBlocksInput.value, 10);
      const numPages = parseInt(numPagesInput.value, 10);
      const repeat = parseInt(repeatCmdInput.value, 10);
      logEach = parseInt(logEachInput.value, 10);
      printDetails = detailsInput.checked;
      printRoster = rosterInput.checked;
      statsTarget.innerText = "";

      if (ws !== undefined) {
        ws.close(1000, "new load");
        ws = undefined;
      }
      document.getElementById("status").innerHTML = "";

      boatTarget.classList.add("anime");

      const notifier = new Subject();
      const startTime = performance.now();
      let pageDone = 0;
      let repeatCounter = 0;
      subject.pipe(takeUntil(notifier)).subscribe({
        next: ([i, skipBlock]) => {
          if (i === pageSize) {
            pageDone++;
            if (pageDone === numPages) {
              printStat(startTime, pageDone * pageSize);
              if (repeatCounter < repeat) {
                repeatCounter++;
                const next = skipBlock.forwardLinks[0].to.toString("hex");
                pageDone = 0;
                printBlocks(next, pageSize, numPages, false);
              } else {
                notifier.next();
                notifier.complete();
                boatTarget.classList.remove("anime");
              }
            }
          }
        },
      });
      printBlocks(firstBlockID, pageSize, numPages, false);
    });

  document.getElementById("forward-button").addEventListener("click", load);
  document.getElementById("backward-button").addEventListener("click", load);

  document.getElementById("get-latest").addEventListener("click", printLatest);
  document.getElementById("get-status").addEventListener("click", printStatus);
}

// Called by the "next" and "previous" buttons. It fetches the options in case
// the user changed them, subscribe to the observer and then call the fetch
// function.
function load(e: Event) {
  if (lastBlock === undefined) {
    prependLog("please first load a page");
    return;
  }

  let reversed: boolean;
  let nextID: string;

  if ((e.currentTarget as HTMLInputElement).dataset.reversed === "true") {
    reversed = true;
    if (lastBlock.backlinks.length === 0) {
      prependLog("no more blocks to fetch (list of backlinks empty)");
      return;
    }
    nextID = lastBlock.backlinks[0].toString("hex");
  } else {
    reversed = false;
    if (lastBlock.forwardLinks.length === 0) {
      prependLog("no more blocks to fetch (list of forwardlinks empty)");
      return;
    }
    nextID = lastBlock.forwardLinks[0].to.toString("hex");
  }
  const pageSize = parseInt(numBlocksInput.value, 10);
  const numPages = parseInt(numPagesInput.value, 10);
  const repeat = parseInt(repeatCmdInput.value, 10);
  logEach = parseInt(logEachInput.value, 10);
  printDetails = detailsInput.checked;
  printRoster = rosterInput.checked;
  const notifier = new Subject();
  const startTime = performance.now();
  let pageDone = 0;
  let repeatCounter = 0;

  boatTarget.classList.add("anime");

  subject.pipe(takeUntil(notifier)).subscribe({
    // As a reminder: if the observer sends an error or a "complete" message,
    // we cannot use the observer anymore. This is why the ws callback does not
    // send an observer error if one occurs, since we need to keep the same
    // observer during the entire session.
    next: ([i, skipBlock]) => {
      if (i === pageSize) {
        pageDone++;
        if (pageDone === numPages) {
          printStat(startTime, pageDone * pageSize);
          if (repeatCounter < repeat) {
            repeatCounter++;
            let next: string;
            if (reversed) {
              next = skipBlock.backlinks[0].toString("hex");
            } else {
              next = skipBlock.forwardLinks[0].to.toString("hex");
            }
            pageDone = 0;
            printBlocks(next, pageSize, numPages, reversed);
          } else {
            notifier.next();
            notifier.complete();
            boatTarget.classList.remove("anime");
          }
        }
      }
    },
  });
  printBlocks(nextID, pageSize, numPages, reversed);
}

// This function calls the sendStream with the corresponding paginateBlocks
// request. If the ws is already defined, it does not create a new one by
// calling again the sendStream function, but directly call a send on the ws
function printBlocks(
  firstBlockID: string,
  pageSize: number,
  numPages: number,
  backward: boolean
) {
  let bid: Buffer;
  try {
    bid = hex2Bytes(firstBlockID);
  } catch (error) {
    prependLog("failed to parse the block ID: ", error);
    return;
  }

  let conn: WebSocketConnection;
  try {
    conn = new WebSocketConnection(
      roster.list[0].getWebSocketAddress(),
      ByzCoinRPC.serviceName
    );
  } catch (error) {
    prependLog("error creating conn: ", error);
    return;
  }

  if (ws === undefined) {
    let count = 0;

    conn
      .sendStream<PaginateResponse>(
        new PaginateRequest({
          backward,
          numpages: numPages,
          pagesize: pageSize,
          startid: bid,
        }),
        PaginateResponse
      )
      .subscribe({
        complete: () => {
          prependLog("closed");
        },
        error: (err: Error) => {
          prependLog("error: ", err);
          ws = undefined;
        },
        // ws callback "onMessage":
        next: ([data, localws]) => {
          // tslint:disable-next-line
          if (data.errorcode != 0) {
            prependLog(
              `got an error with code ${data.errorcode} : ${data.errortext}`
            );
            return;
          }
          if (localws !== undefined) {
            ws = localws;
          }
          let runCount = 0;
          for (const block of data.blocks) {
            runCount++;
            if (data.backward) {
              count--;
            } else {
              count++;
            }
            if (count % logEach === 0) {
              subject.next([runCount, block]);
              prependLog(printBlock(block, count, data.pagenumber));
            }
          }
          lastBlock = data.blocks[data.blocks.length - 1];
        },
      });
  } else {
    const message = new PaginateRequest({
      backward,
      numpages: numPages,
      pagesize: pageSize,
      startid: bid,
    });
    const messageByte = Buffer.from(message.$type.encode(message).finish());
    ws.send(messageByte);
  }
}

// Makes a short string representation of a block
function printBlock(
  block: SkipBlock,
  blockIndex: number,
  pageNum: number
): string {
  let output = `- block: ${blockIndex}, page ${pageNum}, hash: ${block.hash.toString(
    "hex"
  )}`;
  if (printDetails) {
    output += printDetailBlock(block);
  }
  if (printRoster) {
    output += printRosterBlock(block);
  }
  return output;
}

// Makes a detailed string representation of a block
function printDetailBlock(block: SkipBlock): string {
  let output = "";
  const payload = block.payload;
  const body = DataBody.decode(payload);
  const header = DataHeader.decode(block.data);
  const d = new Date(header.timestamp.div(1000000).toNumber());

  output += `\n-- Timestamps: ${d.toUTCString()}`;

  body.txResults.forEach((transaction, i) => {
    output += `\n-- Transaction ${i}`;
    output += `\n--- Accepted: ${transaction.accepted}`;
    transaction.clientTransaction.instructions.forEach((instruction, j) => {
      output += `\n--- Instruction ${j}`;
      output += `\n---- Hash: ${instruction.hash().toString("hex")}`;
      output += `\n---- Instance ID: ${instruction.instanceID.toString("hex")}`;
      if (instruction.spawn !== null) {
        output += `\n---- Spawn:`;
        output += `\n----- ContractID: ${instruction.spawn.contractID}`;
        output += `\n----- Empty DeriveID: ${instruction
          .deriveId("")
          .toString("hex")}`;
        output += `\n----- Args:`;
        instruction.spawn.args.forEach((arg, _) => {
          output += `\n------ Arg:`;
          output += `\n------- Name: ${arg.name}`;
          output += `\n------- Value: ${arg.value}`;
        });
      } else if (instruction.invoke !== null) {
        output += `\n---- Invoke:`;
        output += `\n----- Command: ${instruction.invoke.command}`;
        output += `\n----- ContractID: ${instruction.invoke.contractID}`;
        output += `\n----- Args:`;
        instruction.invoke.args.forEach((arg, _) => {
          output += `\n------ Arg:`;
          output += `\n------- Name: ${arg.name}`;
          output += `\n------- Value: ${arg.value}`;
        });
      } else if (instruction.delete !== null) {
        output += `\n---- Delete: ${instruction.delete}`;
      }
    });
  });
  output += `\n-- Verifiers (${block.verifiers.length}):`;
  block.verifiers.forEach((uid, j) => {
    output += `\n--- Verifier ${j}`;
    output += `\n---- ${uid.toString("hex")}`;
  });
  output += `\n-- Backlinks (${block.backlinks.length}):`;
  block.backlinks.forEach((value, j) => {
    output += `\n--- Backlink ${j}`;
    output += `\n---- ${value.toString("hex")}`;
  });
  output += `\n-- Forwardlinks (${block.forwardLinks.length}):`;
  block.forwardLinks.forEach((fl, j) => {
    output += `\n--- Forwardlink ${j}`;
    output += `\n---- from: ${fl.from.toString("hex")}`;
    output += `\n---- hash: ${fl.hash().toString("hex")}`;
    output += `\n---- signature: ${fl.signature.sig.toString("hex")}`;
  });
  return output;
}

function printRosterBlock(block: SkipBlock): string {
  let output = "";
  output += `\n-- Roster:`;
  output += `\n--- Aggregate: ${block.roster.aggregate.toString("hex")}`;
  output += `\n--- ServerIdentities (${block.roster.length})`;
  block.roster.list.forEach((si, j) => {
    output += `\n---- SeverIdentity ${j}`;
    output += `\n----- Address: ${si.address}`;
    output += `\n----- Public: ${si
      .getPublic()
      .marshalBinary()
      .toString("hex")}`;
    output += `\n----- Description: ${si.description}`;
    output += `\n----- URL: ${si.url}`;
  });
  return output;
}

// printLatest is the handler attached to the "Get latest" button.
function printLatest(e: Event) {
  let blockHash: string;

  if (lastBlock === undefined) {
    blockHash = inputBlock.value;
  } else {
    blockHash = lastBlock.hash.toString("hex");
  }

  boatTarget.classList.add("anime");
  prependLog(`getting latest block starting from ${blockHash}...`);

  getLatestBlock(blockHash).subscribe({
    error: (err) => {
      prependLog("failed to get latest block ", err);
    },
    next: (block) => {
      prependLog(
        `latest block found: ${block.hash.toString("hex")} with index ${
          block.index
        }`
      );
      boatTarget.classList.remove("anime");
    },
  });
}

// getLatestBlock follows the highest possible forward links from the given
// block ID (hex hash) until the last known block of the chain and notifies the
// observer with the latest block.
function getLatestBlock(startID: string): Observable<SkipBlock> {
  return new Observable((sub) => {
    let nextID = Buffer.from(startID, "hex");
    let conn: WebSocketConnection;

    try {
      conn = new WebSocketConnection(
        roster.list[0].getWebSocketAddress(),
        ByzCoinRPC.serviceName
      );
    } catch (error) {
      sub.error(error);
    }
    conn
      .sendStream<PaginateResponse>( // fetch next block
        new PaginateRequest({
          backward: false,
          numpages: 1,
          pagesize: 1,
          startid: nextID,
        }),
        PaginateResponse
      )
      .subscribe({
        complete: () => {
          sub.error("unexpected paginate complete");
        },
        error: (err: Error) => {
          sub.error(err);
        },
        // ws callback "onMessage":
        next: ([data, localws]) => {
          // tslint:disable-next-line
          if (data.errorcode != 0) {
            sub.error(data.errortext);
          }
          if (localws !== undefined) {
            ws = localws;
          }

          const block = data.blocks[0];
          if (block.forwardLinks.length === 0) {
            sub.next(block);
            sub.complete();
          } else {
            nextID = block.forwardLinks[block.forwardLinks.length - 1].to;
            const message = new PaginateRequest({
              backward: false,
              numpages: 1,
              pagesize: 1,
              startid: nextID,
            });
            const messageByte = Buffer.from(
              message.$type.encode(message).finish()
            );
            ws.send(messageByte); // fetch next block
          }
        },
      });
  });
}

// printStatus is the handler attached to the "Print status" button.
function printStatus(e: Event) {
  let blockHash: string;

  if (lastBlock === undefined) {
    blockHash = inputBlock.value;
  } else {
    blockHash = lastBlock.hash.toString("hex");
  }

  printDetails = detailsInput.checked;
  printRoster = rosterInput.checked;

  boatTarget.classList.add("anime");

  prependLog(
    `getting the roster from the latest block, starting from ${blockHash}...`
  );

  getLatestBlock(blockHash).subscribe({
    error: (err) => {
      prependLog("failed to get latest block ", err);
    },
    next: (block) => {
      prependLog(
        `latest block found: ${block.hash.toString("hex")} with index ${
          block.index
        }`
      );

      if (printRoster) {
        prependLog(`Using the following roster:\n${printRosterBlock(block)}`);
      }

      const status = new StatusRPC(block.roster);
      boatTarget.classList.remove("anime");
      for (let i = 0; i < block.roster.length; i++) {
        status.getStatus(i).then((resp) => {
          if (printDetails) {
            prependLog(resp.toString());
          } else {
            prependLog(
              `${block.roster.list[i].url} (${
                block.roster.list[i].address
              }):\n> uptime: ${resp
                .getStatus("Generic")
                .getValue("Uptime")}\n> Tx / Rx bytes: ${resp
                .getStatus("Generic")
                .getValue("TX_bytes")} / ${resp
                .getStatus("Generic")
                .getValue("RX_bytes")}`
            );
          }
        });
      }
    },
  });
}

//
// Print log stuff
//

let logCounter = 0;
let statusHolder: HTMLElement;
let keepScroll: HTMLInputElement;

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
  updateScroll();
}

function updateScroll() {
  if (keepScroll === undefined) {
    keepScroll = document.getElementById("keep-scroll") as HTMLInputElement;
  }
  if (keepScroll.checked === true) {
    statusHolder.scrollTop = statusHolder.scrollHeight;
  }
}

function hex2Bytes(hex: string) {
  if (!hex) {
    return Buffer.allocUnsafe(0);
  }

  return Buffer.from(hex, "hex");
}

function printStat(startTime: number, count: number) {
  const elapsed = performance.now() - startTime;
  statsTarget.innerText =
    "Took " +
    Math.round(elapsed * 100) / 100 +
    "ms for " +
    count +
    " blocks (" +
    Math.round((count / elapsed) * 1000 * 100) / 100 +
    " blocks/s)";
}

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
      Suite = "bn256.adapter"`;
