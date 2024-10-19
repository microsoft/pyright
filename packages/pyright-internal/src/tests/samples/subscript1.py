# This sample tests the reporting of builtin types that
# will generate exceptions when subscripted in older
# versions of Python.

from queue import Queue
from collections import OrderedDict, deque
from asyncio import Future, Task


# These should generate errors for Python 3.8 and older.
def func1(
    a1: Queue[int],
    b1: OrderedDict[str, str],
    d1: list[int],
    e1: dict[str, int],
    f1: set[int],
    g1: deque[int],
    h1: frozenset[int],
    # These previously generated errors, but no longer do because of
    # changes in the typeshed stubs.
    c1: Future[int],
    i1: Task[None],
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
    i1: "Task[None]",
) -> None:
    pass


# These should generate errors because they are used
# in variable types, but they appear outside of a function.
class A:
    a1: Queue[int] = Queue()
    b1: OrderedDict[str, str] = OrderedDict()
    d1: list[int] = []
    e1: dict[str, int] = {}
    f1: set[int] = set()
    g1: deque[int] = deque()
    h1: frozenset[int] = frozenset()

    # These previously generated errors, but no longer do because of
    # changes in the typeshed stubs.
    c1: Future[int] = Future()
    i1: Task[None]


class B:
    a2: "Queue[int]" = Queue()
    b2: "OrderedDict[str, str]" = OrderedDict()
    c2: "Future[int]" = Future()
    d2: "list[int]" = []
    e2: "dict[str, int]" = {}
    f2: "set[int]" = set()
    g2: "deque[int]" = deque()
    h2: "frozenset[int]" = frozenset()
    i1: "Task[None]"


def func3():
    # These should not generate errors.
    a1: Queue[int] = Queue()
    b1: OrderedDict[str, str] = OrderedDict()
    c1: Future[int] = Future()
    d1: list[int] = []
    e1: dict[str, int] = {}
    f1: set[int] = set()
    g1: deque[int] = deque()
    h1: frozenset[int] = frozenset()
    i1: Task[None]
