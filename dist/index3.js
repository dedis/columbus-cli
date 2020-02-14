"use strict";
// src/index.ts
Object.defineProperty(exports, "__esModule", { value: true });
//
// Benchmark on the sendStream
//
const skipchain_1 = require("@dedis/cothority/skipchain");
const proto_1 = require("@dedis/cothority/network/proto");
const connection_1 = require("@dedis/cothority/network/connection");
const byzcoin_1 = require("@dedis/cothority/byzcoin");
const stream_1 = require("@dedis/cothority/byzcoin/proto/stream");
var lastBlock;
var numBlocksInput;
var numPagesInput;
var inputBlock;
var logEachInput;
var ws;
var statsTarget;
var logEach;
const NUM_BLOCKS = 4000;
var result = [];
var i = 1;
var firstBlockID;
function sayHi() {
    numBlocksInput = document.getElementById("num-blocks-input");
    numPagesInput = document.getElementById("num-pages-input");
    inputBlock = document.getElementById("block-input");
    logEachInput = document.getElementById("log-each-input");
    statsTarget = document.getElementById("stats-info");
    firstBlockID = inputBlock.value;
    document.getElementById("load-button").addEventListener("click", (e) => {
        const numBlocks = parseInt(numBlocksInput.value);
        const numPages = parseInt(numPagesInput.value);
        logEach = parseInt(logEachInput.value);
        statsTarget.innerText = "";
        console.log("load button");
        doStatIteration();
    });
    document.getElementById("forward-button").addEventListener("click", load);
    document.getElementById("backward-button").addEventListener("click", (e) => {
        if (lastBlock === undefined) {
            prependLog("please first load a page");
            return;
        }
        if (lastBlock.backlinks.length == 0) {
            prependLog("no more blocks to fetch");
            return;
        }
        const nextID = lastBlock.backlinks[0].toString("hex");
        const numBlocks = parseInt(numBlocksInput.value);
        const numPages = parseInt(numPagesInput.value);
        logEach = parseInt(logEachInput.value);
        printBlocks(nextID, numBlocks, numPages, true);
    });
}
exports.sayHi = sayHi;
function doStatIteration() {
    if (ws != undefined) {
        ws.close(1000, "new load");
        ws = undefined;
        console.log("ws closed...?");
    }
    for (; i <= NUM_BLOCKS;) {
        console.log("i = " + i);
        if (NUM_BLOCKS % i == 0) {
            var pageSize = NUM_BLOCKS / i;
            var numPages = i;
            statsTarget.innerText = "pageSize: " + pageSize + ", numPages: " + numPages;
            printBlocks(firstBlockID, pageSize, numPages, false);
            i++;
            return;
        }
        i++;
    }
    if (i == NUM_BLOCKS + 1) {
        console.log("here is the result: " + result);
        downloadCsv();
    }
}
function downloadCsv() {
    var csv = "pageSize, numPages, elapsed\n";
    result.forEach((row) => {
        csv += row.join(',');
        csv += "\n";
    });
    console.log(csv);
    var downloadLink = document.getElementById('download-link');
    downloadLink.href = 'data:text/csv;charset=utf-8,' + encodeURI(csv);
    downloadLink.target = '_blank';
    downloadLink.style.display = "block";
    downloadLink.download = 'result-' + NUM_BLOCKS + '.csv';
}
function load(e) {
    if (lastBlock === undefined) {
        prependLog("please first load a page");
        return;
    }
    if (lastBlock.forwardLinks.length == 0) {
        prependLog("no more blocks to fetch");
        return;
    }
    const nextID = lastBlock.forwardLinks[0].to.toString("hex");
    const numBlocks = parseInt(numBlocksInput.value);
    const numPages = parseInt(numPagesInput.value);
    logEach = parseInt(logEachInput.value);
    printBlocks(nextID, numBlocks, numPages, false);
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
        ws = conn3.sendStream(new stream_1.PaginateRequest({ startid: bid, pagesize: numBlocks, numpages: numPages, backward: backward }), stream_1.PaginateResponse, (data, ws) => {
            if (data.errorcode != 0) {
                prependLog("got an error with code ", data.errorcode, " : ", data.errortext);
                const elapsed = performance.now() - startTime;
                statsTarget.innerText = "Took " + elapsed + "ms for " + count + " blocks (" + (count / elapsed) * 1000 + " blocks/s)";
                return;
            }
            for (var i = 0; i < data.blocks.length; i++) {
                if (data.backward) {
                    count--;
                }
                else {
                    count++;
                }
            }
            if (count == numBlocks * numPages) {
                const elapsed = performance.now() - startTime;
                result.push([numBlocks, numPages, elapsed]);
                doStatIteration();
                return;
            }
            lastBlock = data.blocks[data.blocks.length - 1];
        }, (code, reason) => {
            prependLog("closed: ", code, reason);
        }, (err) => {
            prependLog("error: ", err);
            const elapsed = performance.now() - startTime;
            statsTarget.innerText = "Took " + elapsed + "ms for " + count + " blocks (" + (count / elapsed) * 1000 + " blocks/s)";
        });
    }
    else {
        console.error("WS should be undefined!");
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
