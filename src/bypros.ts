import { network } from "@dedis/cothority";
import { addJSON, registerMessage } from "@dedis/cothority/protobuf";
import { Message } from "protobufjs/light";
import models from './protobuf/models.json';

export class Query extends Message<Query> {
    static register () {
        registerMessage('bypros.Query', Query)
    }

    query: string;
}

export class QueryReply extends Message<QueryReply> {
    static register () {
        registerMessage('bypros.QueryReply', QueryReply)
    }

    readonly result: Buffer;
}

export class Follow extends Message<Follow> {
    static register () {
        registerMessage('bypros.Follow', Follow)
    }

    scid: Buffer;
    target: network.ServerIdentity;
}

export class EmptyReply extends Message<EmptyReply> {
    static register () {
        registerMessage('bypros.EmptyReply', EmptyReply)
    }
}

export class Unfollow extends Message<Unfollow> {
    static register () {
        registerMessage('bypros.Unfollow', Unfollow)
    }
}

export class CatchUpMsg extends Message<CatchUpMsg> {
    static register () {
        registerMessage('bypros.CatchUpMsg', CatchUpMsg)
    }

    scid: Buffer;
    target: network.ServerIdentity;
    fromblock: Buffer;
    updateevery: number;
}

export class CatchUpResponse extends Message<CatchUpResponse> {
    static register () {
        registerMessage('bypros.CatchUpResponse', CatchUpResponse, CatchUpStatus)
    }

    status: CatchUpStatus;
    done: boolean;
    err: string;

    toString(): string {
        return `status: ${this.status.toString()}, done: ${this.done}, err: ${this.err}`
    }
}

export class CatchUpStatus extends Message<CatchUpStatus> {
    static register () {
        registerMessage('bypros.CatchUpStatus', CatchUpStatus)
    }

    message: string;
    blockindex: number;
    blockhash: Buffer;

    toString(): string {
        return `message: ${this.message}, block index: ${this.blockindex}, block hash: ${this.blockhash.toString("hex")}`
    }
}

addJSON(models);

Query.register();
QueryReply.register();
Follow.register();
EmptyReply.register();
Unfollow.register();
CatchUpMsg.register();
CatchUpResponse.register();
CatchUpStatus.register();
