# Pyright Internals

## Code Structure

* client/src/extension.ts: Language Server Protocol (LSP) client entry point for VS Code extension.
* client/typeshed-fallback/: Recent copy of Typeshed type stub files for Python stdlib
* server/src/pyright.ts: Main entry point for command-line tool
* server/src/server.ts: Main entry point for LSP server
* server/src/analyzer: Modules that perform analysis passes over Python parse tree
* server/src/common: Modules  that are common to the parser and analyzer
* server/src/parser: Modules that perform tokenization and parsing of Python source
* server/src/tests: Tests for the parser and analyzer


## Core Concepts

Pyright implements a [service](https://github.com/Microsoft/pyright/blob/master/server/src/analyzer/service.ts), a persistent in-memory object that controls the order of analysis and provides an interface for the language server. For multi-root workspaces, each workspace gets its own service instance.

The service owns an instance of a [program](https://github.com/Microsoft/pyright/blob/master/server/src/analyzer/program.ts), which tracks the configuration file and all of the source files that make up the source base that is to be analyzed. A source file can be added to a program if it is a) referenced by the config file, b) currently open in the editor, or c) imported directly or indirectly by another source file. The program object is responsible for setting up file system watchers and updating the program as files are added, deleted, or edited. The program is also responsible for prioritizing all phases of analysis for all files, favoring files that are open in the editor (and their import dependencies).

The program tracks multiple [sourceFile](https://github.com/Microsoft/pyright/blob/master/server/src/analyzer/sourceFile.ts) objects. Each source file represents the contents of one Python source file on disk. It tracks the status of analysis for the file, including any intermediate or final results of the analysis and the diagnostics (errors and warnings) that result.

The program makes use of an [importResolver](https://github.com/Microsoft/pyright/blob/master/server/src/analyzer/importResolver.ts) to resolve the imported modules referenced within each source file.


## Analysis Phases

Pyright performs the following analysis phases for each source file.

The [tokenizer](https://github.com/Microsoft/pyright/blob/master/server/src/parser/tokenizer.ts) is responsible for converting the file’s string contents into a stream of tokens. White space, comments, and some end-of-line characters are ignored, as they are not needed by the parser.

The [parser](https://github.com/Microsoft/pyright/blob/master/server/src/parser/parser.ts) is responsible for converting the token stream into a parse tree. A generalized [parseTreeWalker](https://github.com/Microsoft/pyright/blob/master/server/src/analyzer/parseTreeWalker.ts) provides a convenient way to traverse the parse tree. All subsequent analysis phases utilize the parseTreeWalker.

The [binder](https://github.com/Microsoft/pyright/blob/master/server/src/analyzer/binder.ts) is responsible for building scopes and populating the symbol table for each scope. It does not perform any type checking, but it detects and reports some semantic errors that will result in unintended runtime exceptions. It also detects and reports inconsistent name bindings (e.g. a variable that uses both a global and nonlocal binding in the same scope). The binder also builds a "reverse code flow graph" for each scope, allowing the type analyzer to determine a symbol's type at any point in the code flow based on its antecedents.

The [checker](https://github.com/Microsoft/pyright/blob/master/server/src/analyzer/checker.ts) is responsible for checking all of the statements and expressions within a source file. It relies heavily on the [typeEvaluator](https://github.com/Microsoft/pyright/blob/master/server/src/analyzer/typeEvaluator.ts) module, which performs most of the heavy lifting. The checker doesn't run on all files, only those that require full diagnostic output. For example, if a source file is not part of the program but is imported by the program, the checker doesn't need to run on it.

## Type Checking Concepts

Pyright uses an internal type called “Unknown” to represent types that are not annotated and cannot be inferred. Unknown is generally treated like the “Any” type in terms of type checking, but it provides a way for developers to know when type annotations are missing and could provide additional value.

Pyright attempts to infer the types of global (module-level) variables, class variables, instance variables, and local variables. Return and yield types are also inferred. If type annotations are provided in these cases, the type annotation overrides any inferred types.

Pyright supports type constraints (sometimes called “path constraints” or "type guards") to track assumptions that apply within certain code flow paths. For example, consider the following code:
```python
def (a: Optional[Union[str, List[str]]):
    if isinstance(a, str):
        log(a)
    elif isinstance(a, list):
        log(msg) for msg in a
    else:
        log(a)
```

In this example, the type evaluator knows that parameter a is either None, str, or List[str]. Within the first `if` clause, a is constrained to be a str. Within the `elif` clause, it is constrained to be a List[str], and within the `else` clause, it has to be None (by process of elimination). The type checker would therefore flag the final line as an error if the log method could not accept None as a parameter.

If the type constraint logic exhausts all possible subtypes, it can be assumed that a code path will never be taken. For example, consider the following:
```python
def (a: Union[Foo, Bar]):
    if isinstance(a, Foo):
        # a must be type Foo
        a.do_something_1()
    elif isinstance(a, Bar):
        # a must be type Bar
        a.do_something_2()
    else:
        # This code is unreachable, so type is "Never"
        a.do_something_3()
```

In this case, the type of parameter “a” is initially “Union[Foo, Bar]”. Within the “if” clause, the type constraint logic will conclude that it must be of type “Foo”. Within the “elif” clause, it must be of type “Bar”. What type is it within the “else” clause? The type constraint system has eliminated all possible subtypes, so it gives it the type “Never”. This is generally indicates that there’s a logic error in the code because there’s way that code block will ever be executed.

## Type Inference

In cases where explicit type annotations are not provided, Pyright attempts to infer the types. The inferred return type of a function is determined from all of the return (and yield) statements within the function’s definition. The inferred type of a local variable is determined by the expression that is assigned to that variable. Likewise, the type of a member variable is inferred from all assignments to that member variable within its defining class.

The types of input parameters cannot be inferred, with the exception of the “self” or “cls” parameter for instance members and class members, respectively.

If an inferred return type is unknown or partially unknown because input parameter types are not annotated, Pyright may still be able to infer the return type based on the types of arguments at the call site. 
```
def add_values(a, b):
    return a + b

# The type of result1 is "int"
result1 = add_values(1, 2)

# Type type of result2 is "str"
result2 = add_values('abc', 'def')
```
