# This sample tests function parameter matching logic.


from typing import Any, Callable, Literal


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

str_list = ["he", "2", "3"]

# This should generate an error
func1(3, *str_list)


def func2(a: str, **b: int):
    pass


func2("hi")
func2("hi", b=3, c=4, d=5)

str_dict = {"a": "3", "b": "2"}

# This should generate a type error
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

    # This should generate two errors because param0 has no match
    # and param2 is missing.
    func6(param0, param1=param1)


def func8(
    y: str,
    z: bool = ...,
) -> None: ...


kwargs1: dict[str, int] = {}
# This should generate an error because int is not compatible with str.
func8(z=False, **kwargs1)


class MyStr(str): ...


kwargs2: dict[MyStr, MyStr] = {}
func8(z=False, **kwargs2)


def func9(
    x: int,
    y: str,
    *,
    a: str = ...,
    b: str,
    c: str,
) -> None: ...


kwargs3: dict[str, str] = {}
func9(0, "", **kwargs3)

args4: list[str] = ["hi"]
func9(0, *args4, **kwargs3)

# This should generate an error.
func9(*args4, **kwargs3)


def func10(x: int): ...


func10(1, *())

# This should generate an error.
func10(1, *(1,))

func10(*(1,))

# This should generate an error.
func10(*(1, 1))

# This should generate an error.
func10(*("",))


def func11(y: tuple[int, ...]):
    func10(1, *y)


def func12(x: int, /, y: str):
    pass


# This should generate an error.
func12(1, **{"z": None})


def func13(*, a: str, b: str, c: int | None = None):
    ...


func_args1: dict[Literal["a", "b", "d"], str] = {
    "a": "a",
    "b": "b",
    "d": "d",
}

func13(**func_args1)

func_args2: dict[Literal["a", "b", "c"], str] = {
    "a": "a",
    "b": "b",
    "c": "c",
}


# This should generate an error.
func13(**func_args2)


def func14(cb1: Callable[..., Any], cb2: Any, x: None):
    cb1(**x)  # This should generate an error
    cb2(**x)  # This should generate an error


def func15(cb1: Callable[..., Any], cb2: Any, a: int, b: None | str):
    print(*a)  # This should generate an error
    print(*b)  # This should generate an error
    cb1(*a)  # This should generate an error
    cb2(*b)  # This should generate an error

