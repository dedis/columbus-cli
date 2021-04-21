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
import { Roster, ServerIdentity } from "@dedis/cothority/network/proto";
import { SkipBlock } from "@dedis/cothority/skipchain";
import { StatusRPC } from "@dedis/cothority/status";
import { Observable, Subject } from "rxjs";
import { takeUntil } from "rxjs/operators";
import {
  CatchUpMsg,
  CatchUpResponse,
  EmptyReply,
  Follow,
  Query,
  QueryReply,
  Unfollow,
} from "./bypros";
import WebSocket from "isomorphic-ws";

const byprosURL = "wss://bypros.epfl.ch/conode/ByzcoinProxy";

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
let sqlInput: HTMLTextAreaElement;
let catchupInput: HTMLInputElement;
let catchupUpdateInput: HTMLInputElement;
let adminPasswordInput: HTMLInputElement;
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

let adminOpen = false;

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
  sqlInput = document.getElementById("sql-input") as HTMLTextAreaElement;
  catchupInput = document.getElementById("catchup-input") as HTMLInputElement;
  catchupUpdateInput = document.getElementById(
    "catchup-update-input"
  ) as HTMLInputElement;
  adminPasswordInput = document.getElementById(
    "admin-password-input"
  ) as HTMLInputElement;

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

  document.getElementById("submit-sql").addEventListener("click", execSql);

  document.getElementById("admin-panel").addEventListener("click", adminToggle);
  document
    .getElementById("sql-start-follow")
    .addEventListener("click", sqlStartFollow);
  document
    .getElementById("sql-stop-follow")
    .addEventListener("click", sqlStopFollow);
  document.getElementById("sql-catchup").addEventListener("click", sqlCatchup);
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
          ws = undefined;
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
  output += `\n-- Index: ${block.index}`;

  body.txResults.forEach((transaction, i) => {
    output += `\n-- Transaction ${i}`;
    output += `\n--- Accepted: ${transaction.accepted}`;
    transaction.clientTransaction.instructions.forEach((instruction, j) => {
      const b = instruction.beautify();

      output += `\n--- Instruction ${j}`;
      output += `\n---- Hash: ${instruction.hash().toString("hex")}`;
      output += `\n---- Instance ID: ${instruction.instanceID.toString("hex")}`;
      if (instruction.spawn !== null) {
        output += `\n---- Spawn:`;
        output += `\n----- ContractID: ${instruction.spawn.contractID}`;
        output += `\n----- Empty DeriveID: ${instruction
          .deriveId("")
          .toString("hex")}`;
      } else if (instruction.invoke !== null) {
        output += `\n---- Invoke:`;
        output += `\n----- Command: ${instruction.invoke.command}`;
        output += `\n----- ContractID: ${instruction.invoke.contractID}`;
      } else if (instruction.delete !== null) {
        output += `\n---- Delete: ${instruction.delete}`;
      }
      output += `\n----- Args:`;
      b.args.forEach((arg: any, _: any) => {
        output += `\n------ Arg:`;
        output += `\n------- Name: ${arg.name}`;
        output += `\n------- Value: ${arg.value}`;
        if (arg.full !== undefined) {
          output += `\n------- Full: ${arg.full}`;
        }
      });
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
    output += `\n---- to: ${fl.to.toString("hex")}`;
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

function execSql(e: Event) {
  console.log("sql executed", sqlInput.value);

  const ws = new WebSocketConnection(
    "wss://bypros.epfl.ch/conode",
    "ByzcoinProxy"
  );

  const query = new Query();
  query.query = sqlInput.value;

  ws.send(query, QueryReply)
    .then((reply: QueryReply) => {
      console.log("reply:", reply.result.toString());
      prependLog(`SQL reply: ${reply.result.toString()}`);
    })
    .catch((e: any) => {
      console.log("error:", e);
      prependLog(`failed to send SQL query: ${e}`);
    });
}

function sqlStartFollow(e: Event) {
  var password = adminPasswordInput.value;

  const ws = new WebSocket(`${byprosURL}/Follow/${password}`);
  ws.binaryType = "arraybuffer";

  const msg = new Follow();
  msg.scid = hex2Bytes(
    "9cc36071ccb902a1de7e0d21a2c176d73894b1cf88ae4cc2ba4c95cd76f474f3"
  );
  msg.target = roster.list[0];

  ws.onmessage = (evt: { data: WebSocket.Data }): any => {
    if (evt.data instanceof Buffer || evt.data instanceof ArrayBuffer) {
      const buf = Buffer.from(evt.data);
      try {
        EmptyReply.decode(buf);
        prependLog(`got expected empty reply`);
      } catch (e) {
        prependLog(`error: ${e}`);
      }
    }
  };

  ws.onerror = (evt: { error: Error }) => {
    console.log(evt);
    prependLog(`error: ${evt.error}`);
  };

  ws.onclose = (evt: { code: number; reason: string }) => {
    if (evt.code === 1006) {
      prependLog(`abnormal close (probably a wrong password)`);
      return;
    }

    prependLog(`closed: ${evt.code} ${evt.reason}`);
  };

  const bytes = Buffer.from(Follow.$type.encode(msg).finish());
  ws.onopen = () => {
    ws.send(bytes);
  };
}

function sqlStopFollow(e: Event) {
  var password = adminPasswordInput.value;

  const ws = new WebSocket(`${byprosURL}/Unfollow/${password}`);
  ws.binaryType = "arraybuffer";

  const msg = new Unfollow();

  ws.onmessage = (evt: { data: WebSocket.Data }): any => {
    if (evt.data instanceof Buffer || evt.data instanceof ArrayBuffer) {
      const buf = Buffer.from(evt.data);
      try {
        EmptyReply.decode(buf);
        prependLog(`got expected empty reply`);
      } catch (e) {
        prependLog(`error: ${e}`);
      }
    }
  };

  ws.onerror = (evt: { error: Error }) => {
    console.log(evt);
    prependLog(`error: ${evt.error}`);
  };

  ws.onclose = (evt: { code: number; reason: string }) => {
    if (evt.code === 1006) {
      prependLog(`abnormal close (probably a wrong password)`);
      return;
    }

    prependLog(`closed: ${evt.code} ${evt.reason}`);
  };

  const bytes = Buffer.from(Unfollow.$type.encode(msg).finish());
  ws.onopen = () => {
    ws.send(bytes);
  };
}

function sqlCatchup(e: Event) {
  var password = adminPasswordInput.value;

  const ws = new WebSocket(`${byprosURL}/CatchUpMsg/${password}`);
  ws.binaryType = "arraybuffer";

  const blockHex = catchupInput.value;
  const block = hex2Bytes(blockHex);

  const updateEvery = parseInt(catchupUpdateInput.value, 10);

  console.log("catchup update input:", updateEvery);

  const msg = new CatchUpMsg();
  msg.fromblock = block;
  msg.scid = hex2Bytes(
    "9cc36071ccb902a1de7e0d21a2c176d73894b1cf88ae4cc2ba4c95cd76f474f3"
  );
  msg.target = roster.list[0];
  msg.updateevery = updateEvery;

  ws.onmessage = (evt: { data: WebSocket.Data }): any => {
    if (evt.data instanceof Buffer || evt.data instanceof ArrayBuffer) {
      const buf = Buffer.from(evt.data);
      try {
        const resp = CatchUpResponse.decode(buf);
        prependLog(`catch up response: ${resp.toString()}`);
      } catch (e) {
        prependLog(`error: ${e}`);
      }
    }
  };

  ws.onerror = (evt: { error: Error }) => {
    console.log(evt);
    prependLog(`error: ${evt.error}`);
  };

  ws.onclose = (evt: { code: number; reason: string }) => {
    if (evt.code === 1006) {
      prependLog(`abnormal close (probably a wrong password)`);
      return;
    }

    prependLog(`closed: ${evt.code} ${evt.reason}`);
  };

  const bytes = Buffer.from(CatchUpMsg.$type.encode(msg).finish());
  ws.onopen = () => {
    ws.send(bytes);
  };
}

function adminToggle(e: Event) {
  if (adminOpen) {
    adminOpen = false;
    this.innerHTML = "Open admin panel";
    document.getElementById("status").classList.remove("admin-open");
  } else {
    adminOpen = true;
    this.innerHTML = "Close admin panel";
    document.getElementById("status").classList.add("admin-open");
  }
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
Address = "tls://conode.dedis.ch:7000"
Suite = "Ed25519"
Public = "ec5c65a3c922d1df32075640e3de606197be24af76059a2ef145501122884bd3"
Description = "EPFL Cothority-server"
URL = "https://conode.dedis.ch"
[servers.Services]
  [servers.Services.ByzCoin]
    Public = "6f69dc10dbef8f4d80072aa9d1bee191b0f68b137a9d06d006c39fe6667738fa2d3439caf428a1dcb6f4a5bd2ce6ff6f1462ebb1b7374080d95310bc6e1115e105d7ae38f9fed1585094b0cb13dc3a0f3e74daeaa794ca10058e44ef339055510f4d12a7234779f8db2e093dd8a14a03440a7d5a8ef04cac8fd735f20440b589"
    Suite = "bn256.adapter"
  [servers.Services.Skipchain]
    Public = "32ba0cccec06ac4259b39102dcba13677eb385e0fdce99c93406542c5cbed3ec6ac71a81b01207451346402542923449ecf71fc0d69b1d019df34407b532fb2a09005c801e359afb377cc3255e918a096912bf6f7b7e4040532404996e05f78c408760b57fcf9e04c50eb7bc413438aca9d653dd0b6a8353d128370ebd4bdb10"
    Suite = "bn256.adapter"`;
