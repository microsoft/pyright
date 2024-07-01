# This sample tests error handling for PEP 696. TypeVars without default
# types cannot be after TypeVars with default types. This is the same as
# typeVarDefault3 except that it uses PEP 695 syntax.

from typing import TypeVar


# This should generate an error because T1 is after T2.
class ClassA[T2 = str, T1]: ...


# This should generate an error because T1 is after T2.
def funcA[T2 = str, T1](a: T2, b: T1) -> T1 | T2: ...


# This should generate an error because T1 is after T2.
type TA_A[T2 = str, T1] = dict[T2, T1]
