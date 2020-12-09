/*
 * packageTypeVerifier.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Validates the public symbols exported by a package to ensure
 * that the types are complete.
 */

import { ConfigOptions, ExecutionEnvironment } from '../common/configOptions';
import { Diagnostic, DiagnosticAddendum, DiagnosticCategory } from '../common/diagnostic';
import { FileSystem } from '../common/fileSystem';
import { combinePaths, getDirectoryPath, getFileExtension, stripFileExtension } from '../common/pathUtils';
import { getEmptyRange } from '../common/textRange';
import { DeclarationType, FunctionDeclaration, VariableDeclaration } from './declaration';
import { ImportedModuleDescriptor, ImportResolver } from './importResolver';
import { Program } from './program';
import { getPyTypedInfo } from './pyTypedUtils';
import { ScopeType } from './scope';
import { getScopeForNode } from './scopeUtils';
import { Symbol, SymbolTable } from './symbol';
import { isDunderName, isPrivateOrProtectedName } from './symbolNameUtils';
import {
    ClassType,
    isClass,
    isFunction,
    isOverloadedFunction,
    isTypeVar,
    isUnknown,
    ModuleType,
    Type,
    TypeCategory,
} from './types';
import { convertToInstance, doForEachSubtype, isEllipsisType, transformTypeObjectToClass } from './typeUtils';

export enum PackageSymbolType {
    Indeterminate,
    Module,
    Class,
    Variable,
    Constant,
    Function,
    Method,
    TypeVar,
    TypeAlias,
}

export interface PackageSymbol {
    name: string;
    fullName: string;
    symbolType: PackageSymbolType;
}

export interface PackageModule {
    name: string;
    symbols: PackageSymbol[];
}

export interface PackageTypeReport {
    packageName: string;
    rootDirectory: string | undefined;
    pyTypedPath: string | undefined;
    symbolCount: number;
    unknownTypeCount: number;
    missingFunctionDocStringCount: number;
    missingClassDocStringCount: number;
    missingDefaultParamCount: number;
    modules: PackageModule[];
    diagnostics: Diagnostic[];
}

interface TypeVerificationInfo {
    isFullyKnown: boolean;
    diag: DiagnosticAddendum;

    // For classes, the above fields apply only to base types. Field-level
    // type information and diagnostic information are provided on a per-field
    // basis. This allows subclasses to potentially override fields that are
    // missing types, thus making the field properly typed. This can happen
    // when the base class is a private class (e.g. an abstract class) but the
    // derived class is public.
    classFields: Map<string, TypeVerificationInfo> | undefined;
}

type PublicSymbolMap = Map<string, string>;

const maxTypeRecursionCount = 16;
const diagnosticMaxDepth = 16;
const diagnosticMaxLineCount = 32;

export class PackageTypeVerifier {
    private _configOptions: ConfigOptions;
    private _execEnv: ExecutionEnvironment;
    private _importResolver: ImportResolver;
    private _program: Program;
    private _typeCache = new Map<string, TypeVerificationInfo>();

    constructor(private _fileSystem: FileSystem) {
        this._configOptions = new ConfigOptions('');
        this._execEnv = this._configOptions.findExecEnvironment('.');
        this._importResolver = new ImportResolver(this._fileSystem, this._configOptions);
        this._program = new Program(this._importResolver, this._configOptions);
    }

    verify(packageName: string): PackageTypeReport {
        const trimmedPackageName = packageName.trim();

        const report: PackageTypeReport = {
            packageName: trimmedPackageName,
            rootDirectory: this._getDirectoryForPackage(trimmedPackageName),
            pyTypedPath: undefined,
            symbolCount: 0,
            unknownTypeCount: 0,
            missingFunctionDocStringCount: 0,
            missingClassDocStringCount: 0,
            missingDefaultParamCount: 0,
            modules: [],
            diagnostics: [],
        };

        try {
            if (!trimmedPackageName || trimmedPackageName.includes('.')) {
                report.diagnostics.push(
                    new Diagnostic(
                        DiagnosticCategory.Error,
                        `Package name "${trimmedPackageName}" is invalid`,
                        getEmptyRange()
                    )
                );
            } else if (!report.rootDirectory) {
                report.diagnostics.push(
                    new Diagnostic(
                        DiagnosticCategory.Error,
                        `Package "${trimmedPackageName}" cannot be resolved`,
                        getEmptyRange()
                    )
                );
            } else {
                const pyTypedInfo = getPyTypedInfo(this._fileSystem, report.rootDirectory);
                if (!pyTypedInfo.isPyTypedPresent) {
                    report.diagnostics.push(
                        new Diagnostic(DiagnosticCategory.Error, 'No py.typed file found', getEmptyRange())
                    );
                } else {
                    report.pyTypedPath = pyTypedInfo.pyTypedPath;

                    const publicModules = this._getListOfPublicModules(report.rootDirectory, trimmedPackageName);

                    // Build a map of all public symbols exported by this package. We'll
                    // use this map to determine which diagnostics to report. We don't want
                    // to report diagnostics many times for types that include public types.
                    const publicSymbolMap = new Map<string, string>();
                    publicModules.forEach((moduleName) => {
                        this._getPublicSymbolsForModule(moduleName, publicSymbolMap);
                    });

                    publicModules.forEach((moduleName) => {
                        this._verifyTypesForModule(moduleName, publicSymbolMap, report);
                    });
                }
            }
        } catch (e) {
            const message: string =
                (e.stack ? e.stack.toString() : undefined) ||
                (typeof e.message === 'string' ? e.message : undefined) ||
                JSON.stringify(e);
            report.diagnostics.push(
                new Diagnostic(
                    DiagnosticCategory.Error,
                    `An internal error occurred while verifying types: "${message}"`,
                    getEmptyRange()
                )
            );
        }

        return report;
    }

    static getSymbolTypeString(symbolType: PackageSymbolType): string {
        switch (symbolType) {
            case PackageSymbolType.Class:
                return 'class';

            case PackageSymbolType.Function:
                return 'function';

            case PackageSymbolType.Method:
                return 'method';

            case PackageSymbolType.Constant:
                return 'constant';

            case PackageSymbolType.Variable:
                return 'variable';

            case PackageSymbolType.Module:
                return 'module';

            case PackageSymbolType.TypeAlias:
                return 'type alias';

            case PackageSymbolType.TypeVar:
                return 'type variable';

            case PackageSymbolType.Indeterminate:
                return 'symbol';
        }
    }

    private _resolveImport(moduleName: string) {
        const moduleDescriptor: ImportedModuleDescriptor = {
            leadingDots: 0,
            nameParts: moduleName.split('.'),
            importedSymbols: [],
        };
        return this._importResolver.resolveImport('', this._execEnv, moduleDescriptor);
    }

    private _getPublicSymbolsForModule(moduleName: string, symbolMap: PublicSymbolMap) {
        const importResult = this._resolveImport(moduleName);

        if (importResult.isImportFound) {
            const modulePath = importResult.resolvedPaths[importResult.resolvedPaths.length - 1];
            this._program.addTrackedFiles([modulePath], /* isThirdPartyImport */ true, /* isInPyTypedPackage */ true);

            const sourceFile = this._program.getBoundSourceFile(modulePath);

            if (sourceFile) {
                const module: PackageModule = {
                    name: moduleName,
                    symbols: [],
                };

                const parseTree = sourceFile.getParseResults()!.parseTree;
                const moduleScope = getScopeForNode(parseTree)!;

                this._getPublicSymbolsInSymbolTable(
                    symbolMap,
                    module,
                    module.name,
                    moduleScope.symbolTable,
                    ScopeType.Module
                );
            }
        }
    }

    private _getPublicSymbolsInSymbolTable(
        symbolMap: PublicSymbolMap,
        module: PackageModule,
        scopeName: string,
        symbolTable: SymbolTable,
        scopeType: ScopeType
    ) {
        symbolTable.forEach((symbol, name) => {
            if (
                !isPrivateOrProtectedName(name) &&
                !symbol.isExternallyHidden() &&
                !symbol.isIgnoredForProtocolMatch() &&
                !this._isSymbolTypeImplied(scopeType, name)
            ) {
                const fullName = `${scopeName}.${name}`;
                const symbolType = this._program.getTypeForSymbol(symbol);
                symbolMap.set(fullName, fullName);

                const typedDecls = symbol.getTypedDeclarations();

                // Is this a class declared within this module or class? If so, verify
                // the symbols defined within it.
                if (typedDecls.length > 0) {
                    const classDecl = typedDecls.find((decl) => decl.type === DeclarationType.Class);
                    if (classDecl) {
                        if (isClass(symbolType)) {
                            this._getPublicSymbolsInSymbolTable(
                                symbolMap,
                                module,
                                fullName,
                                symbolType.details.fields,
                                ScopeType.Class
                            );
                        }
                    }
                }
            }
        });
    }

    private _verifyTypesForModule(moduleName: string, publicSymbolMap: PublicSymbolMap, report: PackageTypeReport) {
        const module: PackageModule = {
            name: moduleName,
            symbols: [],
        };
        report.modules.push(module);

        const importResult = this._resolveImport(moduleName);
        if (!importResult.isImportFound) {
            report.diagnostics.push(
                new Diagnostic(DiagnosticCategory.Error, `Could not resolve module "${moduleName}"`, getEmptyRange())
            );
        } else if (importResult.isStubPackage) {
            report.diagnostics.push(
                new Diagnostic(
                    DiagnosticCategory.Error,
                    `No inlined types found for module "${moduleName}" because stub package was present`,
                    getEmptyRange()
                )
            );
        } else {
            const modulePath = importResult.resolvedPaths[importResult.resolvedPaths.length - 1];
            this._program.addTrackedFiles([modulePath], /* isThirdPartyImport */ true, /* isInPyTypedPackage */ true);

            const sourceFile = this._program.getBoundSourceFile(modulePath);

            if (sourceFile) {
                const parseTree = sourceFile.getParseResults()!.parseTree;
                const moduleScope = getScopeForNode(parseTree)!;

                this._verifySymbolsInSymbolTable(
                    report,
                    module,
                    module.name,
                    moduleScope.symbolTable,
                    ScopeType.Module,
                    publicSymbolMap,
                    ''
                );
            } else {
                report.diagnostics.push(
                    new Diagnostic(DiagnosticCategory.Error, `Could not bind file "${modulePath}"`, getEmptyRange())
                );
            }
        }
    }

    // Scans the directory structure for a list of public modules
    // within the package.
    private _getListOfPublicModules(rootPath: string, packageName: string): string[] {
        const publicModules: string[] = [];
        this._addPublicModulesRecursive(rootPath, packageName, publicModules);

        // Make sure modules are unique. There may be duplicates if a ".py" and ".pyi"
        // exist for some modules.
        const uniqueModules: string[] = [];
        const moduleMap = new Map<string, string>();
        publicModules.forEach((module) => {
            if (!moduleMap.has(module)) {
                uniqueModules.push(module);
                moduleMap.set(module, module);
            }
        });

        return uniqueModules;
    }

    private _addPublicModulesRecursive(dirPath: string, modulePath: string, publicModules: string[]) {
        const dirEntries = this._fileSystem.readdirEntriesSync(dirPath);

        dirEntries.forEach((entry) => {
            if (entry.isFile()) {
                const fileExtension = getFileExtension(entry.name);

                if (fileExtension === '.py' || fileExtension === '.pyi') {
                    const nameWithoutExtension = stripFileExtension(entry.name);

                    if (nameWithoutExtension === '__init__') {
                        publicModules.push(modulePath);
                    } else {
                        if (
                            !isPrivateOrProtectedName(nameWithoutExtension) &&
                            this._isLegalModulePartName(nameWithoutExtension)
                        ) {
                            publicModules.push(`${modulePath}.${nameWithoutExtension}`);
                        }
                    }
                }
            } else if (entry.isDirectory()) {
                if (!isPrivateOrProtectedName(entry.name) && this._isLegalModulePartName(entry.name)) {
                    this._addPublicModulesRecursive(
                        combinePaths(dirPath, entry.name),
                        `${modulePath}.${entry.name}`,
                        publicModules
                    );
                }
            }
        });
    }

    private _isLegalModulePartName(name: string): boolean {
        // PEP8 indicates that all module names should be lowercase
        // with underscores. It doesn't talk about non-ASCII
        // characters, but it appears that's the convention.
        return !!name.match(/[a-z_]+/);
    }

    private _verifySymbolsInSymbolTable(
        report: PackageTypeReport,
        module: PackageModule,
        scopeName: string,
        symbolTable: SymbolTable,
        scopeType: ScopeType,
        publicSymbolMap: PublicSymbolMap,
        currentSymbol: string
    ) {
        symbolTable.forEach((symbol, name) => {
            if (
                !isPrivateOrProtectedName(name) &&
                !symbol.isExternallyHidden() &&
                !symbol.isIgnoredForProtocolMatch() &&
                !this._isSymbolTypeImplied(scopeType, name)
            ) {
                const fullName = `${scopeName}.${name}`;
                const symbolType = this._program.getTypeForSymbol(symbol);
                let errorMessage = '';

                const packageSymbolType = this._getPackageSymbolType(symbol, symbolType);
                const packageSymbolTypeText = PackageTypeVerifier.getSymbolTypeString(packageSymbolType);
                const packageSymbol: PackageSymbol = {
                    name,
                    fullName,
                    symbolType: packageSymbolType,
                };
                module.symbols.push(packageSymbol);
                report.symbolCount++;

                const typedDecls = symbol.getTypedDeclarations();

                if (!this._isSymbolTypeImplied(scopeType, name)) {
                    if (isUnknown(symbolType)) {
                        if (typedDecls.length === 0) {
                            errorMessage = `Type not declared for ${packageSymbolTypeText} "${fullName}"`;
                        } else {
                            errorMessage = `Type unknown for ${packageSymbolTypeText} "${fullName}"`;
                        }
                    } else {
                        const diag = new DiagnosticAddendum();
                        if (!this._validateTypeIsCompletelyKnown(symbolType, diag, publicSymbolMap, fullName, [])) {
                            errorMessage =
                                `Type partially unknown for ${packageSymbolTypeText} "${fullName}"` +
                                diag.getString(diagnosticMaxDepth, diagnosticMaxLineCount);
                        }
                    }
                }

                if (errorMessage) {
                    report.diagnostics.push(new Diagnostic(DiagnosticCategory.Error, errorMessage, getEmptyRange()));
                    report.unknownTypeCount++;
                }

                // Is this a class declared within this module or class? If so, verify
                // the symbols defined within it.
                if (typedDecls.length > 0) {
                    const classDecl = typedDecls.find((decl) => decl.type === DeclarationType.Class);
                    if (classDecl) {
                        if (isClass(symbolType)) {
                            // Determine whether the class has a proper doc string.
                            if (!symbolType.details.docString) {
                                report.diagnostics.push(
                                    new Diagnostic(
                                        DiagnosticCategory.Warning,
                                        `No docstring found for class "${fullName}"`,
                                        getEmptyRange()
                                    )
                                );

                                report.missingClassDocStringCount++;
                            }

                            this._verifySymbolsInSymbolTable(
                                report,
                                module,
                                fullName,
                                symbolType.details.fields,
                                ScopeType.Class,
                                publicSymbolMap,
                                currentSymbol
                            );
                        }
                    }

                    const funcDecls = typedDecls.filter((decl) => decl.type === DeclarationType.Function);
                    if (funcDecls.length > 0) {
                        let isDocStringMissing = false;
                        let isDefaultValueEllipsis = false;

                        if (isFunction(symbolType)) {
                            if (!symbolType.details.docString) {
                                isDocStringMissing = true;
                            }

                            if (
                                symbolType.details.parameters.find(
                                    (param) => param.hasDefault && isEllipsisType(param.defaultType!)
                                )
                            ) {
                                isDefaultValueEllipsis = true;
                            }
                        } else if (isOverloadedFunction(symbolType)) {
                            const funcWithDocstring = symbolType.overloads.find((func) => func.details.docString);
                            if (!funcWithDocstring) {
                                isDocStringMissing = true;
                            }

                            symbolType.overloads.forEach((func) => {
                                if (
                                    func.details.parameters.find(
                                        (param) => param.hasDefault && isEllipsisType(param.defaultType!)
                                    )
                                ) {
                                    isDefaultValueEllipsis = true;
                                }
                            });
                        }

                        if (isDocStringMissing) {
                            // Don't require docstrings for dunder methods.
                            if (!isDunderName(name)) {
                                report.diagnostics.push(
                                    new Diagnostic(
                                        DiagnosticCategory.Warning,
                                        `No docstring found for function "${fullName}"`,
                                        getEmptyRange()
                                    )
                                );

                                report.missingFunctionDocStringCount++;
                            }
                        }

                        if (isDefaultValueEllipsis) {
                            report.diagnostics.push(
                                new Diagnostic(
                                    DiagnosticCategory.Warning,
                                    `One or more default values in function "${fullName}" is specified as "..."`,
                                    getEmptyRange()
                                )
                            );

                            report.missingDefaultParamCount++;
                        }
                    }
                }
            }
        });
    }

    private _pushType<T>(typeStack: string[], typeToPush: string, callback: () => T) {
        typeStack.push(typeToPush);
        const result = callback();
        typeStack.pop();
        return result;
    }

    // If the type contains a reference to a module or a class, determines
    // whether all of the types used by that module or class are known.
    private _validateTypeIsCompletelyKnown(
        type: Type,
        diag: DiagnosticAddendum,
        publicSymbolMap: PublicSymbolMap,
        currentSymbol: string,
        typeStack: string[]
    ): boolean {
        if (typeStack.length > maxTypeRecursionCount) {
            return true;
        }

        type = transformTypeObjectToClass(type);

        switch (type.category) {
            case TypeCategory.Unbound:
            case TypeCategory.Any:
            case TypeCategory.None:
            case TypeCategory.Never:
            case TypeCategory.TypeVar:
                return true;

            case TypeCategory.Unknown: {
                return false;
            }

            case TypeCategory.Object: {
                return this._validateTypeIsCompletelyKnown(
                    type.classType,
                    diag,
                    publicSymbolMap,
                    currentSymbol,
                    typeStack
                );
            }

            case TypeCategory.OverloadedFunction: {
                let isKnown = true;
                for (const overload of type.overloads) {
                    if (
                        !this._validateTypeIsCompletelyKnown(
                            overload,
                            diag.createAddendum(),
                            publicSymbolMap,
                            currentSymbol,
                            typeStack
                        )
                    ) {
                        isKnown = false;
                    }
                }

                return isKnown;
            }

            case TypeCategory.Union: {
                let isKnown = true;
                doForEachSubtype(type, (subtype) => {
                    if (
                        !this._validateTypeIsCompletelyKnown(
                            subtype,
                            diag.createAddendum(),
                            publicSymbolMap,
                            currentSymbol,
                            typeStack
                        )
                    ) {
                        isKnown = false;
                    }
                });

                return isKnown;
            }

            case TypeCategory.Function: {
                let isKnown = true;

                type.details.parameters.forEach((param) => {
                    // Skip nameless parameters like "*" and "/".
                    if (param.name) {
                        const subDiag = diag.createAddendum();
                        if (!param.hasDeclaredType) {
                            // Allow params (like "self" and "cls") to skip declarations because
                            // we're able to synthesize these.
                            const isSynthesized = isTypeVar(param.type) && param.type.details.isSynthesized;

                            if (!isSynthesized) {
                                subDiag.addMessage(`Parameter "${param.name}" is missing a type annotation`);
                                isKnown = false;
                            }
                        } else if (isUnknown(param.type)) {
                            subDiag.addMessage(`Type unknown for parameter "${param.name}"`);
                            isKnown = false;
                        } else if (
                            !this._validateTypeIsCompletelyKnown(
                                param.type,
                                subDiag.createAddendum(),
                                publicSymbolMap,
                                currentSymbol,
                                typeStack
                            )
                        ) {
                            subDiag.addMessage(`Type partially unknown for parameter "${param.name}"`);
                            isKnown = false;
                        }
                    }
                });

                if (type.details.declaredReturnType) {
                    const subDiag = diag.createAddendum();
                    if (isUnknown(type.details.declaredReturnType)) {
                        subDiag.addMessage(`Return type unknown`);
                        isKnown = false;
                    } else if (
                        !this._validateTypeIsCompletelyKnown(
                            type.details.declaredReturnType,
                            subDiag.createAddendum(),
                            publicSymbolMap,
                            currentSymbol,
                            typeStack
                        )
                    ) {
                        subDiag.addMessage(`Return type partially unknown`);
                        isKnown = false;
                    }
                } else {
                    // Init methods have an implied return type.
                    if (type.details.name !== '__init__') {
                        const subDiag = diag.createAddendum();
                        subDiag.addMessage(`Return type annotation is missing`);
                        isKnown = false;
                    }
                }

                return isKnown;
            }

            case TypeCategory.Class: {
                const typeInfo = this._validateClassTypeIsCompletelyKnown(
                    type,
                    publicSymbolMap,
                    currentSymbol,
                    typeStack
                );

                let isKnown = typeInfo.isFullyKnown;

                if (currentSymbol === type.details.fullName || !publicSymbolMap.has(type.details.fullName)) {
                    const classDiag = diag.createAddendum();

                    // Add any errors for the base classes, type arguments, etc.
                    if (!isKnown) {
                        classDiag.addAddendum(typeInfo.diag);
                    }

                    // Add any errors for the fields.
                    if (typeInfo.classFields) {
                        typeInfo.classFields.forEach((info) => {
                            if (!info.isFullyKnown) {
                                classDiag.addAddendum(info.diag);
                                isKnown = false;
                            }
                        });
                    }

                    if (!isKnown) {
                        classDiag.addMessage(
                            `Type partially unknown for class "${this._program.printType(
                                convertToInstance(type),
                                /* expandTypeAlias */ false
                            )}"`
                        );
                    }
                }

                return isKnown;
            }

            case TypeCategory.Module: {
                const typeInfo = this._validateModuleTypeIsCompletelyKnown(type, publicSymbolMap, typeStack);

                if (!typeInfo.isFullyKnown) {
                    diag.addAddendum(typeInfo.diag);
                }

                return typeInfo.isFullyKnown;
            }
        }
    }

    private _validateClassTypeIsCompletelyKnown(
        type: ClassType,
        publicSymbolMap: PublicSymbolMap,
        currentSymbol: string,
        typeStack: string[]
    ): TypeVerificationInfo {
        let typeInfo: TypeVerificationInfo | undefined;
        const diag = new DiagnosticAddendum();

        // Is this class is in the public symbol list and is not the class
        // that we're explicitly excluding from the public symbol list? If
        // so, indicate that it is fully known. Any parts of the type that
        // are unknown will be reported when that public symbol is analyzed.
        if (currentSymbol !== type.details.fullName && publicSymbolMap.has(type.details.fullName)) {
            typeInfo = {
                isFullyKnown: true,
                diag,
                classFields: undefined,
            };
        } else {
            // Prevent type recursion.
            if (typeStack.some((entry) => entry === type.details.fullName)) {
                return {
                    isFullyKnown: true,
                    diag,
                    classFields: undefined,
                };
            }

            this._pushType(typeStack, type.details.fullName, () => {
                // See if this class has already been analyzed.
                const cachedTypeInfo = this._typeCache.get(type.details.fullName);
                if (cachedTypeInfo) {
                    typeInfo = cachedTypeInfo;
                } else if (ClassType.isBuiltIn(type)) {
                    // Don't bother type-checking built-in types.
                    typeInfo = {
                        isFullyKnown: true,
                        diag: diag,
                        classFields: undefined,
                    };
                } else {
                    // Create a dummy entry in the cache to handle recursion. We'll replace
                    // this once we fully analyze this class type.
                    this._typeCache.set(type.details.fullName, {
                        isFullyKnown: true,
                        diag: diag,
                        classFields: undefined,
                    });

                    const classFieldMap = new Map<string, TypeVerificationInfo>();
                    let isKnown = true;

                    type.details.fields.forEach((symbol, name) => {
                        if (
                            !isPrivateOrProtectedName(name) &&
                            !symbol.isExternallyHidden() &&
                            !symbol.isIgnoredForProtocolMatch()
                        ) {
                            const symbolType = this._program.getTypeForSymbol(symbol);
                            const packageSymbolType = this._getPackageSymbolType(symbol, symbolType);
                            const symbolTypeText = PackageTypeVerifier.getSymbolTypeString(packageSymbolType);
                            const symbolDiag = new DiagnosticAddendum();

                            if (!this._isSymbolTypeImplied(ScopeType.Class, name)) {
                                if (isUnknown(symbolType)) {
                                    symbolDiag.addMessage(`Type unknown for ${symbolTypeText} "${name}"`);
                                    diag.addAddendum(symbolDiag);
                                } else if (
                                    !this._validateTypeIsCompletelyKnown(
                                        symbolType,
                                        symbolDiag.createAddendum(),
                                        publicSymbolMap,
                                        currentSymbol,
                                        typeStack
                                    )
                                ) {
                                    symbolDiag.addMessage(`Type partially unknown for ${symbolTypeText} "${name}"`);
                                    diag.addAddendum(symbolDiag);
                                }
                            }

                            classFieldMap.set(name, {
                                isFullyKnown: symbolDiag.isEmpty(),
                                diag: symbolDiag,
                                classFields: undefined,
                            });
                        }
                    });

                    // Add field information for base classes if it is not overridden by
                    // earlier classes in the MRO.
                    type.details.mro.forEach((mroType, index) => {
                        // Ignore the first entry in the MRO list, which is the current class,
                        // and we've already handled its fields above.
                        if (index === 0) {
                            return;
                        }

                        if (isClass(mroType)) {
                            const mroClassInfo = this._validateClassTypeIsCompletelyKnown(
                                mroType,
                                publicSymbolMap,
                                currentSymbol,
                                typeStack
                            );

                            if (mroClassInfo.classFields) {
                                // Determine which base class contributed this ancestor class to the MRO.
                                // We want to determine whether that base class is a public class within
                                // this package. If so, we'll suppress reporting of errors here because
                                // those errors would be redundant.
                                const baseClass = mroType.details.baseClasses.find((baseClass) => {
                                    return (
                                        isClass(baseClass) &&
                                        baseClass.details.mro.some(
                                            (baseClassMro) =>
                                                isClass(baseClassMro) &&
                                                ClassType.isSameGenericClass(baseClassMro, mroType)
                                        )
                                    );
                                }) as ClassType | undefined;
                                const isBaseClassPublicSymbol =
                                    baseClass && publicSymbolMap.has(baseClass.details.fullName);

                                mroClassInfo.classFields.forEach((info, name) => {
                                    if (!classFieldMap.has(name)) {
                                        const reportError = !info.isFullyKnown && !isBaseClassPublicSymbol;

                                        const diag = new DiagnosticAddendum();
                                        if (reportError) {
                                            diag.addAddendum(info.diag);
                                            diag.addMessage(
                                                `Type partially unknown for symbol "${name}" defined in base class "${this._program.printType(
                                                    convertToInstance(mroType),
                                                    /* expandTypeAlias */ false
                                                )}"`
                                            );
                                        }

                                        classFieldMap.set(name, {
                                            isFullyKnown: !reportError,
                                            diag,
                                            classFields: undefined,
                                        });
                                    }
                                });
                            }
                        }
                    });

                    // Add information for the metaclass.
                    if (type.details.effectiveMetaclass) {
                        if (!isClass(type.details.effectiveMetaclass)) {
                            diag.addMessage(`Type for metaclass is unknown`);
                            isKnown = false;
                        } else if (!ClassType.isBuiltIn(type.details.effectiveMetaclass)) {
                            const metaclassInfo = this._validateClassTypeIsCompletelyKnown(
                                type.details.effectiveMetaclass,
                                publicSymbolMap,
                                currentSymbol,
                                typeStack
                            );

                            const metaclassDiag = new DiagnosticAddendum();
                            let isMetaclassKnown = true;
                            if (!metaclassInfo.isFullyKnown) {
                                metaclassDiag.addAddendum(metaclassInfo.diag);
                                isMetaclassKnown = false;
                            }

                            metaclassInfo.classFields?.forEach((info) => {
                                if (!info.isFullyKnown) {
                                    metaclassDiag.addAddendum(info.diag);
                                    isMetaclassKnown = false;
                                }
                            });

                            if (!isMetaclassKnown) {
                                metaclassDiag.addMessage(
                                    `Type of metaclass "${type.details.effectiveMetaclass.details.fullName}" is partially unknown`
                                );
                                diag.addAddendum(metaclassDiag);
                                isKnown = false;
                            }
                        }
                    }

                    // Add information for base classes.
                    type.details.baseClasses.forEach((baseClass, index) => {
                        const baseClassDiag = new DiagnosticAddendum();
                        if (!isClass(baseClass)) {
                            baseClassDiag.addMessage(`Type unknown for base class ${index + 1}`);
                            isKnown = false;
                        } else if (!ClassType.isBuiltIn(baseClass)) {
                            const classInfo = this._validateClassTypeIsCompletelyKnown(
                                baseClass,
                                publicSymbolMap,
                                currentSymbol,
                                typeStack
                            );

                            if (!classInfo.isFullyKnown) {
                                baseClassDiag.addMessage(
                                    `Type partially unknown for base class "${this._program.printType(
                                        convertToInstance(baseClass),
                                        /* expandTypeAlias */ false
                                    )}"`
                                );

                                diag.addAddendum(classInfo.diag);
                                isKnown = false;
                            }
                        }
                    });

                    typeInfo = {
                        isFullyKnown: isKnown,
                        diag,
                        classFields: classFieldMap,
                    };

                    // Cache the information so we don't need to evaluate it multiple times.
                    this._typeCache.set(type.details.fullName, typeInfo);
                }
            });
        }

        // Analyze type arguments if present to make sure they are known.
        if (type.typeArguments) {
            this._pushType(typeStack, type.details.fullName, () => {
                // Make a shallow copy of the typeInfo to avoid modifying the cached version.
                const diag = new DiagnosticAddendum();
                typeInfo!.diag.getChildren().forEach((childDiag) => {
                    diag.addAddendum(childDiag);
                });

                typeInfo = {
                    isFullyKnown: typeInfo!.isFullyKnown,
                    diag,
                    classFields: typeInfo!.classFields,
                };

                type.typeArguments!.forEach((typeArg, index) => {
                    const typeArgDiag = new DiagnosticAddendum();
                    const typeVarText =
                        index < type.details.typeParameters.length
                            ? ` which corresponds to TypeVar ${type.details.typeParameters[index].details.name}`
                            : '';

                    if (isUnknown(typeArg)) {
                        typeArgDiag.addMessage(`Type unknown for type argument ${index + 1}${typeVarText}`);
                        diag.addAddendum(typeArgDiag);
                        typeInfo!.isFullyKnown = false;
                    } else if (
                        !this._validateTypeIsCompletelyKnown(
                            typeArg,
                            typeArgDiag,
                            publicSymbolMap,
                            currentSymbol,
                            typeStack
                        )
                    ) {
                        typeArgDiag.addMessage(`Type partially unknown for type argument ${index + 1}${typeVarText}`);
                        diag.addAddendum(typeArgDiag);
                        typeInfo!.isFullyKnown = false;
                    }
                });
            });
        }

        return typeInfo!;
    }

    private _validateModuleTypeIsCompletelyKnown(
        type: ModuleType,
        publicSymbolMap: PublicSymbolMap,
        typeStack: string[]
    ): TypeVerificationInfo {
        // See if this module has already been analyzed.
        let typeInfo = this._typeCache.get(type.moduleName);
        if (typeInfo) {
            return typeInfo;
        }

        const diag = new DiagnosticAddendum();

        if (typeStack.length > maxTypeRecursionCount) {
            return {
                isFullyKnown: true,
                diag,
                classFields: undefined,
            };
        }

        let isKnown = true;

        type.fields.forEach((symbol, name) => {
            if (
                !isPrivateOrProtectedName(name) &&
                !symbol.isExternallyHidden() &&
                !symbol.isIgnoredForProtocolMatch() &&
                !this._isSymbolTypeImplied(ScopeType.Module, name)
            ) {
                const symbolType = this._program.getTypeForSymbol(symbol);
                const packageSymbolType = this._getPackageSymbolType(symbol, symbolType);
                const symbolTypeText = PackageTypeVerifier.getSymbolTypeString(packageSymbolType);
                const symbolDiag = new DiagnosticAddendum();

                if (isUnknown(symbolType)) {
                    symbolDiag.addMessage(`Type unknown for ${symbolTypeText} "${name}"`);
                    diag.addAddendum(symbolDiag);
                    isKnown = false;
                } else if (
                    !this._validateTypeIsCompletelyKnown(
                        symbolType,
                        symbolDiag.createAddendum(),
                        publicSymbolMap,
                        '',
                        typeStack
                    )
                ) {
                    symbolDiag.addMessage(`Type partially unknown for ${symbolTypeText} "${name}"`);
                    diag.addAddendum(symbolDiag);
                    isKnown = false;
                }
            }
        });

        typeInfo = {
            isFullyKnown: isKnown,
            diag,
            classFields: undefined,
        };

        // Cache the information so we don't need to evaluate it multiple times.
        this._typeCache.set(type.moduleName, typeInfo);

        return typeInfo;
    }

    private _getPackageSymbolType(symbol: Symbol, type: Type): PackageSymbolType {
        if (type.typeAliasInfo) {
            return PackageSymbolType.TypeAlias;
        }

        switch (type.category) {
            case TypeCategory.Class: {
                return PackageSymbolType.Class;
            }

            case TypeCategory.Function:
            case TypeCategory.OverloadedFunction: {
                const funcDecl = symbol
                    .getDeclarations()
                    .find((decl) => decl.type === DeclarationType.Function) as FunctionDeclaration;
                if (funcDecl && funcDecl.isMethod) {
                    return PackageSymbolType.Method;
                }

                return PackageSymbolType.Function;
            }

            case TypeCategory.Object: {
                const varDecl = symbol
                    .getDeclarations()
                    .find((decl) => decl.type === DeclarationType.Variable) as VariableDeclaration;
                if (varDecl && (varDecl.isConstant || varDecl.isFinal)) {
                    return PackageSymbolType.Constant;
                }
                return PackageSymbolType.Variable;
            }

            case TypeCategory.Module: {
                return PackageSymbolType.Module;
            }

            case TypeCategory.TypeVar: {
                return PackageSymbolType.TypeVar;
            }

            default: {
                const varDecl = symbol
                    .getDeclarations()
                    .find((decl) => decl.type === DeclarationType.Variable) as VariableDeclaration;
                if (varDecl) {
                    if (varDecl.isConstant || varDecl.isFinal) {
                        return PackageSymbolType.Constant;
                    } else {
                        return PackageSymbolType.Variable;
                    }
                }

                return PackageSymbolType.Indeterminate;
            }
        }
    }

    private _getDirectoryForPackage(packageName: string): string | undefined {
        const moduleDescriptor: ImportedModuleDescriptor = {
            leadingDots: 0,
            nameParts: [packageName],
            importedSymbols: [],
        };

        const importResult = this._importResolver.resolveImport('', this._execEnv, moduleDescriptor);

        if (importResult.isImportFound) {
            const resolvedPath = importResult.resolvedPaths[importResult.resolvedPaths.length - 1];
            return getDirectoryPath(resolvedPath);
        }

        return undefined;
    }

    private _isSymbolTypeImplied(scopeType: ScopeType, name: string) {
        if (scopeType === ScopeType.Class) {
            const knownClassSymbols = ['__class__', '__dict__', '__doc__', '__module__', '__slots__'];
            return knownClassSymbols.some((sym) => sym === name);
        } else if (scopeType === ScopeType.Module) {
            const knownModuleSymbols = [
                '__all__',
                '__author__',
                '__copyright__',
                '__email__',
                '__license__',
                '__title__',
                '__uri__',
                '__version__',
            ];
            return knownModuleSymbols.some((sym) => sym === name);
        }

        return false;
    }
}
