# This sample tests the handling of Unpack[TypedDict] when used with
# a **kwargs parameter in a function signature.

from typing import Protocol, TypedDict
from typing_extensions import (  # pyright: ignore[reportMissingModuleSource]
    NotRequired,
    Required,
    Unpack,
)


class TD1(TypedDict):
    v1: Required[int]
    v2: NotRequired[str]


class TD2(TD1):
    v3: Required[str]


def func1(**kwargs: Unpack[TD2]) -> None:
    v1 = kwargs["v1"]
    reveal_type(v1, expected_text="int")

    # This should generate an error because v2 might not be present.
    kwargs["v2"]

    if "v2" in kwargs:
        v2 = kwargs["v2"]
        reveal_type(v2, expected_text="str")

    v3 = kwargs["v3"]
    reveal_type(v3, expected_text="str")


reveal_type(func1, expected_text="(**kwargs: **TD2) -> None")


def func2(v3: str, **kwargs: Unpack[TD1]) -> None:
    pass


def func3():
    # This should generate an error because it is
    # missing required keyword arguments.
    func1()

    func1(v1=1, v2="", v3="5")

    td2 = TD2(v1=2, v3="4")
    func1(**td2)

    # This should generate an error because v4 is not in TD2.
    func1(v1=1, v2="", v3="5", v4=5)

    # This should generate an error because args are passed by position.
    func1(1, "", "5")

    my_dict: dict[str, str] = {}
    # This should generate an error because it's an untyped dict.
    func1(**my_dict)

    d1 = {"v1": 2, "v3": "4", "v4": 4}
    func1(**d1)

    func2(**td2)

    # This should generate an error because v1 is already specified.
    func1(v1=2, **td2)

    # This should generate an error because v1 is already specified.
    func2(1, **td2)

    # This should generate an error because v1 is matched to a
    # named parameter and is not available for kwargs.
    func2(v1=1, **td2)


class TDProtocol1(Protocol):
    def __call__(self, *, v1: int, v3: str) -> None: ...


class TDProtocol2(Protocol):
    def __call__(self, *, v1: int, v3: str, v2: str = "") -> None: ...


class TDProtocol3(Protocol):
    def __call__(self, *, v1: int, v2: int, v3: str) -> None: ...


class TDProtocol4(Protocol):
    def __call__(self, *, v1: int) -> None: ...


class TDProtocol5(Protocol):
    def __call__(self, v1: int, v3: str) -> None: ...


class TDProtocol6(Protocol):
    def __call__(self, **kwargs: Unpack[TD2]) -> None: ...


v1: TDProtocol1 = func1
v2: TDProtocol2 = func1

# This should generate an error because v2 is the wrong type.
v3: TDProtocol3 = func1

# This should generate an error because v3 is missing.
v4: TDProtocol4 = func1

# This should generate an error because parameters are positional.
v5: TDProtocol5 = func1

v6: TDProtocol6 = func1


def func4(v1: int, /, **kwargs: Unpack[TD2]) -> None: ...


# This should generate an error because parameter v1 overlaps
# with the TypedDict.
def func5(v1: int, **kwargs: Unpack[TD2]) -> None: ...


class TD3(TypedDict):
    a: int


def func6(a: int, /, **kwargs: Unpack[TD3]):
    pass


func6(1, a=2)


def func7(*, v1: int, v3: str, v2: str = "") -> None: ...


# This should generate an error because func7 doesn't
# accept additional keyword arguments.
v7: TDProtocol6 = func7
