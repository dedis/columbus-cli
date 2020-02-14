"use strict";
// src/index.ts
Object.defineProperty(exports, "__esModule", { value: true });
//
// Duplex streaming navigator
// An improved version
//
const skipchain_1 = require("@dedis/cothority/skipchain");
const proto_1 = require("@dedis/cothority/network/proto");
const connection_1 = require("@dedis/cothority/network/connection");
const byzcoin_1 = require("@dedis/cothority/byzcoin");
const proto_2 = require("@dedis/cothority/byzcoin/proto");
const stream_1 = require("@dedis/cothority/byzcoin/proto/stream");
const rxjs_1 = require("rxjs");
const operators_1 = require("rxjs/operators");
var lastBlock;
var numBlocksInput;
var numPagesInput;
var inputBlock;
var logEachInput;
var detailsInput;
var ws;
var statsTarget;
var logEach;
var printDetails;
const subject = new rxjs_1.Subject();
function sayHi() {
    numBlocksInput = document.getElementById("num-blocks-input");
    numPagesInput = document.getElementById("num-pages-input");
    inputBlock = document.getElementById("block-input");
    logEachInput = document.getElementById("log-each-input");
    statsTarget = document.getElementById("stats-info");
    detailsInput = document.getElementById("details-input");
    document.getElementById("load-button").addEventListener("click", (e) => {
        const firstBlockID = inputBlock.value;
        const numBlocks = parseInt(numBlocksInput.value);
        const numPages = parseInt(numPagesInput.value);
        logEach = parseInt(logEachInput.value);
        printDetails = detailsInput.checked;
        statsTarget.innerText = "";
        if (ws != undefined) {
            ws.close(1000, "new load");
            ws = undefined;
        }
        document.getElementById("status").innerHTML = "";
        const notifier = new rxjs_1.Subject();
        var startTime = performance.now();
        var pageDone = 0;
        subject.pipe(operators_1.takeUntil(notifier)).subscribe({
            next: (i) => {
                if (i == numBlocks) {
                    pageDone++;
                    if (pageDone == numPages) {
                        printStat(startTime, pageDone * numBlocks);
                        console.log("stop");
                        notifier.next();
                        notifier.complete();
                    }
                }
            }
        });
        printBlocks(firstBlockID, numBlocks, numPages, false);
    });
    document.getElementById("forward-button").addEventListener("click", load);
    document.getElementById("backward-button").addEventListener("click", load);
}
exports.sayHi = sayHi;
// Called by the "next" and "previous" buttons.
function load(e) {
    if (lastBlock === undefined) {
        prependLog("please first load a page");
        return;
    }
    var reversed;
    var nextID;
    if (e.currentTarget.dataset.reversed === "true") {
        reversed = true;
        if (lastBlock.backlinks.length == 0) {
            prependLog("no more blocks to fetch (list of backlinks empty");
            return;
        }
        nextID = lastBlock.backlinks[0].toString("hex");
    }
    else {
        reversed = false;
        if (lastBlock.forwardLinks.length == 0) {
            prependLog("no more blocks to fetch (list of forwardlinks empty");
            return;
        }
        nextID = lastBlock.forwardLinks[0].to.toString("hex");
    }
    const numBlocks = parseInt(numBlocksInput.value);
    const numPages = parseInt(numPagesInput.value);
    logEach = parseInt(logEachInput.value);
    printDetails = detailsInput.checked;
    const notifier = new rxjs_1.Subject();
    var startTime = performance.now();
    var pageDone = 0;
    subject.pipe(operators_1.takeUntil(notifier)).subscribe({
        next: (i) => {
            if (i == numBlocks) {
                pageDone++;
                if (pageDone == numPages) {
                    printStat(startTime, pageDone * numBlocks);
                    console.log("stop");
                    notifier.next();
                    notifier.complete();
                }
            }
        }
    });
    printBlocks(nextID, numBlocks, numPages, reversed);
}
function printBlocks(firstBlockID, numBlocks, numPages, backward) {
    var startTime = performance.now();
    const roster = proto_1.Roster.fromTOML(rosterStr);
    if (!roster) {
        console.error("roster is undefined");
        return;
    }
    var bid;
    try {
        bid = hex2Bytes(firstBlockID);
    }
    catch (error) {
        prependLog("failed to parse the block ID: ", error);
        return;
    }
    try {
        var conn = new connection_1.WebSocketConnection(roster.list[0].getWebSocketAddress(), skipchain_1.SkipchainRPC.serviceName);
    }
    catch (error) {
        prependLog("error creating conn: ", error);
    }
    try {
        var conn2 = new connection_1.RosterWSConnection(roster, skipchain_1.SkipchainRPC.serviceName, 1);
    }
    catch (error) {
        prependLog("error creating conn2: ", error);
    }
    const conn3 = conn2.copy(byzcoin_1.ByzCoinRPC.serviceName);
    var count = 0;
    if (ws === undefined) {
        ws = conn3.sendStream(new stream_1.PaginateRequest({
            startid: bid, pagesize: numBlocks, numpages: numPages,
            backward: backward
        }), stream_1.PaginateResponse, (data, ws) => {
            if (data.errorcode != 0) {
                prependLog("got an error with code ", data.errorcode, " : ", data.errortext);
                return;
            }
            var runCount = 0;
            for (var i = 0; i < data.blocks.length; i++) {
                runCount++;
                if (data.backward) {
                    count--;
                }
                else {
                    count++;
                }
                if (count % logEach == 0) {
                    subject.next(runCount);
                    var output = `- block: ${count}, page ${data.pagenumber}, hash: ${data.blocks[i].hash.toString("hex")}`;
                    if (printDetails) {
                        const payload = data.blocks[i].payload;
                        const body = proto_2.DataBody.decode(payload);
                        body.txResults.forEach((transaction, i) => {
                            output += `\n-- Transaction ${i}`;
                            transaction.clientTransaction.instructions.forEach((instruction, j) => {
                                output += `\n--- Instruction ${j}`;
                                output += `\n---- Hash: ${instruction.hash().toString("hex")}`;
                                output += `\n---- Instance ID: ${instruction.instanceID.toString("hex")}`;
                                if (instruction.spawn !== null) {
                                    output += `\n---- Spawn:`;
                                    output += `\n----- ContractID: ${instruction.spawn.contractID}`;
                                    output += `\n----- Args:`;
                                    instruction.spawn.args.forEach((arg, _) => {
                                        output += `\n------ Arg:`;
                                        output += `\n------- Name: ${arg.name}`;
                                        output += `\n------- Value: ${arg.value}`;
                                    });
                                }
                                else if (instruction.invoke !== null) {
                                    output += `\n---- Invoke:`;
                                    output += `\n----- ContractID: ${instruction.invoke.contractID}`;
                                    output += `\n----- Args:`;
                                    instruction.invoke.args.forEach((arg, _) => {
                                        output += `\n------ Arg:`;
                                        output += `\n------- Name: ${arg.name}`;
                                        output += `\n------- Value: ${arg.value}`;
                                    });
                                }
                                else if (instruction.delete !== null) {
                                    output += `\n---- Delete: ${instruction.delete}`;
                                }
                            });
                        });
                    }
                    prependLog(output);
                }
                if (count == numBlocks * numPages) {
                    printStat(startTime, count);
                }
            }
            lastBlock = data.blocks[data.blocks.length - 1];
        }, (code, reason) => {
            prependLog("closed: ", code, reason);
        }, (err) => {
            prependLog("error: ", err);
            ws = undefined;
            printStat(startTime, count);
        });
    }
    else {
        const message = new stream_1.PaginateRequest({ startid: bid, pagesize: numBlocks, numpages: numPages, backward: backward });
        const messageByte = Buffer.from(message.$type.encode(message).finish());
        ws.send(messageByte);
    }
}
var logCounter = 0;
var blockCounter = 0;
var statusHolder;
var keepScroll;
var t0;
function prependLog(...nodes) {
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
exports.prependLog = prependLog;
function updateScroll() {
    if (keepScroll === undefined) {
        keepScroll = document.getElementById("keep-scroll");
    }
    if (keepScroll.checked == true) {
        statusHolder.scrollTop = statusHolder.scrollHeight;
    }
}
function hex2Bytes(hex) {
    if (!hex) {
        return Buffer.allocUnsafe(0);
    }
    return Buffer.from(hex, 'hex');
}
function printStat(startTime, count) {
    const elapsed = performance.now() - startTime;
    statsTarget.innerText = "Took " + elapsed + "ms for " + count + " blocks (" + (count / elapsed) * 1000 + " blocks/s)";
}
const chainId = "763d28aa5a2cb9d2811f6c86ac72c653c3a8350ee7e4441a9ae4f53148f93e48";
const blockId = "7878ac2ed5010190f955a2c23b2f8e95f1c33d815e1d2351da39286e17980ca4";
const genesis = "0000000000000000000000000000000000000000000000000000000000000000";
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
