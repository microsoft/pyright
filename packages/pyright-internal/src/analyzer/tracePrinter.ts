/*
 * tracePrinter.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Converts various types into string representations.
 */

import { isNumber, isString } from '../common/core';
import { assertNever } from '../common/debug';
import { stripFileExtension } from '../common/pathUtils';
import { convertOffsetToPosition } from '../common/positionUtils';
import { Uri } from '../common/uri/uri';
import { ParseNode, ParseNodeType, isExpressionNode } from '../parser/parseNodes';
import { AbsoluteModuleDescriptor } from './analyzerFileInfo';
import * as AnalyzerNodeInfo from './analyzerNodeInfo';
import { Declaration, DeclarationType } from './declaration';
import * as ParseTreeUtils from './parseTreeUtils';
import { Symbol } from './symbol';
import { Type, TypeBase, TypeCategory } from './types';

export type PrintableType = ParseNode | Declaration | Symbol | Type | undefined;

export interface TracePrinter {
    print(o: PrintableType): string;
    printFileOrModuleName(fileUriOrModule: Uri | AbsoluteModuleDescriptor): string;
}

export function createTracePrinter(roots: Uri[]): TracePrinter {
    function wrap(value: string | undefined, ch = "'") {
        return value ? `${ch}${value}${ch}` : '';
    }

    // Sort roots in desc order so that we compare longer path first
    // when getting relative path.
    // ex) d:/root/.env/lib/site-packages, d:/root/.env
    roots = roots.sort((a, b) => a.key.localeCompare(b.key)).reverse();

    const separatorRegExp = /[\\/]/g;
    function printFileOrModuleName(fileUriOrModule: Uri | AbsoluteModuleDescriptor | undefined) {
        if (fileUriOrModule) {
            if (Uri.is(fileUriOrModule)) {
                for (const root of roots) {
                    if (fileUriOrModule.isChild(root)) {
                        const subFile = root.getRelativePath(fileUriOrModule);
                        return stripFileExtension(subFile!).replace(separatorRegExp, '.');
                    }
                }

                return fileUriOrModule.toUserVisibleString();
            } else if (fileUriOrModule.nameParts) {
                return fileUriOrModule.nameParts.join('.');
            }
        }
        return '';
    }

    function printType(type: Type | undefined): string {
        if (type) {
            switch (type.category) {
                case TypeCategory.Any:
                    return `Any ${wrap(type.typeAliasInfo?.fullName)}`;

                case TypeCategory.Class:
                    if (TypeBase.isInstantiable(type)) {
                        return `Class '${type.details.name}' (${type.details.moduleName})`;
                    } else {
                        return `Object '${type.details.name}' (${type.details.moduleName})`;
                    }

                case TypeCategory.Function:
                    return `Function '${type.details.name}' (${type.details.moduleName})`;

                case TypeCategory.Module:
                    return `Module '${type.moduleName}' (${type.moduleName})`;

                case TypeCategory.Never:
                    return `Never ${wrap(type.typeAliasInfo?.fullName)}`;

                case TypeCategory.OverloadedFunction:
                    return `OverloadedFunction [${type.overloads.map((o) => wrap(printType(o), '"')).join(',')}]`;

                case TypeCategory.TypeVar:
                    return `TypeVar '${type.details.name}' ${wrap(type.typeAliasInfo?.fullName)}`;

                case TypeCategory.Unbound:
                    return `Unbound ${wrap(type.typeAliasInfo?.fullName)}`;

                case TypeCategory.Union:
                    return `Union [${type.subtypes.map((o) => wrap(printType(o), '"')).join(',')}]`;

                case TypeCategory.Unknown:
                    return `Unknown ${wrap(type.typeAliasInfo?.fullName)}`;

                default:
                    assertNever(type);
            }
        }
        return '';
    }

    function printSymbol(symbol: Symbol | undefined) {
        if (symbol) {
            if (symbol.hasDeclarations()) {
                return `symbol ${printDeclaration(symbol.getDeclarations()[0])}`;
            }

            return `<symbol>`;
        }

        return '';
    }

    function printDeclaration(decl: Declaration | undefined) {
        if (decl) {
            switch (decl.type) {
                case DeclarationType.Alias:
                    return `Alias, ${printNode(decl.node)} (${printFileOrModuleName(decl.uri)})`;

                case DeclarationType.Class:
                    return `Class, ${printNode(decl.node)} (${printFileOrModuleName(decl.uri)})`;

                case DeclarationType.Function:
                    return `Function, ${printNode(decl.node)} (${printFileOrModuleName(decl.uri)})`;

                case DeclarationType.Intrinsic:
                    return `Intrinsic, ${printNode(decl.node)} ${decl.intrinsicType} (${printFileOrModuleName(
                        decl.uri
                    )})`;

                case DeclarationType.Parameter:
                    return `Parameter, ${printNode(decl.node)} (${printFileOrModuleName(decl.uri)})`;

                case DeclarationType.TypeParameter:
                    return `TypeParameter, ${printNode(decl.node)} (${printFileOrModuleName(decl.uri)})`;

                case DeclarationType.SpecialBuiltInClass:
                    return `SpecialBuiltInClass, ${printNode(decl.node)} (${printFileOrModuleName(decl.uri)})`;

                case DeclarationType.Variable:
                    return `Variable, ${printNode(decl.node)} (${printFileOrModuleName(decl.uri)})`;

                case DeclarationType.TypeAlias:
                    return `TypeAlias, ${printNode(decl.node)} (${printFileOrModuleName(decl.uri)})`;

                default:
                    assertNever(decl);
            }
        }

        return '';
    }

    function getFileInfo(node: ParseNode) {
        while (node.nodeType !== ParseNodeType.Module && node.parent) {
            node = node.parent;
        }

        return node.nodeType === ParseNodeType.Module ? AnalyzerNodeInfo.getFileInfo(node) : undefined;
    }

    function getText(value: string, max = 30) {
        if (value.length < max) {
            return value;
        }

        return value.substring(0, max) + ' <shortened> ';
    }

    function printNode(node: ParseNode | undefined, printPath = false): string {
        if (!node) {
            return '';
        }

        let path = printPath ? `(${printFileOrModuleName(getFileInfo(node)?.fileUri)})` : '';

        const fileInfo = getFileInfo(node);
        if (fileInfo?.lines) {
            const position = convertOffsetToPosition(node.start, fileInfo.lines);
            path += ` [${position.line + 1}:${position.character + 1}]`;
        }

        if (isExpressionNode(node)) {
            return wrap(getText(ParseTreeUtils.printExpression(node)), '"') + ` ${path}`;
        }

        switch (node.nodeType) {
            case ParseNodeType.ImportAs:
                return `importAs '${printNode(node.module)}' ${wrap(node.alias ? printNode(node.alias) : '')} ${path}`;

            case ParseNodeType.ImportFrom:
                return `importFrom [${node.imports.map((i) => wrap(printNode(i), '"')).join(',')}]`;

            case ParseNodeType.ImportFromAs:
                return `ImportFromAs '${printNode(node.name)}' ${wrap(
                    node.alias ? printNode(node.alias) : ''
                )} ${path}`;

            case ParseNodeType.Module:
                return `module ${path}`;

            case ParseNodeType.Class:
                return `class '${printNode(node.name)}' ${path}`;

            case ParseNodeType.Function:
                return `function '${printNode(node.name)}' ${path}`;

            case ParseNodeType.ModuleName:
                return `moduleName '${node.nameParts.map((n) => printNode(n)).join('.')}' ${path}`;

            case ParseNodeType.Argument:
                return `argument '${node.name ? printNode(node.name) : 'N/A'}' ${path}`;

            case ParseNodeType.Parameter:
                return `parameter '${node.name ? printNode(node.name) : 'N/A'}' ${path}`;

            default:
                return `${ParseTreeUtils.printParseNodeType(node.nodeType)} ${path}`;
        }
    }

    function isNode(o: any): o is ParseNode {
        const n = o as ParseNode;
        return n && isNumber(n.nodeType);
    }

    function isDeclaration(o: any): o is Declaration {
        const d = o as Declaration;
        return d && isNumber(d.type) && Uri.is(d.uri) && isString(d.moduleName);
    }

    function isType(o: any): o is Type {
        const t = o as Type;
        return t && isNumber(t.category) && isNumber(t.flags);
    }

    function print(o: PrintableType) {
        if (!o) {
            return '';
        }

        if (isNode(o)) {
            return printNode(o, /* printPath */ true);
        }

        if (isDeclaration(o)) {
            return printDeclaration(o as Declaration);
        }

        if (o instanceof Symbol) {
            return printSymbol(o);
        }

        if (isType(o)) {
            return printType(o as Type);
        }

        // Do nothing, we can't print it.
        return '';
    }

    return {
        print: print,
        printFileOrModuleName: printFileOrModuleName,
    };
}
