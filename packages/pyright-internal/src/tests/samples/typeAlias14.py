# This sample tests that certain type aliases cannot be used within
# call expressions.

from typing import Callable, Optional, Tuple, Type, TypeVar, Union


T_Union = Union[int, float]

# This should generate an error
T_Union(3)

T_Callable = Callable[[int], None]

# This should generate an error
T_Callable(1)


T_Type1 = Type[int]

# This should generate an error
T_Type1(object)

T_Type2 = type
T_Type2(object)

T_Optional = Optional[str]

# This should generate an error
T_Optional(3)


T_TypeVar = TypeVar("T_TypeVar")

# This should generate an error
T_TypeVar()


T_Tuple1 = Tuple[int, ...]

# This should generate an error
T_Tuple1([3, 4])


I = int

I(3)


T_Tuple2 = tuple[int, ...]

T_Tuple2([3, 4, 5])
