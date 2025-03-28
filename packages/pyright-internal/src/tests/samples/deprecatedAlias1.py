# This sample tests the detection of deprecated classes from the typing
# module.

from typing import (
    ChainMap as CM1,
    Counter as CT1,
    DefaultDict,
    Deque,
    Dict,
    FrozenSet,
    List,
    Optional,
    OrderedDict as OD1,
    Set,
    Tuple,
    Type,
    Union,
    Awaitable,
    Coroutine,
    AsyncIterable,
    AsyncGenerator,
    Iterable,
    Iterator,
    Generator,
    Reversible,
    Container,
    Collection as C1,
    Callable,
    AbstractSet,
    MutableSet,
    Mapping,
    MutableMapping,
    Sequence,
    MutableSequence,
    ByteString as BS1,
    MappingView,
    KeysView,
    ItemsView,
    ValuesView,
    ContextManager as CM1,
    AsyncContextManager,
    Pattern as P1,
    Match as M1,
)

from collections.abc import Collection, ByteString, Set as AS
from contextlib import AbstractContextManager
from re import Pattern, Match

# These should be marked deprecated for Python >= 3.9
v1: List[int] = [1, 2, 3]
v2: Dict[int, str] = {}
v3: Set[int] = set()
v4: Tuple[int] = (3,)
v5: FrozenSet[int] = frozenset()
v6: Type[int] = int
v7 = Deque()
v8 = DefaultDict()

# These should be marked deprecated for Python >= 3.10
v20: Union[int, str]
v21: Optional[int]
