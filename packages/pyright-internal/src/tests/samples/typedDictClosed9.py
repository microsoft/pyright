# This sample tests the handling of calls with unpacked TypedDicts.


from typing_extensions import TypedDict  # pyright: ignore[reportMissingModuleSource]


class ClosedTD1(TypedDict, closed=True):
    arg1: str


class IntDict1(TypedDict, extra_items=int):
    arg1: str


td1 = ClosedTD1(arg1="hello")
td2 = IntDict1(arg1="hello", arg2=3)


def func1(arg1: str):
    pass


func1(**td1)

# This should arguably generate an error because there
# could be extra items, but we'll match mypy's behavior here.
func1(**td2)


def func2(arg1: str, **kwargs: str):
    pass


func2(**td1)

# This should result in an error.
func2(**td2)
