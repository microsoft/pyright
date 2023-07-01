# This sample tests subscript forms specified in PEP 637 -
# keyword and unpacked args.

from typing import Any, Union, overload


class ClassA:
    @overload
    def __getitem__(self, index: int) -> int:
        ...

    @overload
    def __getitem__(self, index: tuple[int, ...]) -> float:
        ...

    @overload
    def __getitem__(self, index: Any, *, v1: int) -> str:
        ...

    def __getitem__(self, index: Any, *, v1: int = 3) -> Union[str, float]:
        ...

    @overload
    def __setitem__(self, index: int, value: int) -> None:
        ...

    @overload
    def __setitem__(self, index: tuple[int, ...], value: float) -> None:
        ...

    @overload
    def __setitem__(self, index: Any, value: str, *, v1: int) -> None:
        ...

    def __setitem__(self, index: Any, value: Union[str, float], *, v1: int = 3) -> None:
        ...


val_list = [1, 2, 3]
val_dict = {"a": 2, "b": 2}

a_obj = ClassA()

x1 = a_obj[1]
reveal_type(x1, expected_text="int")

a_obj[1] = 3

# This should generate an error because float isn't assignable.
a_obj[1] = 3.5

x2 = a_obj[1,]
reveal_type(x2, expected_text="float")

a_obj[1,] = 3.4

# This should generate an error because complex isn't assignable.
a_obj[1,] = 3.5j

x3 = a_obj[1,2]
reveal_type(x3, expected_text="float")

a_obj[1,2] = 4.5

# This should generate an error because complex isn't assignable.
a_obj[1,2] = 3.5j

x4 = a_obj[(1,)]
reveal_type(x4, expected_text="float")

a_obj[(1,)] = 3

# This should generate an error because complex isn't assignable.
a_obj[(1,)] = 3.5j

x6 = a_obj[1, v1=3]
reveal_type(x6, expected_text="str")

a_obj[1, v1=3] = "hi"

# This should generate an error because complex isn't assignable.
a_obj[1,v1=3] = 3.5j


x8 = a_obj[1, *val_list]
reveal_type(x8, expected_text="float")

a_obj[1, *val_list] = 4.3

# This should generate an error because complex isn't assignable.
a_obj[1, *val_list] = 4.3j



class ClassB:
    def __getitem__(self, value: tuple[()], *, v1: int) -> str:
        ...

b_obj = ClassB()

# This should generate an error because positional args are not allowed.
y1 = b_obj[1]

y2 = b_obj[v1=3]
reveal_type(y2, expected_text="str")

# This should generate an error because v2 is not a named arg.
y3 = b_obj[v2=3]


class ClassC:
    def __getitem__(self, index: Any, **kwargs: int) -> complex:
        ...
    
    def __setitem__(self, index: Any, value: float, **kwargs: int) -> None:
        ...
    
c_obj = ClassC()

z1 = c_obj[1, *val_list]
reveal_type(z1, expected_text="complex")

# This should generate an error because dictionary unpack isn't allowed in subscript.
z2 = c_obj[1, *val_list, **val_dict]

c_obj[1, *val_list] = 4.3

# This should generate an error because dictionary unpack isn't allowed in subscript.
c_obj[1, *val_list, **val_dict] = 4.3

# This should generate an error because complex isn't assignable.
c_obj[1, *val_list] = 4.3j


z2 = c_obj[1, v1=3, v2=4]
reveal_type(z2, expected_text="complex")

c_obj[1, v1=3, v2=4] = 4.3

# This should generate an error because complex isn't assignable.
c_obj[1, v1=3, v2=4] = 4.3j
