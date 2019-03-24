# Pyright Internals

## Core Concepts

Pyright implements a [service](https://github.com/Microsoft/pyright/blob/master/server/src/analyzer/service.ts), a persistent in-memory singleton object that controls the order of analysis and provides an interface for the language server.

The service owns an instance of a [program](https://github.com/Microsoft/pyright/blob/master/server/src/analyzer/program.ts), which tracks the configuration file and all of the source files that make up the source base that is to be analyzed. A source file can be added to a program if it is a) referenced by the config file, b) currently open in the editor, or c) imported directly or indirectly by another source file. The program object is responsible for setting up file system watchers and updating the program as files are added, deleted, or edited. The program is also responsible for prioritizing all phases of analysis for all files, favoring files that are open in the editor (and their import dependencies).

The program tracks multiple [sourceFile](https://github.com/Microsoft/pyright/blob/master/server/src/analyzer/sourceFile.ts) objects. Each source file represents the contents of one Python source file on disk. It tracks the status of analysis for the file, including any intermediate or final results of the analysis and the diagnostics (errors and warnings) that result.

The program makes use of an [importResolver](https://github.com/Microsoft/pyright/blob/master/server/src/analyzer/importResolver.ts) to resolve the imported modules referenced within each source file.


## Analysis Phases

Pyright performs the following analysis phases for each source file.

The [tokenizer](https://github.com/Microsoft/pyright/blob/master/server/src/parser/tokenizer.ts) is responsible for converting the file’s string contents into a stream of tokens. White space, comments, and some end-of-line characters are ignored, as they are not needed by the parser.

The [parser](https://github.com/Microsoft/pyright/blob/master/server/src/parser/parser.ts) is responsible for converting the token stream into a parse tree. A generalized [parseTreeWalker](https://github.com/Microsoft/pyright/blob/master/server/src/analyzer/parseTreeWalker.ts) provides a convenient way to traverse the parse tree. All subsequent analysis phases utilize the parseTreeWalker.

The [postParseWalker](https://github.com/Microsoft/pyright/blob/master/server/src/analyzer/postParseWalker.ts) adds parent links to parse tree nodes and builds name bindings for names that appear within modules, classes and functions. It also detects and reports inconsistent name bindings (e.g. a variable that uses both a global and nonlocal binding in the same scope). It is also responsible for creating a list of all imports, allowing the program object to resolve these imports (using the importResolver) and add the imported source files to the program.

The [semanticAnalyzer](https://github.com/Microsoft/pyright/blob/master/server/src/analyzer/semanticAnalyzer.ts) is responsible for performing basic semantic analysis. It does not perform any type checking, but it detects and reports other semantic errors that will result in unintended runtime exceptions. It also constructs information needed by the next phase of analysis.

The [typeAnalyzer](https://github.com/Microsoft/pyright/blob/master/server/src/analyzer/typeAnalyzer.ts) is responsible for interpreting type annotations, performing type inference, and reporting type inconsistencies. Unlike all previous passes, the typeAnalyzer pass runs multiple times — at least twice per file. This is necessary because type annotations can contain forward references within a file and because Python supports circular import dependencies across files. The typeAnalyzer therefore runs multiple times until all type information “converges”, and no new information is discovered.

## Type Checking Concepts

Pyright uses an internal type called “Unknown” to represent types that are not annotated and cannot be inferred. Unknown is generally treated like the “Any” type in terms of type checking, but it provides a way for developers to know when type annotations are missing and could provide additional value.

Pyright attempts to infer the types of global (module-level) variables, class variables, instance variables, and local variables. Return and yield types are also inferred. If type annotations are provided in these cases, the type annotation overrides any inferred types.

Pyright supports type constraints (sometimes called “path constraints”) to track assumptions that apply within certain paths of code flow. For example, consider the following code:
```python

def (a: Optional[Union[str, List[str]]:
    if isinstance(a, str):
        log(a)
    elif a:
        log(msg) for msg in a
    else:
        log(a)
```

In this example, the type checker knows that parameter a is either None, str, or List[str]. Within the first `if` clause, a is constrained to be a str. Within the `elif` clause, it is constrained to be a List[str], and within the `else` clause, it has to be None (by process of elimination). The type checker would therefore flag the final line as an error if the log method could not accept None as a parameter.


