import sys
from typing import (AbstractSet, Any, Callable, Dict, Generator, List, Mapping,
                    MutableMapping, NamedTuple, Optional, Sequence, Tuple,
                    Union,
                    )
from types import CodeType, FrameType, ModuleType, TracebackType

#
# Types and members
#
class EndOfBlock(Exception): ...

class BlockFinder:
    indent: int
    islambda: bool
    started: bool
    passline: bool
    indecorator: bool
    decoratorhasargs: bool
    last: int
    def tokeneater(self, type: int, token: str, srow_scol: Tuple[int, int],
                   erow_ecol: Tuple[int, int], line: str) -> None: ...

CO_OPTIMIZED: int
CO_NEWLOCALS: int
CO_VARARGS: int
CO_VARKEYWORDS: int
CO_NESTED: int
CO_GENERATOR: int
CO_NOFREE: int
if sys.version_info >= (3, 5):
    CO_COROUTINE: int
    CO_ITERABLE_COROUTINE: int
if sys.version_info >= (3, 6):
    CO_ASYNC_GENERATOR: int
TPFLAGS_IS_ABSTRACT: int

if sys.version_info < (3, 6):
    ModuleInfo = NamedTuple('ModuleInfo', [('name', str),
                                           ('suffix', str),
                                           ('mode', str),
                                           ('module_type', int),
                                           ])
    def getmoduleinfo(path: str) -> Optional[ModuleInfo]: ...

def getmembers(object: object,
               predicate: Optional[Callable[[Any], bool]] = ...,
               ) -> List[Tuple[str, Any]]: ...
def getmodulename(path: str) -> Optional[str]: ...

def ismodule(object: object) -> bool: ...
def isclass(object: object) -> bool: ...
def ismethod(object: object) -> bool: ...
def isfunction(object: object) -> bool: ...
def isgeneratorfunction(object: object) -> bool: ...
def isgenerator(object: object) -> bool: ...

if sys.version_info >= (3, 5):
    def iscoroutinefunction(object: object) -> bool: ...
    def iscoroutine(object: object) -> bool: ...
    def isawaitable(object: object) -> bool: ...
if sys.version_info >= (3, 6):
    def isasyncgenfunction(object: object) -> bool: ...
    def isasyncgen(object: object) -> bool: ...
def istraceback(object: object) -> bool: ...
def isframe(object: object) -> bool: ...
def iscode(object: object) -> bool: ...
def isbuiltin(object: object) -> bool: ...
def isroutine(object: object) -> bool: ...
def isabstract(object: object) -> bool: ...
def ismethoddescriptor(object: object) -> bool: ...
def isdatadescriptor(object: object) -> bool: ...
def isgetsetdescriptor(object: object) -> bool: ...
def ismemberdescriptor(object: object) -> bool: ...


#
# Retrieving source code
#
def findsource(object: object) -> Tuple[List[str], int]: ...
def getabsfile(object: object) -> str: ...
def getblock(lines: Sequence[str]) -> Sequence[str]: ...
def getdoc(object: object) -> str: ...
def getcomments(object: object) -> str: ...
def getfile(object: object) -> str: ...
def getmodule(object: object) -> ModuleType: ...
def getsourcefile(object: object) -> str: ...
# TODO restrict to "module, class, method, function, traceback, frame,
# or code object"
def getsourcelines(object: object) -> Tuple[List[str], int]: ...
# TODO restrict to "a module, class, method, function, traceback, frame,
# or code object"
def getsource(object: object) -> str: ...
def cleandoc(doc: str) -> str: ...
def indentsize(line: str) -> int: ...


#
# Introspecting callables with the Signature object
#
def signature(callable: Callable[..., Any],
              *,
              follow_wrapped: bool = ...) -> Signature: ...

class Signature:
    def __init__(self,
                 parameters: Optional[Sequence[Parameter]] = ...,
                 *,
                 return_annotation: Any = ...) -> None: ...
    # TODO: can we be more specific here?
    empty: object = ...

    parameters: Mapping[str, Parameter]

    # TODO: can we be more specific here?
    return_annotation: Any

    def bind(self, *args: Any, **kwargs: Any) -> BoundArguments: ...
    def bind_partial(self, *args: Any, **kwargs: Any) -> BoundArguments: ...
    def replace(self,
                *,
                parameters: Optional[Sequence[Parameter]] = ...,
                return_annotation: Any = ...) -> Signature: ...

    if sys.version_info >= (3, 5):
        @classmethod
        def from_callable(cls,
                          obj: Callable[..., Any],
                          *,
                          follow_wrapped: bool = ...) -> Signature: ...

# The name is the same as the enum's name in CPython
class _ParameterKind: ...

class Parameter:
    def __init__(self,
                 name: str,
                 kind: _ParameterKind,
                 *,
                 default: Any = ...,
                 annotation: Any = ...) -> None: ...
    empty: Any = ...
    name: str
    default: Any
    annotation: Any

    kind: _ParameterKind
    POSITIONAL_ONLY: _ParameterKind = ...
    POSITIONAL_OR_KEYWORD: _ParameterKind = ...
    VAR_POSITIONAL: _ParameterKind = ...
    KEYWORD_ONLY: _ParameterKind = ...
    VAR_KEYWORD: _ParameterKind = ...

    def replace(self,
                *,
                name: Optional[str] = ...,
                kind: Optional[_ParameterKind] = ...,
                default: Any = ...,
                annotation: Any = ...) -> Parameter: ...

class BoundArguments:
    arguments: MutableMapping[str, Any]
    args: Tuple[Any, ...]
    kwargs: Dict[str, Any]
    signature: Signature

    if sys.version_info >= (3, 5):
        def apply_defaults(self) -> None: ...


#
# Classes and functions
#

# TODO: The actual return type should be List[_ClassTreeItem] but mypy doesn't
# seem to be supporting this at the moment:
# _ClassTreeItem = Union[List[_ClassTreeItem], Tuple[type, Tuple[type, ...]]]
def getclasstree(classes: List[type], unique: bool = ...) -> Any: ...

ArgSpec = NamedTuple('ArgSpec', [('args', List[str]),
                                 ('varargs', str),
                                 ('keywords', str),
                                 ('defaults', tuple),
                                 ])

Arguments = NamedTuple('Arguments', [('args', List[str]),
                                     ('varargs', Optional[str]),
                                     ('varkw', Optional[str]),
                                     ])

def getargs(co: CodeType) -> Arguments: ...
def getargspec(func: object) -> ArgSpec: ...

FullArgSpec = NamedTuple('FullArgSpec', [('args', List[str]),
                                         ('varargs', Optional[str]),
                                         ('varkw', Optional[str]),
                                         ('defaults', tuple),
                                         ('kwonlyargs', List[str]),
                                         ('kwonlydefaults', Dict[str, Any]),
                                         ('annotations', Dict[str, Any]),
                                         ])

def getfullargspec(func: object) -> FullArgSpec: ...

# TODO make the field types more specific here
ArgInfo = NamedTuple('ArgInfo', [('args', List[str]),
                                 ('varargs', Optional[str]),
                                 ('keywords', Optional[str]),
                                 ('locals', Dict[str, Any]),
                                 ])

def getargvalues(frame: FrameType) -> ArgInfo: ...
def formatannotation(annotation: object, base_module: Optional[str] = ...) -> str: ...
def formatannotationrelativeto(object: object) -> Callable[[object], str]: ...
def formatargspec(args: List[str],
                  varargs: Optional[str] = ...,
                  varkw: Optional[str] = ...,
                  defaults: Optional[Tuple[Any, ...]] = ...,
                  kwonlyargs: Optional[List[str]] = ...,
                  kwonlydefaults: Optional[Dict[str, Any]] = ...,
                  annotations: Dict[str, Any] = ...,
                  formatarg: Callable[[str], str] = ...,
                  formatvarargs: Callable[[str], str] = ...,
                  formatvarkw: Callable[[str], str] = ...,
                  formatvalue: Callable[[Any], str] = ...,
                  formatreturns: Callable[[Any], str] = ...,
                  formatannotations: Callable[[Any], str] = ...,
                  ) -> str: ...
def formatargvalues(args: List[str],
                    varargs: Optional[str] = ...,
                    varkw: Optional[str] = ...,
                    locals: Optional[Dict[str, Any]] = ...,
                    formatarg: Optional[Callable[[str], str]] = ...,
                    formatvarargs: Optional[Callable[[str], str]] = ...,
                    formatvarkw: Optional[Callable[[str], str]] = ...,
                    formatvalue: Optional[Callable[[Any], str]] = ...,
                    ) -> str: ...
def getmro(cls: type) -> Tuple[type, ...]: ...

def getcallargs(func: Callable[..., Any],
                *args: Any,
                **kwds: Any) -> Dict[str, Any]: ...


ClosureVars = NamedTuple('ClosureVars', [('nonlocals', Mapping[str, Any]),
                                         ('globals', Mapping[str, Any]),
                                         ('builtins', Mapping[str, Any]),
                                         ('unbound', AbstractSet[str]),
                                         ])
def getclosurevars(func: Callable[..., Any]) -> ClosureVars: ...

def unwrap(func: Callable[..., Any],
           *,
           stop: Optional[Callable[[Any], Any]] = ...) -> Any: ...


#
# The interpreter stack
#

Traceback = NamedTuple(
    'Traceback',
    [
        ('filename', str),
        ('lineno', int),
        ('function', str),
        ('code_context', List[str]),
        ('index', int),
    ]
)

# Python 3.5+ (functions returning it used to return regular tuples)
FrameInfo = NamedTuple('FrameInfo', [('frame', FrameType),
                                     ('filename', str),
                                     ('lineno', int),
                                     ('function', str),
                                     ('code_context', List[str]),
                                     ('index', int),
                                     ])

def getframeinfo(frame: Union[FrameType, TracebackType], context: int = ...) -> Traceback: ...
def getouterframes(frame: Any, context: int = ...) -> List[FrameInfo]: ...
def getinnerframes(traceback: TracebackType, context: int = ...) -> List[FrameInfo]: ...
def getlineno(frame: FrameType) -> int: ...
def currentframe() -> Optional[FrameType]: ...
def stack(context: int = ...) -> List[FrameInfo]: ...
def trace(context: int = ...) -> List[FrameInfo]: ...

#
# Fetching attributes statically
#

def getattr_static(obj: object, attr: str, default: Optional[Any] = ...) -> Any: ...


#
# Current State of Generators and Coroutines
#

# TODO In the next two blocks of code, can we be more specific regarding the
# type of the "enums"?

GEN_CREATED: str
GEN_RUNNING: str
GEN_SUSPENDED: str
GEN_CLOSED: str
def getgeneratorstate(generator: Generator[Any, Any, Any]) -> str: ...

if sys.version_info >= (3, 5):
    CORO_CREATED: str
    CORO_RUNNING: str
    CORO_SUSPENDED: str
    CORO_CLOSED: str
    # TODO can we be more specific than "object"?
    def getcoroutinestate(coroutine: object) -> str: ...

def getgeneratorlocals(generator: Generator[Any, Any, Any]) -> Dict[str, Any]: ...

if sys.version_info >= (3, 5):
    # TODO can we be more specific than "object"?
    def getcoroutinelocals(coroutine: object) -> Dict[str, Any]: ...

Attribute = NamedTuple('Attribute', [('name', str),
                                     ('kind', str),
                                     ('defining_class', type),
                                     ('object', object),
                                     ])

def classify_class_attrs(cls: type) -> List[Attribute]: ...
