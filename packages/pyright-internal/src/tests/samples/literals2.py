# This sample tests assignment of literals to declared
# types that use literals in their type arguments.

from typing import Dict, List, Literal, Set, TypeVar

Number = Literal["One", "Two"]

# This should generate an error because 'Three' is not
# allowed in the Number type.
numbers_mapping: Dict[Number, int] = {"One": 1, "Two": 2, "Three": 3}

# This should generate an error because 'Three' is not
# allowed in the Number type.
a: List[Number] = ["Three"]

# This should generate an error because 'Three' is not
# allowed in the Number type.
b: Set[Number] = {"One", "Three"}


LetterGrade = Literal["A", "B", "C", "D", "F"]

_T = TypeVar("_T")


def func1(x: _T) -> _T: ...


grade: LetterGrade = func1("A")
