/*
 * workspaceSymbolProvider.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Provide LSP's workspace symbol functionality.
 */

import { CancellationToken, Location, ResultProgressReporter, SymbolInformation } from 'vscode-languageserver';
import { throwIfCancellationRequested } from '../common/cancellationUtils';
import * as StringUtils from '../common/stringUtils';
import { IndexSymbolData, SymbolIndexer } from './symbolIndexer';
import { ProgramView } from '../common/extensibility';
import { isUserCode } from '../analyzer/sourceFileInfoUtils';
import { getFileInfo } from '../analyzer/analyzerNodeInfo';
import { convertPathToUri } from '../common/pathUtils';
import { Workspace } from '../workspaceFactory';
import { appendArray } from '../common/collectionUtils';

type WorkspaceSymbolCallback = (symbols: SymbolInformation[]) => void;

export class WorkspaceSymbolProvider {
    private _reporter: WorkspaceSymbolCallback;
    private _allSymbols: SymbolInformation[] = [];

    constructor(
        private readonly _workspaces: Workspace[],
        resultReporter: ResultProgressReporter<SymbolInformation[]> | undefined,
        private readonly _query: string,
        private readonly _token: CancellationToken
    ) {
        this._reporter = resultReporter
            ? (symbols) => resultReporter.report(symbols)
            : (symbols) => appendArray(this._allSymbols, symbols);
    }

    reportSymbols(): SymbolInformation[] {
        for (const workspace of this._workspaces) {
            if (workspace.disableLanguageServices || workspace.disableWorkspaceSymbol) {
                continue;
            }

            if (!workspace.isInitialized.resolved()) {
                // If workspace is not resolved, ignore this workspace and move on.
                // We could wait for the initialization but that cause this to be async
                // so for now, we will just ignore any workspace that is not initialized yet.
                continue;
            }

            workspace.service.run((program) => {
                this._reportSymbolsForProgram(program);
            }, this._token);
        }

        return this._allSymbols;
    }

    protected getSymbolsForDocument(program: ProgramView, filePath: string): SymbolInformation[] {
        const symbolList: SymbolInformation[] = [];

        const parseResults = program.getParseResults(filePath);
        if (!parseResults) {
            return symbolList;
        }

        const fileInfo = getFileInfo(parseResults.parseTree);
        if (!fileInfo) {
            return symbolList;
        }

        const indexSymbolData = SymbolIndexer.indexSymbols(fileInfo, parseResults, this._token);
        this.appendWorkspaceSymbolsRecursive(indexSymbolData, program, filePath, '', symbolList);

        return symbolList;
    }

    protected appendWorkspaceSymbolsRecursive(
        indexSymbolData: IndexSymbolData[] | undefined,
        program: ProgramView,
        filePath: string,
        container: string,
        symbolList: SymbolInformation[]
    ) {
        throwIfCancellationRequested(this._token);

        if (!indexSymbolData) {
            return;
        }

        for (const symbolData of indexSymbolData) {
            if (symbolData.alias) {
                continue;
            }

            if (StringUtils.isPatternInSymbol(this._query, symbolData.name)) {
                const location: Location = {
                    uri: convertPathToUri(program.fileSystem, filePath),
                    range: symbolData.selectionRange!,
                };

                const symbolInfo: SymbolInformation = {
                    name: symbolData.name,
                    kind: symbolData.kind,
                    location,
                };

                if (container.length) {
                    symbolInfo.containerName = container;
                }

                symbolList.push(symbolInfo);
            }

            this.appendWorkspaceSymbolsRecursive(
                symbolData.children,
                program,
                filePath,
                this._getContainerName(container, symbolData.name),
                symbolList
            );
        }
    }

    private _reportSymbolsForProgram(program: ProgramView) {
        // Don't do a search if the query is empty. We'll return
        // too many results in this case.
        if (!this._query) {
            return;
        }

        // "Workspace symbols" searches symbols only from user code.
        for (const sourceFileInfo of program.getSourceFileInfoList()) {
            if (!isUserCode(sourceFileInfo)) {
                continue;
            }

            const symbolList = this.getSymbolsForDocument(program, sourceFileInfo.sourceFile.getFilePath());
            if (symbolList.length > 0) {
                this._reporter(symbolList);
            }

            // This operation can consume significant memory, so check
            // for situations where we need to discard the type cache.
            program.handleMemoryHighUsage();
        }
    }

    private _getContainerName(container: string, name: string) {
        if (container.length > 0) {
            return `${container}.${name}`;
        }

        return name;
    }
}
