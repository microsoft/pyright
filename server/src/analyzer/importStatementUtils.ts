/*
* importStatementUtils.ts
* Copyright (c) Microsoft Corporation.
* Licensed under the MIT license.
* Author: Eric Traut
*
* Utility routines for summarizing and manipulating
* import statements in a python source file.
*/

import { ImportAsNode, ImportFromNode, ImportNode,
    ModuleNameNode, ModuleNode, StatementListNode } from '../parser/parseNodes';
import { AnalyzerNodeInfo } from './analyzerNodeInfo';
import { ImportResult } from './importResult';

interface LocalImport {
    node: ImportAsNode | ImportFromNode;
    importResult: ImportResult | undefined;
    resolvedPath: string | undefined;
    moduleName: string;
}

interface LocalImports {
    orderedImports: LocalImport[];
    mapByFilePath: { [filePath: string ]: LocalImport };
}

export class ImportStatementUtils {
    // Looks for top-level 'import' and 'import from' statements and provides
    // an ordered list and a map (by file path).
    static getTopLevelImports(parseTree: ModuleNode): LocalImports {
        const localImports: LocalImports = {
            orderedImports: [],
            mapByFilePath: {}
        };

        parseTree.statements.forEach(statement => {
            if (statement instanceof StatementListNode) {
                statement.statements.forEach(subStatement => {
                    if (subStatement instanceof ImportNode) {
                        this._processImportNode(subStatement, localImports);
                    } else if (subStatement instanceof ImportFromNode) {
                        this._processImportFromNode(subStatement, localImports);
                    }
                });
            }
        });

        return localImports;
    }

    private static _processImportNode(node: ImportNode, localImports: LocalImports) {
        node.list.forEach(importAsNode => {
            const importResult = AnalyzerNodeInfo.getImportInfo(importAsNode.module);
            let resolvedPath: string | undefined;

            if (importResult && importResult.isImportFound) {
                resolvedPath = importResult.resolvedPaths[importResult.resolvedPaths.length - 1];
            }

            const localImport: LocalImport = {
                node: importAsNode,
                importResult,
                resolvedPath,
                moduleName: this._formatModuleName(importAsNode.module)
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

    private static _processImportFromNode(node: ImportFromNode, localImports: LocalImports) {
        const importResult = AnalyzerNodeInfo.getImportInfo(node.module);
        let resolvedPath: string | undefined;

        if (importResult && importResult.isImportFound) {
            resolvedPath = importResult.resolvedPaths[importResult.resolvedPaths.length - 1];
        }

        const localImport: LocalImport = {
            node,
            importResult,
            resolvedPath,
            moduleName: this._formatModuleName(node.module)
        };

        localImports.orderedImports.push(localImport);

        // Add it to the map.
        if (resolvedPath) {
            // Always overwrite existing import or import from statements
            // because we always want to prefer 'import from' over 'import'
            // in the map.
            localImports.mapByFilePath[resolvedPath] = localImport;
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
