# Pyright Internals

## Code Structure

* packages/vscode-pyright/src/extension.ts: Language Server Protocol (LSP) client entry point for VS Code extension.
* packages/pyright-internal/typeshed-fallback/: Recent copy of Typeshed type stub files for Python stdlib
* packages/pyright-internal/src/pyright.ts: Main entry point for command-line tool
* packages/pyright-internal/src/server.ts: Main entry point for LSP server
* packages/pyright-internal/src/analyzer: Modules that perform analysis passes over Python parse tree
* packages/pyright-internal/src/common: Modules  that are common to the parser and analyzer
* packages/pyright-internal/src/parser: Modules that perform tokenization and parsing of Python source
* packages/pyright-internal/src/tests: Tests for the parser and analyzer


## Core Concepts

Pyright implements a [service](https://github.com/Microsoft/pyright/blob/master/packages/pyright-internal/src/analyzer/service.ts), a persistent in-memory object that controls the order of analysis and provides an interface for the language server. For multi-root workspaces, each workspace gets its own service instance.

The service owns an instance of a [program](https://github.com/Microsoft/pyright/blob/master/packages/pyright-internal/src/analyzer/program.ts), which tracks the configuration file and all of the source files that make up the source base that is to be analyzed. A source file can be added to a program if it is a) referenced by the config file, b) currently open in the editor, or c) imported directly or indirectly by another source file. The program object is responsible for setting up file system watchers and updating the program as files are added, deleted, or edited. The program is also responsible for prioritizing all phases of analysis for all files, favoring files that are open in the editor (and their import dependencies).

The program tracks multiple [sourceFile](https://github.com/Microsoft/pyright/blob/master/packages/pyright-internal/src/analyzer/sourceFile.ts) objects. Each source file represents the contents of one Python source file on disk. It tracks the status of analysis for the file, including any intermediate or final results of the analysis and the diagnostics (errors and warnings) that result.

The program makes use of an [importResolver](https://github.com/Microsoft/pyright/blob/master/packages/pyright-internal/src/analyzer/importResolver.ts) to resolve the imported modules referenced within each source file.


## Analysis Phases

Pyright performs the following analysis phases for each source file.

The [tokenizer](https://github.com/Microsoft/pyright/blob/master/packages/pyright-internal/src/parser/tokenizer.ts) is responsible for converting the file’s string contents into a stream of tokens. White space, comments, and some end-of-line characters are ignored, as they are not needed by the parser.

The [parser](https://github.com/Microsoft/pyright/blob/master/packages/pyright-internal/src/parser/parser.ts) is responsible for converting the token stream into a parse tree. A generalized [parseTreeWalker](https://github.com/Microsoft/pyright/blob/master/packages/pyright-internal/src/analyzer/parseTreeWalker.ts) provides a convenient way to traverse the parse tree. All subsequent analysis phases utilize the parseTreeWalker.

The [binder](https://github.com/Microsoft/pyright/blob/master/packages/pyright-internal/src/analyzer/binder.ts) is responsible for building scopes and populating the symbol table for each scope. It does not perform any type checking, but it detects and reports some semantic errors that will result in unintended runtime exceptions. It also detects and reports inconsistent name bindings (e.g. a variable that uses both a global and nonlocal binding in the same scope). The binder also builds a “reverse code flow graph” for each scope, allowing the type analyzer to determine a symbol’s type at any point in the code flow based on its antecedents.

The [checker](https://github.com/Microsoft/pyright/blob/master/packages/pyright-internal/src/analyzer/checker.ts) is responsible for checking all of the statements and expressions within a source file. It relies heavily on the [typeEvaluator](https://github.com/Microsoft/pyright/blob/master/packages/pyright-internal/src/analyzer/typeEvaluator.ts) module, which performs most of the heavy lifting. The checker doesn’t run on all files, only those that require full diagnostic output. For example, if a source file is not part of the program but is imported by the program, the checker doesn’t need to run on it.

## Type Checking Concepts

Pyright uses an internal type called “Unknown” to represent types that are not annotated and cannot be inferred. Unknown is generally treated like the “Any” type in terms of type checking, but it provides a way for developers to know when type annotations are missing and could provide additional value.

Pyright attempts to infer the types of global (module-level) variables, class variables, instance variables, and local variables. Return and yield types are also inferred. If type annotations are provided in these cases, the type annotation overrides any inferred types.

Pyright supports type narrowing to track assumptions that apply within certain code flow paths. For example, consider the following code:
```python
def func(a: Optional[Union[str, List[str]]):
    if isinstance(a, str):
        log(a)
    elif isinstance(a, list):
        log(msg) for msg in a
    else:
        log(a)
```

In this example, the type evaluator knows that parameter a is either None, str, or List[str]. Within the first `if` clause, a is constrained to be a str. Within the `elif` clause, it is constrained to be a List[str], and within the `else` clause, it has to be None (by process of elimination). The type checker would therefore flag the final line as an error if the log method could not accept None as a parameter.

Narrowing is also applied values are assigned to a variable.

```python
def func(b: Optional[Union[str, List[str]]]):
    # The declared type of “a” is a union of three types
    # (str, List[str] and None).
    a: Optional[Union[str, List[str]]] = b
    reveal_type(a) # Type is `Optional[Union[str, List[str]]]`
    
    a = "hi"
    reveal_type(a) # Type is `str`

    a = ["a", "b", "c"]
    reveal_type(a) # Type is `List[str]`

    a = None
    reveal_type(a) # Type is `None`
```

If the type narrowing logic exhausts all possible subtypes, it can be assumed that a code path will never be taken. For example, consider the following:

```python
def func(a: Union[Foo, Bar]):
    if isinstance(a, Foo):
        # “a” must be type Foo
        a.do_something_1()
    elif isinstance(a, Bar):
        # “a” must be type Bar
        a.do_something_2()
    else:
        # This code is unreachable, so type of “a” is "Never"
        a.do_something_3()
```

In this case, the type of parameter “a” is initially “Union[Foo, Bar]”. Within the “if” clause, the type narrowing logic will conclude that it must be of type “Foo”. Within the “elif” clause, it must be of type “Bar”. What type is it within the “else” clause? The type narrowing system has eliminated all possible subtypes, so it gives it the type “Never”. This is generally indicates that there’s a logic error in the code because there’s way that code block will ever be executed.

Narrowing is also used to discriminate between subtypes of a union when the union subtypes have a common member with declared literal types that differentiate between the subtypes.

```python
class Foo:
    kind: Literal["Foo"]
    def do_something_1(self):
        pass

class Bar:
    kind: Literal["Bar"]
    def do_something_2(self):
        pass

def func(a: Union[Foo, Bar]):
    if a.kind == "Foo":
        a.do_something_1()
    else:
        a.do_something_2()
```
