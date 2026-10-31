# This sample tests the handling of a TypeVar whose upper bound is
# a tuple when used for an *args parameter or unpacked in a tuple.

from typing import Any, Callable, Generic, NamedTuple, TypeVar, Unpack


T = TypeVar("T", bound="tuple[int, ...]")


def func1(*args: Unpack[T]) -> tuple[int, ...]:
    a, *v = args

    reveal_type(a, expected_text="int")

    b: int = a

    # This should generate an error.
    c: str = a

    reveal_type(v, expected_text="list[int]")

    return args


S = TypeVar("S", bound=list[int])


# This should generate an error.
def func2(*args: Unpack[S]) -> int:
    return 0


U = TypeVar("U", bound=tuple[int, str])
V = TypeVar("V", bound=tuple[object, ...])
E = TypeVar("E", bound=tuple[()])
R = TypeVar("R")
W = TypeVar("W", bound=tuple[int, str])


def func3(t: tuple[bytes, *U], u: tuple[int, *V, int], w: tuple[int, *E]):
    a, b, c = t
    reveal_type(a, expected_text="bytes")
    reveal_type(b, expected_text="int")
    reveal_type(c, expected_text="str")

    [d, *e, f] = u
    reveal_type(d, expected_text="int")
    reveal_type(e, expected_text="list[object]")
    reveal_type(f, expected_text="int")

    (g,) = w
    reveal_type(g, expected_text="int")


def func4(t: tuple[bytes, *U], u: tuple[int, *V, int]):
    # This should generate an error.
    a, b = t

    # This should generate an error.
    a, b, c, d = t

    # This should generate an error.
    [a] = u


def func5(t: tuple[bytes, *U], u: tuple[int, *V, int], w: tuple[int, *E]):
    reveal_type(t[1], expected_text="int")
    reveal_type(t[-1], expected_text="str")
    reveal_type(u[1], expected_text="int | object")
    reveal_type(u[-1], expected_text="int")
    reveal_type(w[0], expected_text="int")


def func6(t: tuple[bytes, *U]):
    # This should generate an error.
    t[3]

    # This should generate an error.
    t[-4]


def func7(t: tuple[bytes, *U], u: tuple[int, *V, int]):
    reveal_type(t[1:], expected_text="tuple[*U@func7]")
    reveal_type(u[1:], expected_text="tuple[*V@func7, int]")
    reveal_type(u[2:], expected_text="tuple[int | object, ...]")


def func8(t: tuple[bytes, *U], u: tuple[int, *V, int]):
    match t:
        case (x, y, z):
            reveal_type(y, expected_text="int")
            reveal_type(z, expected_text="str")

    match t:
        case (x, *y):
            reveal_type(y, expected_text="list[int | str]")

    match u:
        case (x, *y, z):
            reveal_type(y, expected_text="list[object]")


def func9(t: tuple[bytes, *U], u: tuple[int, *V, int]):
    r1 = None
    if len(t) == 3:
        r1 = t
    reveal_type(r1, expected_text="tuple[bytes, *U@func9] | None")

    r2 = None
    if len(t) != 3:
        r2 = t
    reveal_type(r2, expected_text="None")

    r3 = None
    if len(u) == 2:
        r3 = u
    reveal_type(r3, expected_text="tuple[int, *V@func9, int] | None")

    r4 = None
    if len(t) < 3:
        r4 = t
    reveal_type(r4, expected_text="None")

    r5 = None
    if len(t) >= 3:
        r5 = t
    reveal_type(r5, expected_text="tuple[bytes, *U@func9] | None")

    r6 = None
    if len(u) >= 3:
        r6 = u
    reveal_type(r6, expected_text="tuple[int, *V@func9, int] | None")


def func10(*args: Unpack[U]):
    r1 = None
    if len(args) == 2:
        r1 = args
    reveal_type(r1, expected_text="tuple[*U@func10] | None")

    r2 = None
    if len(args) != 2:
        r2 = args
    reveal_type(r2, expected_text="None")


def func11(t: tuple[bytes, *U]):
    for x in t:
        reveal_type(x, expected_text="bytes | int | str")


def func12(t: tuple[*V], f: Callable[[], None]):
    f(*t)


def func13(t: tuple[bytes, *U], f: Callable[[bytes, int], None]):
    # This should generate an error.
    f(*t)


def func14(*args: *tuple[str, *T, str]) -> T: ...


def func15(*args: *tuple[str, *U, str]) -> U: ...


def func16(t: tuple[str, int, str], u: tuple[int, ...]):
    reveal_type(func14("", ""), expected_text="tuple[()]")
    reveal_type(func14("", 1, 2, ""), expected_text="tuple[Literal[1], Literal[2]]")
    reveal_type(func14(*t), expected_text="tuple[int]")
    reveal_type(func14("", *u, ""), expected_text="tuple[int, ...]")
    reveal_type(func15("", 1, "x", ""), expected_text="tuple[Literal[1], Literal['x']]")


def func17(t: tuple[*T], u: tuple[str, *T, str], w: tuple[*U]):
    reveal_type(func14("", *t, ""), expected_text="tuple[*T@func17]")
    reveal_type(func14(*u), expected_text="tuple[*T@func17]")
    reveal_type(func15("", *w, ""), expected_text="tuple[*U@func17]")


def func18():
    # This should generate an error.
    func14("", "x", "")

    # This should generate an error.
    func14("")

    # This should generate an error.
    func15("", 1, "")

    # This should generate an error.
    func15("", 1, "x", 2, "")


def func19(*args: Unpack[U]) -> U: ...


def func20(*args: Unpack[V]) -> V: ...


class ClassNT(NamedTuple):
    a: int
    b: str


def func21(t: tuple[int, str], u: tuple[int, ...], w: tuple[*U], n: ClassNT, a: tuple[Any, ...], b: U):
    reveal_type(func19(1, ""), expected_text="tuple[Literal[1], Literal['']]")
    reveal_type(func20(), expected_text="tuple[()]")
    reveal_type(func20(1, "", b""), expected_text="tuple[Literal[1], Literal[''], Literal[b\"\"]]")
    reveal_type(func19(*t), expected_text="tuple[int, str]")
    reveal_type(func20(*u), expected_text="tuple[int, ...]")
    reveal_type(func20(*w), expected_text="tuple[*U@func21]")
    reveal_type(func20(1, *w), expected_text="tuple[Literal[1], *U@func21]")
    reveal_type(func19(*n), expected_text="tuple[int, str]")
    reveal_type(func19(*a), expected_text="tuple[Any, ...]")
    reveal_type(func19(*b), expected_text="tuple[*U@func21]")


def func22():
    # This should generate an error.
    func19(1)

    # This should generate an error.
    func19(1, 2)

    # This should generate an error.
    func19(1, "", 3)


def func23(*args: Unpack[U]):
    reveal_type(func19(*args), expected_text="tuple[*U@func23]")


def func24(cb: Callable[[Unpack[U]], R], args: U) -> tuple[R, U]: ...


def func25(cb: Callable[[bytes, Unpack[V], bytes], R]) -> V: ...


def func26(cb1: Callable[[int, str], bytes], cb2: Callable[[bytes, int, str, bytes], None]):
    reveal_type(func24(cb1, (1, "")), expected_text="tuple[bytes, tuple[Literal[1], Literal['']]]")
    reveal_type(func25(cb2), expected_text="tuple[int, str]")


def func27(cb1: Callable[[int, int], bytes], cb2: Callable[[int], bytes], cb3: Callable[[*tuple[int, ...]], None]):
    # This should generate an error.
    func24(cb1, (1, ""))

    # This should generate an error.
    func24(cb2, (1, ""))

    # This should generate an error.
    func25(cb3)


class ClassA(Generic[U]):
    def method1(self, *args: *tuple[str, *U, str]) -> None: ...

    def method2(self) -> Callable[[str, Unpack[U], str], None]:
        return self.method1

    def method3(self) -> Callable[[str, int, str, str], None]:
        # This should generate an error.
        return self.method1


class ClassB:
    def method1(self, *args: *tuple[bytes, *U, bool]) -> None: ...

    def method2(self, *args: *tuple[*U]) -> None: ...


class ClassC(ClassB):
    def method1(self, *args: *tuple[bytes, *U, bool]) -> None: ...


class ClassD(ClassB):
    # This should generate an error.
    def method1(self, a: bytes, b: str, c: str, d: bool, /) -> None: ...

    # This should generate an error.
    def method2(self, a: str, b: str, /) -> None: ...


class ClassE(ClassB):
    def method1(self, a: bytes, b: int, c: str, d: bool, /) -> None: ...

    def method2(self, a: int, b: str, /) -> None: ...


def func28(*args: Unpack[U]):
    reveal_type(args, expected_text="tuple[*U@func28]")
    a, b = args
    reveal_type(b, expected_text="str")


def func29(*args: Unpack[U]):
    # This should generate an error.
    args[2]


def func30(cb: Callable[[Unpack[U]], None], t: tuple[*U]):
    cb(*t)


def func31(cb: Callable[[Unpack[U]], None], t: U):
    cb(*t)


def func32(cb: Callable[[Unpack[U]], None], t: tuple[*W], u: W):
    # This should generate an error.
    cb(*t)

    # This should generate an error.
    cb(*u)


def func33(cb: Callable[[int, Unpack[U]], None], t: U):
    # This should generate an error.
    cb(*t)
