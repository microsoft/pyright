# This sample tests the handling of a TypeVar symbol when it is
# used as a runtime object rather than a special form.

import typing as t
import typing_extensions as te  # pyright: ignore[reportMissingModuleSource]


T1 = t.TypeVar("T1")
S1 = t.TypeVar("S1", bound=str)
Ts1 = t.TypeVarTuple("Ts1")
P1 = t.ParamSpec("P1")

# In these cases, the TypeVar symbol simply represents the TypeVar
# object itself, rather than representing a type variable.
T1.__name__
S1.__name__
S1.__bound__
Ts1.__name__
P1.__name__


def func1(x: bool, a: T1, b: S1) -> T1 | S1:
    reveal_type(T1.__name__, expected_text="str")
    reveal_type(S1.__name__, expected_text="str")
    reveal_type(Ts1.__name__, expected_text="str")
    reveal_type(P1.__name__, expected_text="str")

    # This should generate an error.
    a.__name__

    # This should generate an error.
    b.__name__

    if x:
        return a
    else:
        return b


T2 = te.TypeVar("T2")
S2 = te.TypeVar("S2", bound=str)
Ts2 = te.TypeVarTuple("Ts2")
P2 = te.ParamSpec("P2")

T2.__name__
S2.__name__
S2.__bound__
Ts2.__name__
P2.__name__


def func2(x: bool, a: T2, b: S2) -> T2 | S2:
    reveal_type(T2.__name__, expected_text="str")
    reveal_type(S2.__name__, expected_text="str")
    reveal_type(Ts2.__name__, expected_text="str")
    reveal_type(P2.__name__, expected_text="str")

    if x:
        return a
    else:
        return b


def func3(t: t.TypeVar, ts: t.TypeVarTuple = ..., p: t.ParamSpec = ...) -> None: ...


func3(T1, Ts1, P1)

# This should generate an error for Python 3.12 and older because the runtime
# object typing.TypeVar is not the same as typing_extensions.TypeVar.
func3(T2)


def func4(t: te.TypeVar, ts: te.TypeVarTuple = ..., p: te.ParamSpec = ...) -> None: ...


func4(T2, Ts2, P2)


# This should generate an error for Python 3.12 and older because the runtime
# object typing.TypeVar is not the same as typing_extensions.TypeVar.
func4(T1)
