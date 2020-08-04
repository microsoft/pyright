# This sample tests the type checker's "type var scoring" mechanism
# whereby it attempts to solve type variables with the simplest
# possible solution.

from typing import Union, List, TypeVar, Type

T = TypeVar('T')


def to_list1(obj_type: Type[T], obj: Union[List[T], T]) -> List[T]:
    return []

def to_list2(obj_type: Type[T], obj: Union[T, List[T]]) -> List[T]:
    return []


input_list: List[str] = ["string"]


# The expression on the RHS can satisfy the type variable T
# with either the type str or Union[List[str], str]. It should
# pick the simpler of the two.
output_list1 = to_list1(str, input_list)
verify_type1: List[str] = output_list1

# The resulting type should not depend on the order of the union
# elements.
output_list2 = to_list2(str, input_list)
verify_type2: List[str] = output_list2
