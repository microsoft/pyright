/*
 * dumpFileDebugInfoCommand.ts
 * Copyright (c) Microsoft Corporation.
 *
 * Dump various token/node/type info
 */

import { CancellationToken, ExecuteCommandParams } from 'vscode-languageserver';

import { getFlowNode } from '../analyzer/analyzerNodeInfo';
import { findNodeByOffset } from '../analyzer/parseTreeUtils';
import { throwIfCancellationRequested } from '../common/cancellationUtils';
import { dumpSyntaxInfo, dumpTokenInfo, dumpTypeInfo } from '../common/languageInfoUtils';
import { LanguageServerInterface } from '../common/languageServerInterface';
import { Uri } from '../common/uri/uri';
import { Workspace } from '../workspaceFactory';
import { ServerCommand } from './commandController';

export class DumpFileDebugInfoCommand implements ServerCommand {
    constructor(private _ls: LanguageServerInterface) {}

    async execute(params: ExecuteCommandParams, token: CancellationToken): Promise<any> {
        throwIfCancellationRequested(token);

        if (!params.arguments || params.arguments.length < 2) {
            return [];
        }

        const fileUri = Uri.parse(params.arguments[0] as string, this._ls.serviceProvider);
        const workspace = await this._ls.getWorkspaceForFile(fileUri);

        return new DumpFileDebugInfo().dump(workspace, fileUri, params.arguments, token);
    }
}

export class DumpFileDebugInfo {
    dump(workspace: Workspace, fileUri: Uri, args: any[], token: CancellationToken) {
        return workspace.service.run((p) => {
            const kind = args[1];

            const parseResults = workspace.service.getParseResults(workspace.service.fs.realCasePath(fileUri));
            if (!parseResults) {
                return [];
            }

            const output: string[] = [];
            const collectingConsole = {
                info: (m: string) => {
                    output.push(m);
                },
                log: (m: string) => {
                    output.push(m);
                },
                error: (m: string) => {
                    output.push(m);
                },
                warn: (m: string) => {
                    output.push(m);
                },
            };

            collectingConsole.info(`* Dump debug info for '${fileUri.toUserVisibleString()}'`);

            switch (kind) {
                case 'tokens': {
                    collectingConsole.info(dumpTokenInfo(fileUri, parseResults));
                    break;
                }
                case 'nodes': {
                    collectingConsole.info(dumpSyntaxInfo(fileUri, parseResults));
                    break;
                }
                case 'types': {
                    const evaluator = p.evaluator;
                    const start = args[2] as number;
                    const end = args[3] as number;
                    if (!evaluator || !start || !end) {
                        return [];
                    }

                    collectingConsole.info(dumpTypeInfo(fileUri, evaluator, parseResults, start, end));
                    break;
                }
                case 'cachedtypes': {
                    const evaluator = p.evaluator;
                    const start = args[2] as number;
                    const end = args[3] as number;
                    if (!evaluator || !start || !end) {
                        return [];
                    }

                    collectingConsole.info(dumpTypeInfo(fileUri, evaluator, parseResults, start, end, true));
                    break;
                }

                case 'codeflowgraph': {
                    const evaluator = p.evaluator;
                    const offset = args[2] as number;
                    if (!evaluator || offset === undefined) {
                        return [];
                    }
                    const node = findNodeByOffset(parseResults.parserOutput.parseTree, offset);
                    if (!node) {
                        return [];
                    }
                    const flowNode = getFlowNode(node);
                    if (!flowNode) {
                        return [];
                    }
                    collectingConsole.info(`* CodeFlow Graph`);
                    evaluator.printControlFlowGraph(flowNode, undefined, 'Dump CodeFlowGraph', collectingConsole);
                }
            }

            // Print all of the output in one message so the trace log is smaller.
            workspace.service.serviceProvider.console().info(output.join('\n'));
            return [];
        }, token);
    }
}
