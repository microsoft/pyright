# This sample tests the reporting of builtin types that
# will generate exceptions when subscripted in older
# versions of Python.

from queue import Queue
from collections import OrderedDict, deque
from asyncio import Future
from os import PathLike

# These should generate errors for Python 3.8 and older.
def func1(
    a1: Queue[int],
    b1: OrderedDict[str, str],
    c1: Future[int],
    d1: list[int],
    e1: dict[str, int],
    f1: set[int],
    g1: deque[int],
    h1: frozenset[int],
    i1: PathLike[str]
) -> None:
    pass

def func2(
    a1: "Queue[int]",
    b1: "OrderedDict[str, str]",
    c1: "Future[int]",
    d1: "list[int]",
    e1: "dict[str, int]",
    f1: "set[int]",
    g1: "deque[int]",
    h1: "frozenset[int]",
    i1: "PathLike[str]"
) -> None:
    pass

# These should not generate errors because they are used
# in variable types.
a1: Queue[int] = Queue()
b1: OrderedDict[str, str] = OrderedDict()
c1: Future[int] = Future()
d1: list[int] = []
e1: dict[str, int] = {}
f1: set[int] = set()
g1: deque[int] = deque()
h1: frozenset[int] = frozenset()
i1: PathLike[str]

a2: "Queue[int]" = Queue()
b2: "OrderedDict[str, str]" = OrderedDict()
c2: "Future[int]" = Future()
d2: "list[int]" = []
e2: "dict[str, int]" = {}
f2: "set[int]" = set()
g2: "deque[int]" = deque()
h2: "frozenset[int]" = frozenset()
i2: "PathLike[str]"

