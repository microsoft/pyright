# This sample tests the callable syntax described in PEP 677.

from typing import Callable, Concatenate, ParamSpec, TypeVar
from typing_extensions import TypeVarTuple, Unpack

P = ParamSpec("P")
T = TypeVar("T")
Ts = TypeVarTuple("Ts")

def func0(
    a: (int, str) -> float,
    b: (int | str) -> (int | str),
    c: (...) -> (complex, str) -> int | None
) -> (int, str) -> None:
    ...
reveal_type(func0, expected_text='(a: (int, str) -> float, b: (int | str) -> (int | str), c: (...) -> ((complex, str) -> int | None)) -> ((int, str) -> None)')

def func1() -> async (int, str) -> bool:
    ...
reveal_type(func1, expected_text='() -> ((int, str) -> Awaitable[bool])')

def func2() -> ((int, str) -> bool):
    ...
reveal_type(func2, expected_text='() -> ((int, str) -> bool)')

def func3() -> (int) -> (str) -> bool:
    ...
reveal_type(func3, expected_text='() -> ((int) -> ((str) -> bool))')

def func4() -> ((int) -> ((str) -> bool)):
    ...
reveal_type(func4, expectedText='() -> ((int) -> ((str) -> bool))')

def func5() -> (T) -> T:
    ...
reveal_type(func5, expected_text='() -> ((T@func5) -> T@func5)')


A1 = (int) -> str | bool
reveal_type(A1, expected_text='(int) -> (str | bool)')

A2 = (int) -> (str | bool)
reveal_type(A2, expected_text='(int) -> (str | bool)')


B1 = (int) -> (str) -> bool
reveal_type(B1, expected_text='(int) -> ((str) -> bool)')

B2 = (int) -> ((str) -> bool)
reveal_type(B2, expected_text='(int) -> ((str) -> bool)')


# This should generate an error because parens are needed.
C1 = () -> int | () -> bool

C2 = () -> int | (() -> bool)
reveal_type(C2, expected_text='() -> (int | (() -> bool))')

C3 = (() -> int) | (() -> bool)
reveal_type(C3, expected_text='(() -> int) | (() -> bool)')

D0 = (int,) -> bool
reveal_type(D0, expected_text='(int) -> bool')

D1 = (int) -> bool
reveal_type(D1, expected_text='(int) -> bool')

D2 = (int, T, **P,) -> bool
reveal_type(D2, expected_text='(int, T@D2, **P@D2) -> bool')

D3 = (int, T, **P) -> bool
reveal_type(D3, expected_text='(int, T@D3, **P@D3) -> bool')

D4 = (...,) -> bool
reveal_type(D4, expected_text='(...) -> bool')

D5 = (...) -> bool
reveal_type(D5, expected_text='(...) -> bool')

E1 = Callable[Concatenate[int, T, P], bool]
reveal_type(E1, expected_text='(int, T@E1, **P@E1) -> bool')

E2 = (int, T, **P) -> bool
reveal_type(E2, expected_text='(int, T@E2, **P@E2) -> bool')

F1 = (...) -> int
reveal_type(F1, expected_text='(...) -> int')

# This should generate an error because * can't be used with ellipsis.
F2 = (*...) -> int

# This should generate an error because ** can't be used with ellipsis.
F3 = (**...) -> int

# This should generate an error because ellipsis must be the only parameter.
F4 = (..., str) -> int

# This should generate an error because ellipsis must be the only parameter.
F5 = (int, str, ...) -> int


G1 = (int, *Ts, str) -> int
reveal_type(G1, expected_text='(int, *Ts@G1, str) -> int')

G2 = (int, Unpack[Ts], str) -> int
reveal_type(G2, expected_text='(int, *Ts@G2, str) -> int')

# This should generate an error because Ts is doubly unpacked.
G3 = (int, *Unpack[Ts], str) -> int

# This should generate an error because int isn't a TypeVarTuple
G4 = (*int, str) -> int

# This should generate an error because P isn't a TypeVarTuple
G5 = (*P, str) -> int


H1 = (int, **P) -> int
reveal_type(H1, expected_text='(int, **P@H1) -> int')

# This should generate an error because P isn't preceded by **.
H2 = (int, P) -> int

# This should generate an error because int isn't a ParamSpec.
H3 = (int, **int) -> int

# This should generate an error because P isn't the last parameter.
H4 = (**P, int) -> int
