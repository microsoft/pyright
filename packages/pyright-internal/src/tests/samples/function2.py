# This sample tests function parameter matching logic.


from typing import Any, Dict, List


def func1(a: int, *b: int):
    pass


func1(3)
func1(3, 4)
func1(3, *[1, 2, 3])

# This should generate an error
func1(3, "hello")

# This should generate an error
func1(3, 5, 2, "str")

# This should generate an error
func1("hello", 3)

# This should generate an error
str_list = ["he", "2", "3"]
func1(3, *str_list)


def func2(a: str, **b: int):
    pass


func2("hi")
func2("hi", b=3, c=4, d=5)

str_dict = {"a": "3", "b": "2"}
func2("hi", **str_dict)


# This should generate a type error
func2("hi", 3)

# This should generate a type error
func2("hi", b="hi")


def func4(*args: int):
    pass


def func5(a: int, *args):
    pass


tuple1 = (2, 3)
func4(*tuple1)
func5(*tuple1)

# This should generate an error because a is assigned twice.
func2(a="", a="")

# This should generate an error because c is assigned twice.
func2("", c=4, d=5, c=5)


def func6(param1: int, param2: str):
    pass


def func7(*args: Any, param0: int, param1: int, param2: str):
    func6(*args, param1=param1, param2=param2)

    func6(param0, param2=param2)

    # This should generate an error because param0 has no match.
    func6(param0, param1=param1)


def func8(
    y: str,
    z: bool = ...,
) -> None:
    ...


kwargs1: Dict[str, int] = {}
# This should generate an error because int is not compatible with str.
func8(z=False, **kwargs1)


class MyStr(str):
    ...


kwargs2: Dict[MyStr, MyStr] = {}
func8(z=False, **kwargs2)


def func9(
    x: int,
    y: str,
    *,
    a: str = ...,
    b: str,
    c: str,
) -> None:
    ...


kwargs3: Dict[str, str] = {}
func9(0, "", **kwargs3)

args4: List[str] = ["hi"]
func9(0, *args4, **kwargs3)

# This should generate an error
func9(*args4, **kwargs3)
