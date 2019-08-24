/*
* importStatementUtils.ts
* Copyright (c) Microsoft Corporation.
* Licensed under the MIT license.
* Author: Eric Traut
*
* Utility routines for summarizing and manipulating
* import statements in a python source file.
*/

import { ImportFromNode, ImportNode, ModuleNameNode, ModuleNode,
    StatementListNode } from '../parser/parseNodes';
import { AnalyzerNodeInfo } from './analyzerNodeInfo';
import { ImportResult } from './importResult';

export interface ImportStatement {
    node: ImportNode | ImportFromNode;
    importResult: ImportResult | undefined;
    resolvedPath: string | undefined;
    moduleName: string;
    followsNonImportStatement: boolean;
}

export interface ImportStatements {
    orderedImports: ImportStatement[];
    mapByFilePath: { [filePath: string ]: ImportStatement };
}

export class ImportStatementUtils {
    // Looks for top-level 'import' and 'import from' statements and provides
    // an ordered list and a map (by file path).
    static getTopLevelImports(parseTree: ModuleNode): ImportStatements {
        const localImports: ImportStatements = {
            orderedImports: [],
            mapByFilePath: {}
        };

        let followsNonImportStatement = false;
        let foundFirstImportStatement = false;

        parseTree.statements.forEach(statement => {
            if (statement instanceof StatementListNode) {
                statement.statements.forEach(subStatement => {
                    if (subStatement instanceof ImportNode) {
                        foundFirstImportStatement = true;
                        this._processImportNode(subStatement, localImports, followsNonImportStatement);
                        followsNonImportStatement = false;
                    } else if (subStatement instanceof ImportFromNode) {
                        foundFirstImportStatement = true;
                        this._processImportFromNode(subStatement, localImports, followsNonImportStatement);
                        followsNonImportStatement = false;
                    } else {
                        followsNonImportStatement = foundFirstImportStatement;
                    }
                });
            } else {
                followsNonImportStatement = foundFirstImportStatement;
            }
        });

        return localImports;
    }

    private static _processImportNode(node: ImportNode, localImports: ImportStatements,
            followsNonImportStatement: boolean) {

        node.list.forEach(importAsNode => {
            const importResult = AnalyzerNodeInfo.getImportInfo(importAsNode.module);
            let resolvedPath: string | undefined;

            if (importResult && importResult.isImportFound) {
                resolvedPath = importResult.resolvedPaths[importResult.resolvedPaths.length - 1];
            }

            const localImport: ImportStatement = {
                node,
                importResult,
                resolvedPath,
                moduleName: this._formatModuleName(importAsNode.module),
                followsNonImportStatement
            };

            localImports.orderedImports.push(localImport);

            // Add it to the map.
            if (resolvedPath) {
                // Don't overwrite existing import or import from statements
                // because we always want to prefer 'import from' over 'import'
                // in the map.
                if (!localImports.mapByFilePath[resolvedPath]) {
                    localImports.mapByFilePath[resolvedPath] = localImport;
                }
            }
        });
    }

    private static _processImportFromNode(node: ImportFromNode, localImports: ImportStatements,
            followsNonImportStatement: boolean) {

        const importResult = AnalyzerNodeInfo.getImportInfo(node.module);
        let resolvedPath: string | undefined;

        if (importResult && importResult.isImportFound) {
            resolvedPath = importResult.resolvedPaths[importResult.resolvedPaths.length - 1];
        }

        const localImport: ImportStatement = {
            node,
            importResult,
            resolvedPath,
            moduleName: this._formatModuleName(node.module),
            followsNonImportStatement
        };

        localImports.orderedImports.push(localImport);

        // Add it to the map.
        if (resolvedPath) {
            const prevEntry = localImports.mapByFilePath[resolvedPath];
            // Overwrite existing import statements because we always want to prefer
            // 'import from' over 'import'. Also, overwrite existing 'import from' if
            // the module name is shorter.
            if (!prevEntry || prevEntry.node instanceof ImportNode || prevEntry.moduleName.length > localImport.moduleName.length) {
                localImports.mapByFilePath[resolvedPath] = localImport;
            }
        }
    }

    private static _formatModuleName(node: ModuleNameNode): string {
        let moduleName = '';
        for (let i = 0; i < node.leadingDots; i++) {
            moduleName = moduleName + '.';
        }

        moduleName += node.nameParts.map(part => part.nameToken.value).join('.');

        return moduleName;
    }
}
