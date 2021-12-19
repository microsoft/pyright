# This sample tests the callable syntax described in PEP 677.

from typing import Callable, Concatenate, Literal, ParamSpec, TypeVar
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
t_func0: Literal['(a: (int, str) -> float, b: (int | str) -> (int | str), c: (...) -> ((complex, str) -> int | None)) -> ((int, str) -> None)'] = reveal_type(func0)

def func1() -> async (int, str) -> bool:
    ...
t_func1: Literal['() -> ((int, str) -> Awaitable[bool])'] = reveal_type(func1)

def func2() -> ((int, str) -> bool):
    ...
t_func2: Literal['() -> ((int, str) -> bool)'] = reveal_type(func2)

def func3() -> (int) -> (str) -> bool:
    ...
t_func3: Literal['() -> ((int) -> ((str) -> bool))'] = reveal_type(func3)

def func4() -> ((int) -> ((str) -> bool)):
    ...
t_func4: Literal['() -> ((int) -> ((str) -> bool))'] = reveal_type(func4)

def func5() -> (T) -> T:
    ...
t_func5: Literal['() -> ((T@func5) -> T@func5)'] = reveal_type(func5)


A1 = (int) -> str | bool
t_a1: Literal['(int) -> (str | bool)'] = reveal_type(A1)

A2 = (int) -> (str | bool)
t_a2: Literal['(int) -> (str | bool)'] = reveal_type(A2)


B1 = (int) -> (str) -> bool
t_b1: Literal['(int) -> ((str) -> bool)'] = reveal_type(B1)

B2 = (int) -> ((str) -> bool)
t_b2: Literal['(int) -> ((str) -> bool)'] = reveal_type(B2)


# This should generate an error because parens are needed.
C1 = () -> int | () -> bool

C2 = () -> int | (() -> bool)
t_c2: Literal['() -> (int | (() -> bool))'] = reveal_type(C2)

C3 = (() -> int) | (() -> bool)
t_c3: Literal['(() -> int) | (() -> bool)'] = reveal_type(C3)

D0 = (int,) -> bool
t_d0: Literal['(int) -> bool'] = reveal_type(D0)

D1 = (int) -> bool
t_d1: Literal['(int) -> bool'] = reveal_type(D1)

D2 = (int, T, **P,) -> bool
t_d2: Literal['(int, T@D2, **P@D2) -> bool'] = reveal_type(D2)

D3 = (int, T, **P) -> bool
t_d3: Literal['(int, T@D3, **P@D3) -> bool'] = reveal_type(D3)

D4 = (...,) -> bool
t_d4: Literal['(...) -> bool'] = reveal_type(D4)

D5 = (...) -> bool
t_d5: Literal['(...) -> bool'] = reveal_type(D5)

E1 = Callable[Concatenate[int, T, P], bool]
t_e1: Literal['(int, T@E1, **P@E1) -> bool'] = reveal_type(E1)

E2 = (int, T, **P) -> bool
t_e2: Literal['(int, T@E2, **P@E2) -> bool'] = reveal_type(E2)

F1 = (...) -> int
t_f1: Literal['(...) -> int'] = reveal_type(F1)

# This should generate an error because * can't be used with ellipsis.
F2 = (*...) -> int

# This should generate an error because ** can't be used with ellipsis.
F3 = (**...) -> int

# This should generate an error because ellipsis must be the only parameter.
F4 = (..., str) -> int

# This should generate an error because ellipsis must be the only parameter.
F5 = (int, str, ...) -> int


G1 = (int, *Ts, str) -> int
t_g1: Literal['(int, *Ts@G1, str) -> int'] = reveal_type(G1)

G2 = (int, Unpack[Ts], str) -> int
t_g2: Literal['(int, *Ts@G2, str) -> int'] = reveal_type(G2)

# This should generate an error because Ts is doubly unpacked.
G3 = (int, *Unpack[Ts], str) -> int

# This should generate an error because int isn't a TypeVarTuple
G4 = (*int, str) -> int

# This should generate an error because P isn't a TypeVarTuple
G5 = (*P, str) -> int


H1 = (int, **P) -> int
t_h1: Literal['(int, **P@H1) -> int'] = reveal_type(H1)

# This should generate an error because P isn't preceded by **.
H2 = (int, P) -> int

# This should generate an error because int isn't a ParamSpec.
H3 = (int, **int) -> int

# This should generate an error because P isn't the last parameter.
H4 = (**P, int) -> int
