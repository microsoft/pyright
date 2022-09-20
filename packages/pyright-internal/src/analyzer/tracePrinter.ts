/*
 * tracePrinter.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Converts various types into a string representation.
 */

import { isMap, isSet } from 'util/types';

import { isArray, isBoolean, isNumber, isString } from '../common/core';
import { assertNever } from '../common/debug';
import { ensureTrailingDirectorySeparator, stripFileExtension } from '../common/pathUtils';
import { convertOffsetToPosition } from '../common/positionUtils';
import { isExpressionNode, ParseNode, ParseNodeType } from '../parser/parseNodes';
import { AbsoluteModuleDescriptor } from './analyzerFileInfo';
import * as AnalyzerNodeInfo from './analyzerNodeInfo';
import { Declaration, DeclarationType } from './declaration';
import * as ParseTreeUtils from './parseTreeUtils';
import { Symbol } from './symbol';
import { Type, TypeBase, TypeCategory } from './types';

const MAX_OBJECT_DEPTH = 3;

export type PrintableType = ParseNode | Declaration | Symbol | Type | object | undefined;

export interface TracePrinter {
    print(o: PrintableType): string;
    printFileOrModuleName(filePathOrModule: string | AbsoluteModuleDescriptor): string;
}

export function createTracePrinter(roots: string[]): TracePrinter {
    function wrap(value: string | undefined, ch = "'") {
        return value ? `${ch}${value}${ch}` : '';
    }

    // Sort roots in desc order so that we compare longer path first
    // when getting relative path.
    // ex) d:/root/.env/lib/site-packages, d:/root/.env
    roots = roots
        .map((r) => ensureTrailingDirectorySeparator(r))
        .sort((a, b) => a.localeCompare(b))
        .reverse();

    const separatorRegExp = /[\\/]/g;
    function printFileOrModuleName(filePathOrModule: string | AbsoluteModuleDescriptor | undefined) {
        if (filePathOrModule) {
            if (typeof filePathOrModule === 'string') {
                for (const root of roots) {
                    if (filePathOrModule.startsWith(root)) {
                        const subFile = filePathOrModule.substring(root.length);
                        return stripFileExtension(subFile).replace(separatorRegExp, '.');
                    }
                }

                return filePathOrModule;
            } else if (filePathOrModule.nameParts) {
                return filePathOrModule.nameParts.join('.');
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

                case TypeCategory.None:
                    return `None ${wrap(type.typeAliasInfo?.fullName)}`;

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
                    return `Alias, ${printNode(decl.node)} (${printFileOrModuleName(decl.path)})`;

                case DeclarationType.Class:
                    return `Class, ${printNode(decl.node)} (${printFileOrModuleName(decl.path)})`;

                case DeclarationType.Function:
                    return `Function, ${printNode(decl.node)} (${printFileOrModuleName(decl.path)})`;

                case DeclarationType.Intrinsic:
                    return `Intrinsic, ${printNode(decl.node)} ${decl.intrinsicType} (${printFileOrModuleName(
                        decl.path
                    )})`;

                case DeclarationType.Parameter:
                    return `Parameter, ${printNode(decl.node)} (${printFileOrModuleName(decl.path)})`;

                case DeclarationType.TypeParameter:
                    return `TypeParameter, ${printNode(decl.node)} (${printFileOrModuleName(decl.path)})`;

                case DeclarationType.SpecialBuiltInClass:
                    return `SpecialBuiltInClass, ${printNode(decl.node)} (${printFileOrModuleName(decl.path)})`;

                case DeclarationType.Variable:
                    return `Variable, ${printNode(decl.node)} (${printFileOrModuleName(decl.path)})`;

                case DeclarationType.TypeAlias:
                    return `TypeAlias, ${printNode(decl.node)} (${printFileOrModuleName(decl.path)})`;

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

        let path = printPath ? `(${printFileOrModuleName(getFileInfo(node)?.filePath)})` : '';

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

    function printObject(o: any, depth = 1) {
        if (depth > MAX_OBJECT_DEPTH) {
            return `[object]`;
        }
        const elem_indent = ' '.repeat((depth + 1) * 2);
        const obj_indent = ' '.repeat(depth * 2);
        const result: string[] = [];
        const keys = Object.keys(o);
        keys.forEach((k) => {
            result.push(`${elem_indent}${k} : ${print(o[k], depth + 1)}`);
        });

        return `\n${obj_indent}{\n${result.join('\n')}\n${obj_indent}}`;
    }

    function printArray(a: Array<any>, depth = 1) {
        const result: string[] = [];
        a.forEach((e) => {
            result.push(print(e, depth + 1));
        });
        return `[${result.join(',')}]`;
    }

    function printMap(m: Map<any, any>, depth = 1) {
        const result: string[] = [];
        m.forEach((v, k) => {
            result.push(`${k.toString()}=${print(v, depth + 1)}`);
        });
        return `{${result.join(',')}}`;
    }

    function printSet(s: Set<any>, depth = 1) {
        const result: string[] = [];
        s.forEach((v) => {
            result.push(print(v, depth + 1));
        });
        return `{${result.join(',')}}`;
    }

    function isNode(o: any): o is ParseNode {
        const n = o as ParseNode;
        return n && isNumber(n.nodeType);
    }

    function isDeclaration(o: any): o is Declaration {
        const d = o as Declaration;
        return d && isNumber(d.type) && isString(d.path) && isString(d.moduleName);
    }

    function isType(o: any): o is Type {
        const t = o as Type;
        return t && isNumber(t.category) && isNumber(t.flags);
    }

    function print(o: PrintableType, depth = 1) {
        if (o === undefined) {
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

        if (isArray(o)) {
            return printArray(o as Array<any>, depth);
        }

        if (isMap(o)) {
            return printMap(o as Map<any, any>, depth);
        }

        if (isSet(o)) {
            return printSet(o as Set<any>, depth);
        }

        if (typeof o === 'object') {
            return printObject(o as Object, depth);
        }

        if (isBoolean(o)) {
            return o ? 'true' : 'false';
        }

        if (isNumber(o)) {
            return `${o}`;
        }

        // Do nothing, we can't print it.
        return '';
    }

    return {
        print: print,
        printFileOrModuleName: printFileOrModuleName,
    };
}
