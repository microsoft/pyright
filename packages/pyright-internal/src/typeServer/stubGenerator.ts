/**
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * stubGenerator.ts
 *
 * Generates Python stub (.pyi) file content from Pyright function type information.
 */

import { printType, PrintTypeFlags } from '../analyzer/typePrinter';
import * as PyrightTypes from '../analyzer/types';
import { PythonVersion, pythonVersion3_10, pythonVersion3_11 } from '../common/pythonVersion';
import { ParamCategory } from '../parser/parseNodes';

import { IAsyncTypeEvaluator } from './asyncTypeEvaluatorTypes';

/**
 * Represents collected import statements needed for a stub file.
 */
interface ImportCollection {
    // Map of module name to set of imported names
    // e.g., 'typing' -> Set(['Callable', 'TypeVar'])
    imports: Map<string, Set<string>>;
}

/**
 * Context for generating stub content, tracking imports and Python version.
 */
interface StubGenerationContext {
    imports: ImportCollection;
    pythonVersion: PythonVersion;
    moduleImports: Map<string, Set<string>>; // module -> set of imported names
    methodClass?: PyrightTypes.ClassType; // Class type if generating stub for a method
    targetMethodName?: string; // If provided, adds marker to this specific method instead of the class
    selfTypeVarName?: string; // If set, replace 'Self' with this TypeVar name
}

/**
 * Options for stub generation.
 */
export interface StubGenerationOptions {
    pythonVersion: PythonVersion; // Python version from executionEnvironment
}

/**
 * Result of stub generation including the stub content and metadata.
 */
export interface StubGenerationResult {
    stubContent: string; // The Python stub file content
    primaryDefinitionOffset: number; // Character offset to the primary definition in stubContent
}

export async function generateStubFromTypeVar(
    typeVar: PyrightTypes.TypeVarType,
    options: StubGenerationOptions
): Promise<StubGenerationResult> {
    const context: StubGenerationContext = {
        imports: { imports: new Map() },
        pythonVersion: options.pythonVersion,
        moduleImports: new Map(),
    };

    const typeVarName = typeVar.shared.name || 'T';
    let initializer = '';

    if (PyrightTypes.isParamSpec(typeVar)) {
        addImport(context, getTypingModule(context.pythonVersion, 'ParamSpec'), 'ParamSpec');
        initializer = `ParamSpec('${typeVarName}')`;
    } else if (PyrightTypes.isTypeVarTuple(typeVar)) {
        addImport(context, getTypingModule(context.pythonVersion, 'TypeVarTuple'), 'TypeVarTuple');
        initializer = `TypeVarTuple('${typeVarName}')`;
    } else {
        addImport(context, 'typing', 'TypeVar');

        const args: string[] = [`'${typeVarName}'`];

        if (typeVar.shared.constraints?.length) {
            const constraintStrings = typeVar.shared.constraints.map((constraint) =>
                pyrightTypeToString(constraint, context)
            );
            args.push(...constraintStrings);
        }

        if (typeVar.shared.boundType) {
            const boundString = pyrightTypeToString(typeVar.shared.boundType, context);
            args.push(`bound=${boundString}`);
        }

        if (typeVar.shared.defaultType && typeVar.shared.isDefaultExplicit) {
            const defaultString = pyrightTypeToString(typeVar.shared.defaultType, context);
            args.push(`default=${defaultString}`);
        }

        initializer = `TypeVar(${args.join(', ')})`;
    }

    const declarationLine = `${typeVarName} = ${initializer}`;

    const importLines = generateImportStatements(context);
    const lines: string[] = ['# This stub file was generated from Pyright type information', ''];
    if (importLines.length > 0) {
        lines.push(...importLines);
        lines.push('');
    }
    lines.push(declarationLine);
    lines.push('');

    const stubContent = lines.join('\n');
    const primaryDefinitionOffset = Math.max(0, stubContent.indexOf(declarationLine));

    return {
        stubContent,
        primaryDefinitionOffset,
    };
}

/**
 * Generates a Python stub file (.pyi) from a Pyright FunctionType.
 *
 * @param type The Pyright function type
 * @param options Generation options including Python version
 * @returns Stub generation result with content and metadata
 */
export async function generateStubFromFunctionType(
    evaluator: IAsyncTypeEvaluator,
    type: PyrightTypes.FunctionType,
    options: StubGenerationOptions
): Promise<StubGenerationResult> {
    // Check if this function is a method (has a methodClass)
    // If so, generate the entire class stub with marker on this specific method
    const methodClass = type.shared.methodClass;
    if (methodClass && PyrightTypes.isClass(methodClass)) {
        // Generate class stub with marker on the specific method
        return await generateStubFromClassType(evaluator, methodClass, options, type.shared.name);
    }

    const context: StubGenerationContext = {
        imports: { imports: new Map() },
        pythonVersion: options.pythonVersion,
        moduleImports: new Map(),
        methodClass: type.shared.methodClass,
    };

    const lines: string[] = [];

    // Generate header comment
    lines.push('# This stub file was generated from Pyright type information');
    lines.push('');

    // Collect TypeVars/ParamSpecs used in the function signature
    // Use typeParams if available, otherwise collect from signature
    let typeVarsToGenerate: PyrightTypes.TypeVarType[] = [];
    if (type.shared.typeParams && type.shared.typeParams.length > 0) {
        typeVarsToGenerate = type.shared.typeParams;
    } else {
        // Collect TypeVars/ParamSpecs from parameter types and return type
        typeVarsToGenerate = collectTypeVarsFromFunctionSignature(type);
    }

    // Check if we have a Self TypeVar - if so, we need to replace it with a regular TypeVar
    // since there's no class context for a standalone function
    const selfTypeVar = typeVarsToGenerate.find((tv) => PyrightTypes.TypeVarType.isSelf(tv));
    if (selfTypeVar) {
        // Filter out Self and track that we need to replace it
        typeVarsToGenerate = typeVarsToGenerate.filter((tv) => !PyrightTypes.TypeVarType.isSelf(tv));
        context.selfTypeVarName = '__type_of_self__';

        // Create a TypeVar declaration for __type_of_self__ with the bound to the class (if any)
        const bound = selfTypeVar.shared.boundType;
        addImport(context, 'typing', 'TypeVar');
        if (bound && PyrightTypes.isClass(bound)) {
            // Make sure this class is imported
            addImport(context, bound.shared.moduleName || '', bound.shared.name);
            lines.push(`__type_of_self__ = TypeVar('__type_of_self__', bound='${bound.shared.name}')`);
        } else {
            lines.push(`__type_of_self__ = TypeVar('__type_of_self__')`);
        }
        lines.push('');
    }

    // Generate TypeVar/ParamSpec declarations
    if (typeVarsToGenerate.length > 0) {
        const typeVarDecls = generateTypeVarDeclarations(typeVarsToGenerate, context);
        if (typeVarDecls.length > 0) {
            lines.push(...typeVarDecls);
            lines.push('');
        }
    }

    // Generate the function stub with docstring and deprecated decorator
    const functionStub = generateFunctionStub(type, context, type.shared.docString, type.shared.deprecatedMessage);
    lines.push(functionStub);

    // Generate imports (will be inserted at top after we know what's needed)
    const importLines = generateImportStatements(context);

    // Combine: imports + blank line + content
    const result: string[] = [];
    if (importLines.length > 0) {
        result.push(...importLines);
        result.push('');
    }
    result.push(...lines);

    // Calculate offset to the function definition
    // The function stub is always at the end of the result content
    const stubContent = result.join('\n') + '\n';
    const functionStubIndex = stubContent.lastIndexOf(functionStub);
    if (functionStubIndex < 0) {
        throw new Error(`Failed to find function stub in generated content`);
    }

    return {
        stubContent,
        primaryDefinitionOffset: functionStubIndex,
    };
}

/**
 * Generates a function stub signature from a Pyright function type.
 *
 * @param type The Pyright function type
 * @param context Generation context
 * @param docString Optional docstring to include
 * @param deprecatedMessage Optional deprecation message
 * @returns Function stub string (e.g., "def foo(x: int, y: str) -> bool: ...")
 */
function generateFunctionStub(
    type: PyrightTypes.FunctionType,
    context: StubGenerationContext,
    docString?: string,
    deprecatedMessage?: string
): string {
    const lines: string[] = [];

    // Add @deprecated decorator if deprecated
    if (deprecatedMessage) {
        context.imports.imports.set('warnings', new Set(['deprecated']));
        // Escape the message for Python string literal
        const escapedMessage = deprecatedMessage.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        lines.push(`@deprecated("${escapedMessage}")`);
    }

    // Function name - use 'generated_function' as a placeholder
    const functionName = type.shared.name || 'generated_function';

    const parts: string[] = [];

    // Start building the function signature
    parts.push('def ');
    parts.push(functionName);
    parts.push('(');

    // Generate parameters
    const paramStrings: string[] = [];
    for (let i = 0; i < type.shared.parameters.length; i++) {
        const param = type.shared.parameters[i];
        const paramParts: string[] = [];

        // Handle special parameter categories
        if (param.category === ParamCategory.ArgsList) {
            paramParts.push('*');
        } else if (param.category === ParamCategory.KwargsDict) {
            paramParts.push('**');
        }

        // Parameter name
        if (param.name) {
            paramParts.push(param.name);
        } else {
            paramParts.push('_');
        }

        // Parameter type annotation
        if (param._type) {
            paramParts.push(': ');
            const isSynthesizedSelfParam =
                param._type && PyrightTypes.isTypeVar(param._type) && param._type.shared.isSynthesizedSelf;
            let paramTypeString = pyrightTypeToString(param._type, isSynthesizedSelfParam ? undefined : context);
            // Replace 'Self' with our TypeVar if we're in a standalone function context
            if (context.selfTypeVarName && paramTypeString === 'Self' && isSynthesizedSelfParam) {
                paramTypeString = context.selfTypeVarName;
            }
            paramParts.push(paramTypeString);
        }

        // Default value (if present, just show "...")
        const defaultType = PyrightTypes.FunctionType.getParamDefaultType(type, i);
        if (defaultType || param.defaultExpr) {
            paramParts.push(' = ...');
        }

        paramStrings.push(paramParts.join(''));
    }

    parts.push(paramStrings.join(', '));
    parts.push(')');

    // Return type annotation
    const returnType = getReturnTypeStringFromFunction(type, context);
    parts.push(' -> ');
    parts.push(returnType);
    parts.push(':');

    lines.push(parts.join(''));

    // Add docstring if present
    if (docString) {
        // Indent the docstring content
        const docLines = docString.split('\n');
        lines.push('    """');
        for (const docLine of docLines) {
            lines.push(`    ${docLine}`);
        }
        lines.push('    """');
    } else {
        // Just add ellipsis on same line if no docstring
        lines[lines.length - 1] += ' ...';
    }

    return lines.join('\n');
}

/**
 * Gets the return type string for a function.
 */
function getReturnTypeStringFromFunction(type: PyrightTypes.FunctionType, context: StubGenerationContext): string {
    const returnType = PyrightTypes.FunctionType.getEffectiveReturnType(type, true);
    let returnTypeString = returnType ? pyrightTypeToString(returnType, context) : 'None';
    // Replace 'Self' with our TypeVar if we're in a standalone function context
    if (context.selfTypeVarName && returnTypeString === 'Self') {
        returnTypeString = context.selfTypeVarName;
    }
    return returnTypeString;
}

/**
 * Converts a Pyright type to a Python type string using printType.
 */
function pyrightTypeToString(type: PyrightTypes.Type, context?: StubGenerationContext): string {
    const flags = PrintTypeFlags.PythonSyntax | PrintTypeFlags.UseFullyQualifiedNames;
    // Simple callback for getting return types - just use declared or inferred return type
    const returnTypeCallback = (funcType: PyrightTypes.FunctionType): PyrightTypes.Type => {
        return (
            funcType.shared.declaredReturnType ??
            funcType.shared.inferredReturnType?.type ??
            PyrightTypes.UnknownType.create()
        );
    };
    const typeString = printType(type, flags, returnTypeCallback);
    // Remove 'builtins.' prefix from builtin types
    const cleanedTypeString = typeString.replace(/builtins\./g, '');

    // Extract and track module imports if context is provided.
    if (context) {
        extractModuleImportsFromTypeString(cleanedTypeString, type, context);
    }

    return cleanedTypeString;
}

/**
 * Extracts module-qualified names from a type string and tracks them as imports.
 * For example, "test.Box[int]" would extract module "test".
 * Also detects typing module types like "Any", "Callable", "Optional", etc.
 */
function extractModuleImportsFromTypeString(
    typeString: string,
    type: PyrightTypes.Type,
    context: StubGenerationContext
): void {
    // Match module-qualified names like "test.Box" or "foo.bar.Baz"
    const moduleQualifiedPattern = /([a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)*)\./g;
    const matches = typeString.matchAll(moduleQualifiedPattern);

    for (const match of matches) {
        const fullPath = match[1]; // e.g., "test" or "foo.bar"
        const moduleName = fullPath;

        // Skip ParamSpec's special attributes (.args and .kwargs)
        // These are not module imports - e.g., "P.args" where P is a ParamSpec
        const matchStart = match.index!;
        const afterDot = typeString.substring(matchStart + match[0].length);
        if (afterDot.startsWith('args') || afterDot.startsWith('kwargs')) {
            // Check if this looks like a ParamSpec attribute by checking if the name
            // doesn't contain dots (ParamSpec names are typically single identifiers)
            if (!moduleName.includes('.')) {
                continue;
            }
        }

        // Track this module import (no specific names needed since we use "import module")
        if (!context.moduleImports.has(moduleName)) {
            context.moduleImports.set(moduleName, new Set());
        }
    }

    // Extract typing module imports (types that come from typing or typing_extensions)
    extractTypingImports(typeString, context);
}

/**
 * Extracts typing module types from a type string and adds appropriate imports.
 * Handles types like Any, Callable, Optional, etc., and determines whether to use
 * typing or typing_extensions based on Python version.
 */
function extractTypingImports(typeString: string, context: StubGenerationContext): void {
    // Common typing module types
    const typingTypes = [
        'Any',
        'Callable',
        'Optional',
        'Union',
        'List',
        'Dict',
        'Set',
        'Tuple',
        'Type',
        'Literal',
        'Protocol',
        'TypedDict',
        'NamedTuple',
        'Generic',
        'ClassVar',
        'Final',
        'Annotated',
        'TypeGuard',
        'TypeAlias',
        'ParamSpec',
        'Concatenate',
        'TypeVarTuple',
        'Unpack',
        'Never',
        'NoReturn',
        'Self',
    ];

    // Check which typing types appear in the type string
    for (const typeName of typingTypes) {
        // Use word boundary to match complete words only (e.g., "Any" but not "AnyThing")
        const pattern = new RegExp(`\\b${typeName}\\b`);
        if (pattern.test(typeString)) {
            // Determine which module to import from
            const moduleName = getTypingModule(context.pythonVersion, typeName);
            addImport(context, moduleName, typeName);
        }
    }
}

/**
 * Adds an import to the collection.
 */
function addImport(context: StubGenerationContext, moduleName: string, importName: string): void {
    if (!context.imports.imports.has(moduleName)) {
        context.imports.imports.set(moduleName, new Set());
    }
    context.imports.imports.get(moduleName)!.add(importName);
}

/**
 * Determines which typing module to use based on Python version and feature.
 */
function getTypingModule(pythonVersion: PythonVersion, feature: string): string {
    // Features that require typing_extensions in older Python versions
    const typingExtensionsFeatures: Record<string, PythonVersion> = {
        ParamSpec: pythonVersion3_10, // Python 3.10+
        TypeVarTuple: pythonVersion3_11, // Python 3.11+
        Never: pythonVersion3_11, // Python 3.11+
        TypeAlias: pythonVersion3_10, // Python 3.10+
    };

    const requiredVersion = typingExtensionsFeatures[feature];
    if (requiredVersion && PythonVersion.isLessThan(pythonVersion, requiredVersion)) {
        return 'typing_extensions';
    }

    return 'typing';
}

/**
 * Generates import statements from collected imports.
 */
function generateImportStatements(context: StubGenerationContext): string[] {
    const lines: string[] = [];

    // First, add typing imports (if any)
    const sortedModules = Array.from(context.imports.imports.keys()).sort();
    for (const moduleName of sortedModules) {
        const imports = Array.from(context.imports.imports.get(moduleName)!).sort();
        lines.push(`from ${moduleName} import ${imports.join(', ')}`);
    }

    // Then, add module imports (without comments - metadata contains the paths)
    const sortedModuleImports = Array.from(context.moduleImports.keys()).sort();
    for (const moduleName of sortedModuleImports) {
        lines.push(`import ${moduleName}`);
    }

    return lines;
}

/**
 * Generates a Python stub file (.pyi) from a Pyright ClassType.
 *
 * @param type The Pyright class type
 * @param options Generation options including Python version
 * @param targetMethodName If provided, marks this specific method as the primary definition
 * @returns Stub generation result with content and metadata
 */
export async function generateStubFromClassType(
    evaluator: IAsyncTypeEvaluator,
    type: PyrightTypes.ClassType,
    options: StubGenerationOptions,
    targetMethodName?: string
): Promise<StubGenerationResult> {
    const context: StubGenerationContext = {
        imports: { imports: new Map() },
        pythonVersion: options.pythonVersion,
        moduleImports: new Map(),
        targetMethodName,
    };

    const lines: string[] = [];

    // Generate header comment
    lines.push('# This stub file was generated from Pyright type information');
    lines.push('');

    // Special handling for NewType classes - generate as NewType call instead of class definition
    if (PyrightTypes.ClassType.isNewTypeClass(type)) {
        return generateNewTypeStub(type, context, options);
    }

    // Generate the class stub (will include marker for main class)
    const classStub = await generateClassStub(evaluator, type, context, true);
    lines.push(classStub);

    // Generate imports (will be inserted at top after we know what's needed)
    const importLines = generateImportStatements(context);

    // Combine: imports + blank line + content
    const result: string[] = [];
    if (importLines.length > 0) {
        result.push(...importLines);
        result.push('');
    }
    result.push(...lines);

    // Calculate offset to the primary definition
    const stubContent = result.join('\n') + '\n';
    let primaryDefinitionOffset: number;

    if (targetMethodName) {
        // Find the target method within the class stub
        // Look for "def <methodName>(" pattern
        const methodPattern = new RegExp(`\\bdef ${targetMethodName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\(`, 'm');
        const match = stubContent.match(methodPattern);
        if (!match || match.index === undefined) {
            throw new Error(`Failed to find method '${targetMethodName}' in generated class stub`);
        }
        primaryDefinitionOffset = match.index;
    } else {
        // Find the class definition - look for "class <ClassName>"
        const classPattern = new RegExp(`\\bclass ${type.shared.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'm');
        const match = stubContent.match(classPattern);
        if (!match || match.index === undefined) {
            throw new Error(`Failed to find class '${type.shared.name}' in generated stub`);
        }
        primaryDefinitionOffset = match.index;
    }

    return {
        stubContent,
        primaryDefinitionOffset,
    };
}

/**
 * Generates a stub for a NewType class using NewType call syntax.
 */
function generateNewTypeStub(
    type: PyrightTypes.ClassType,
    context: StubGenerationContext,
    options: StubGenerationOptions
): StubGenerationResult {
    const lines: string[] = [];

    // Add typing import for NewType
    addImport(context, 'typing', 'NewType');

    // Get the base type (first base class, excluding object)
    const baseType = type.shared.baseClasses[0];
    let baseTypeStr = baseType ? pyrightTypeToString(baseType, context) : 'object';

    // Remove type[] wrapper if present (NewType base should be the instance type, not type[])
    const typeWrapperMatch = baseTypeStr.match(/^type\[(.+)\]$/);
    if (typeWrapperMatch) {
        baseTypeStr = typeWrapperMatch[1];
    }

    // Generate: TypeName = NewType('TypeName', BaseType)
    lines.push(`${type.shared.name} = NewType('${type.shared.name}', ${baseTypeStr})`);

    // Generate imports
    const importLines = generateImportStatements(context);
    const result: string[] = [];
    result.push('# This stub file was generated from Pyright type information');
    result.push('');
    if (importLines.length > 0) {
        result.push(...importLines);
        result.push('');
    }
    result.push(...lines);

    // Calculate offset to the NewType assignment
    const stubContent = result.join('\n') + '\n';
    const assignmentPattern = new RegExp(`\\b${type.shared.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*=`, 'm');
    const match = stubContent.match(assignmentPattern);
    if (!match || match.index === undefined) {
        throw new Error(`Failed to find NewType assignment for '${type.shared.name}' in generated stub`);
    }

    return {
        stubContent,
        primaryDefinitionOffset: match.index,
    };
}

/**
 * Generates a class stub from a Pyright class type.
 * @param type - The class type to generate a stub for
 * @param context - The stub generation context
 * @param isTopLevel - Whether this is the main class (vs a synthesized base class)
 */
async function generateClassStub(
    evaluator: IAsyncTypeEvaluator,
    type: PyrightTypes.ClassType,
    context: StubGenerationContext,
    isTopLevel: boolean = false
): Promise<string> {
    const lines: string[] = [];

    // Check for special TypedDict or NamedTuple
    if (type.shared.typedDictEntries) {
        return generateTypedDictStub(type, context);
    }
    if (type.shared.namedTupleEntries) {
        return await generateNamedTupleStub(evaluator, type, context);
    }

    // Add @deprecated decorator if deprecated
    if (type.shared.deprecatedMessage) {
        context.imports.imports.set('warnings', new Set(['deprecated']));
        // Escape the message for Python string literal
        const escapedMessage = type.shared.deprecatedMessage.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        lines.push(`@deprecated("${escapedMessage}")`);
    }

    // Start class definition
    const parts: string[] = [];
    parts.push('class ');
    parts.push(type.shared.name);

    // Add type parameters for generic classes
    if (type.shared.typeParams && type.shared.typeParams.length > 0) {
        const typeParamNames = type.shared.typeParams.map((tp) => {
            if (PyrightTypes.isTypeVar(tp)) {
                return tp.shared.name;
            }
            return pyrightTypeToString(tp, context);
        });
        parts.push('[');
        parts.push(typeParamNames.join(', '));
        parts.push(']');
    }

    // Check if any base classes are synthesized (no declaration) and need their stubs generated
    // We need to do this check before generating the base class list so we know which ones
    // to reference with simple names vs fully qualified names
    const synthesizedBaseClasses = new Set<string>();
    const baseClassStubs: string[] = [];
    if (type.shared.baseClasses && type.shared.baseClasses.length > 0) {
        for (const bc of type.shared.baseClasses) {
            if (PyrightTypes.isClass(bc) && !bc.shared.declaration && bc.shared.name !== 'object') {
                // Track this as a synthesized base class
                synthesizedBaseClasses.add(bc.shared.name);
                // Generate stub for synthesized base class
                const baseStub = await generateClassStub(evaluator, bc, context);
                let bcStr = pyrightTypeToString(bc, context);
                // Remove type[] wrapper if present
                const typeWrapperMatch = bcStr.match(/^type\[(.+)\]$/);
                if (typeWrapperMatch) {
                    bcStr = typeWrapperMatch[1];
                }
                baseClassStubs.push(`# ↓ Base class: ${bcStr}`);
                baseClassStubs.push(baseStub);
                baseClassStubs.push('');
            }
        }
    }

    // Add base classes
    if (type.shared.baseClasses && type.shared.baseClasses.length > 0) {
        const baseClassStrs = type.shared.baseClasses
            .map((bc) => {
                let bcStr = pyrightTypeToString(bc, context);
                // Remove type[] wrapper if present
                const typeWrapperMatch = bcStr.match(/^type\[(.+)\]$/);
                if (typeWrapperMatch) {
                    bcStr = typeWrapperMatch[1];
                }
                // If this base class had its stub generated inline, use just the simple name
                if (PyrightTypes.isClass(bc) && synthesizedBaseClasses.has(bc.shared.name)) {
                    return bc.shared.name;
                }
                return bcStr;
            })
            .filter((bc) => bc !== 'object'); // Exclude object base class
        if (baseClassStrs.length > 0) {
            parts.push('(');
            parts.push(baseClassStrs.join(', '));
            parts.push(')');
        }
    }

    parts.push(':');
    lines.push(parts.join(''));

    // Add docstring if present
    if (type.shared.docString) {
        const docLines = type.shared.docString.split('\n');
        lines.push('    """');
        for (const docLine of docLines) {
            lines.push(`    ${docLine}`);
        }
        lines.push('    """');
    }

    // Generate class body
    const bodyLines = await generateClassBody(evaluator, type, context);
    if (bodyLines.length === 0) {
        lines.push('    ...');
    } else {
        lines.push(...bodyLines);
    }

    const classStub = lines.join('\n');

    // Combine base class stubs with main class stub
    if (baseClassStubs.length > 0) {
        const result: string[] = [];
        result.push(...baseClassStubs);
        result.push(classStub);
        return result.join('\n');
    }

    return classStub;
}

/**
 * Generates the body of a class (fields and methods).
 */
async function generateClassBody(
    evaluator: IAsyncTypeEvaluator,
    type: PyrightTypes.ClassType,
    context: StubGenerationContext
): Promise<string[]> {
    const lines: string[] = [];

    // Get all fields from the symbol table, excluding private members
    const fields: Array<{ name: string; type: PyrightTypes.Type; isMethod: boolean; isClassVar: boolean }> = [];

    for (const [name, symbol] of type.shared.fields) {
        // Skip private fields (starting with single _), but keep dunder methods
        if (name.startsWith('_') && !name.startsWith('__')) {
            continue;
        }

        // Try to get the type from synthesized type, or from declarations
        let fieldType: PyrightTypes.Type | undefined;
        const synthesizedType = symbol.getSynthesizedType();
        if (synthesizedType) {
            fieldType = synthesizedType.type;
        } else {
            // Try to get declared type from declarations
            fieldType = await evaluator.getEffectiveTypeOfSymbol(symbol);
        }

        if (!fieldType) {
            continue;
        }

        const isMethod = PyrightTypes.isFunction(fieldType) || PyrightTypes.isOverloaded(fieldType);
        const isClassVar = symbol.isClassVar();

        // Skip fields that are private but not dunder methods
        if (name.startsWith('_') && !isMethod) {
            continue;
        }

        fields.push({ name, type: fieldType, isMethod, isClassVar });
    }

    // Sort: class variables first, then instance variables, then methods
    fields.sort((a, b) => {
        if (a.isClassVar && !b.isClassVar) return -1;
        if (!a.isClassVar && b.isClassVar) return 1;
        if (!a.isMethod && b.isMethod) return -1;
        if (a.isMethod && !b.isMethod) return 1;
        return a.name.localeCompare(b.name);
    });

    // Generate field stubs
    for (const field of fields) {
        if (field.isMethod) {
            // Generate method stub
            if (PyrightTypes.isFunction(field.type)) {
                const methodContext = { ...context, methodClass: type };
                const methodStub = generateFunctionStub(
                    field.type,
                    methodContext,
                    field.type.shared.docString,
                    field.type.shared.deprecatedMessage
                );
                // Indent the method
                const indentedStub = methodStub
                    .split('\n')
                    .map((line) => `    ${line}`)
                    .join('\n');
                lines.push(indentedStub);
            } else if (PyrightTypes.isOverloaded(field.type)) {
                // Handle overloaded methods - just use first overload for stub
                const overloads = PyrightTypes.OverloadedType.getOverloads(field.type);
                if (overloads.length > 0) {
                    const methodContext = { ...context, methodClass: type };
                    const methodStub = generateFunctionStub(
                        overloads[0],
                        methodContext,
                        overloads[0].shared.docString,
                        overloads[0].shared.deprecatedMessage
                    );
                    const indentedStub = methodStub
                        .split('\n')
                        .map((line) => `    ${line}`)
                        .join('\n');
                    lines.push(indentedStub);
                }
            }
        } else if (PyrightTypes.isClass(field.type) && !field.type.shared.declaration) {
            // Nested synthesized class - generate its stub recursively
            const nestedStub = await generateClassStub(evaluator, field.type, context);
            const indentedStub = nestedStub
                .split('\n')
                .map((line) => `    ${line}`)
                .join('\n');
            lines.push(indentedStub);
        } else {
            // Regular field with type annotation
            const typeStr = pyrightTypeToString(field.type, context);
            lines.push(`    ${field.name}: ${typeStr}`);
        }
    }

    return lines;
}

/**
 * Generates a TypedDict stub using special syntax.
 */
function generateTypedDictStub(type: PyrightTypes.ClassType, context: StubGenerationContext): string {
    const lines: string[] = [];

    // TypedDict class definition
    const parts: string[] = [];
    parts.push('class ');
    parts.push(type.shared.name);
    parts.push('(TypedDict');

    // Add total=False if not all fields are required
    const entries = type.shared.typedDictEntries;
    if (entries) {
        const hasOptional = Array.from(entries.knownItems.values()).some((e) => !e.isRequired);
        if (hasOptional) {
            parts.push(', total=False');
        }
    }

    parts.push('):');
    lines.push(parts.join(''));

    // Generate fields
    if (entries && entries.knownItems.size > 0) {
        for (const [name, entry] of entries.knownItems) {
            const typeStr = pyrightTypeToString(entry.valueType, context);
            lines.push(`    ${name}: ${typeStr}`);
        }
    } else {
        lines.push('    ...');
    }

    // Add TypedDict to imports
    addImport(context, 'typing', 'TypedDict');

    return lines.join('\n');
}

/**
 * Generates a NamedTuple stub using special syntax.
 */
async function generateNamedTupleStub(
    evaluator: IAsyncTypeEvaluator,
    type: PyrightTypes.ClassType,
    context: StubGenerationContext
): Promise<string> {
    const lines: string[] = [];

    // NamedTuple class definition
    const parts: string[] = [];
    parts.push('class ');
    parts.push(type.shared.name);
    parts.push('(NamedTuple):');
    lines.push(parts.join(''));

    // Generate fields from namedTupleEntries
    const entries = type.shared.namedTupleEntries;
    if (entries && entries.size > 0) {
        // Get field types from the symbol table
        for (const [name, symbol] of type.shared.fields) {
            if (entries.has(name)) {
                const synthesizedType = symbol.getSynthesizedType();
                if (synthesizedType) {
                    const typeStr = pyrightTypeToString(synthesizedType.type, context);
                    lines.push(`    ${name}: ${typeStr}`);
                } else {
                    const type = await evaluator.getEffectiveTypeOfSymbol(symbol);
                    if (type) {
                        const typeStr = pyrightTypeToString(type, context);
                        lines.push(`    ${name}: ${typeStr}`);
                    } else {
                        lines.push(`    ${name}: Any`);
                        addImport(context, 'typing', 'Any');
                    }
                }
            }
        }
    }

    if (lines.length === 1) {
        lines.push('    ...');
    }

    // Add NamedTuple to imports
    addImport(context, 'typing', 'NamedTuple');

    return lines.join('\n');
}

/**
 * Collects all TypeVars/ParamSpecs used in a function signature by walking through
 * parameter types and return type.
 */
function collectTypeVarsFromFunctionSignature(type: PyrightTypes.FunctionType): PyrightTypes.TypeVarType[] {
    const typeVars = new Map<string, PyrightTypes.TypeVarType>();

    // Helper to recursively collect TypeVars from a type
    const collectFromType = (t: PyrightTypes.Type) => {
        if (PyrightTypes.isTypeVar(t)) {
            typeVars.set(t.shared.name, t);
        } else if (PyrightTypes.isClass(t) && t.priv.typeArgs) {
            // Check type arguments (e.g., List[T])
            for (const arg of t.priv.typeArgs) {
                collectFromType(arg);
            }
        } else if (PyrightTypes.isUnion(t)) {
            // Check union members
            t.priv.subtypes.forEach((subtype) => collectFromType(subtype));
        } else if (PyrightTypes.isFunction(t)) {
            // Check function parameters and return type
            for (let i = 0; i < t.shared.parameters.length; i++) {
                const param = t.shared.parameters[i];
                if (param._type) {
                    collectFromType(param._type);
                }
            }
            const returnType = PyrightTypes.FunctionType.getEffectiveReturnType(t, true);
            if (returnType) {
                collectFromType(returnType);
            }
        }
    };

    // Collect from parameters
    for (let i = 0; i < type.shared.parameters.length; i++) {
        const param = type.shared.parameters[i];
        if (param._type) {
            collectFromType(param._type);
        }
    }

    // Collect from return type
    const returnType = PyrightTypes.FunctionType.getEffectiveReturnType(type, true);
    if (returnType) {
        collectFromType(returnType);
    }

    return Array.from(typeVars.values());
}

/**
 * Generates TypeVar/ParamSpec/TypeVarTuple declarations for a list of type parameters.
 */
function generateTypeVarDeclarations(typeParams: PyrightTypes.TypeVarType[], context: StubGenerationContext): string[] {
    const lines: string[] = [];

    for (const typeParam of typeParams) {
        if (PyrightTypes.isTypeVar(typeParam)) {
            const name = typeParam.shared.name;

            // Check if it's a ParamSpec
            if (PyrightTypes.isParamSpec(typeParam)) {
                addImport(context, getTypingModule(context.pythonVersion, 'ParamSpec'), 'ParamSpec');
                lines.push(`${name} = ParamSpec('${name}')`);
            }
            // Check if it's a TypeVarTuple
            else if (PyrightTypes.isTypeVarTuple(typeParam)) {
                addImport(context, getTypingModule(context.pythonVersion, 'TypeVarTuple'), 'TypeVarTuple');
                lines.push(`${name} = TypeVarTuple('${name}')`);
            }
            // Regular TypeVar
            else {
                addImport(context, 'typing', 'TypeVar');
                const parts = [`${name} = TypeVar('${name}'`];

                // Add bound if present
                if (typeParam.shared.boundType) {
                    const boundStr = pyrightTypeToString(typeParam.shared.boundType, context);
                    parts.push(`, bound=${boundStr}`);
                }

                // Add constraints if present
                if (typeParam.shared.constraints && typeParam.shared.constraints.length > 0) {
                    const constraintStrs = typeParam.shared.constraints.map((c) => pyrightTypeToString(c, context));
                    parts.push(`, ${constraintStrs.join(', ')}`);
                }

                parts.push(')');
                lines.push(parts.join(''));
            }
        }
    }

    return lines;
}
