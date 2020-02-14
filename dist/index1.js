"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
// src/index.ts
//
// Use the standard getSkipBlock, ie no stream.
//
const skipchain_1 = require("@dedis/cothority/skipchain");
const network_1 = require("@dedis/cothority/network");
const connection_1 = require("@dedis/cothority/network/connection");
const proto_1 = require("@dedis/cothority/status/proto");
const status_rpc_1 = tslib_1.__importDefault(require("@dedis/cothority/status/status-rpc"));
const proto_2 = require("@dedis/cothority/byzcoin/proto");
function sayHi() {
    prependLog("setting the roster...");
    const roster = network_1.Roster.fromTOML(rosterStr);
    console.log(roster);
    if (!roster) {
        console.error("roster is undefined");
        return;
    }
    prependLog("Pinging nodes", 10);
    var conn = new connection_1.RosterWSConnection(roster, status_rpc_1.default.serviceName);
    pingNodes(conn, roster).then(conn => {
        printBlocks(conn);
    });
}
exports.sayHi = sayHi;
function printBlocks(conn) {
    // 24578
    const rpc = new skipchain_1.SkipchainRPC(conn);
    rpc.getSkipBlock(hex2Bytes(chainId)).then((r) => {
        t0 = performance.now();
        printBlock(r, rpc);
    }, (e) => {
        prependLog("failed to load latest:", e);
    }).then(_ => prependLog("hi"));
}
async function pingNodes(conn, roster) {
    conn.setParallel(roster.length);
    for (let i = 0; i < 1; i++) {
        await conn.send(new proto_1.StatusRequest(), proto_1.StatusResponse);
        var url = conn.getURL();
        prependLog(`Fastest node at ${i}/10: ${url}`, 20 + i * 15);
    }
    conn.setParallel(1);
    return conn;
}
function printBlock(r, rpc) {
    blockCounter += 1;
    prependLog("- Block ", blockCounter, ": ", r.hash.toString("hex"));
    const data = r.payload;
    const body = proto_2.DataBody.decode(data);
    body.txResults.forEach((transaction, i) => {
        prependLog("-- Transaction " + i);
        transaction.clientTransaction.instructions.forEach((instruction, j) => {
            prependLog("--- Instruction ", j);
            prependLog("---- Hash: ", instruction.hash().toString("hex"));
            prependLog("---- Instance ID: ", instruction.instanceID.toString("hex"));
            if (instruction.spawn !== null) {
                prependLog("---- Spawn: ");
                prependLog("----- Args: ");
                instruction.spawn.args.forEach((arg, _) => {
                    prependLog("------ Arg: ");
                    prependLog("------- Name: ", arg.name);
                    prependLog("------- Value: ", arg.value);
                });
            }
            else if (instruction.invoke !== null) {
                prependLog("---- Invoke: ", instruction.invoke);
            }
            else if (instruction.delete !== null) {
                prependLog("---- Delete: ", instruction.delete);
            }
        });
    });
    if (r.forwardLinks.length > 0 && blockCounter < 0) {
        const next_id = r.forwardLinks[0].to;
        rpc.getSkipBlock(next_id).then(r => {
            printBlock(r, rpc);
        });
    }
    else {
        var t1 = performance.now();
        prependLog("Retreived ", blockCounter, " blocks in ", (t1 - t0), " ms, which is about ", (blockCounter / (t1 - t0)) * 1000, " block/s");
    }
}
exports.printBlock = printBlock;
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
const chainId = "9cc36071ccb902a1de7e0d21a2c176d73894b1cf88ae4cc2ba4c95cd76f474f3";
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
