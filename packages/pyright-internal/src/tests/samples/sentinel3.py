# This sample tests that Sentinel values retain their literal type
# even when the binding is not a CONSTANT_NAME.

from dataclasses import dataclass
from typing_extensions import Sentinel  # pyright: ignore[reportMissingModuleSource]


Empty = Sentinel("Empty")
MISSING = Sentinel("MISSING")


def func1(value: int | Empty) -> None:
    if value is Empty:
        reveal_type(value, expected_text="Empty")
    else:
        reveal_type(value, expected_text="int")


def func2(value: int | Empty) -> None:
    if value is not Empty:
        reveal_type(value, expected_text="int")
    else:
        reveal_type(value, expected_text="Empty")


@dataclass
class Address:
    email: str
    name: str | None


def update_not_empty(address: Address, email: str | Empty, name: str | None | Empty) -> None:
    if email is not Empty:
        address.email = email
        reveal_type(email, expected_text="str")
    if name is not Empty:
        address.name = name
        reveal_type(name, expected_text="str | None")


def update_not_missing(address: Address, email: str | MISSING) -> None:
    if email is not MISSING:
        address.email = email
        reveal_type(email, expected_text="str")


class ClassA:
    def __init__(self) -> None:
        self.missing = Sentinel("missing")


def func3(a: ClassA) -> None:
    reveal_type(a.missing, expected_text="missing")

    if a.missing is Empty:
        reveal_type(a.missing, expected_text="Never")


def func4() -> None:
    local_empty = Sentinel("local_empty")
    reveal_type(local_empty, expected_text="local_empty")

    alias = Empty
    reveal_type(alias, expected_text="Empty")

    local_empty = 3
    reveal_type(local_empty, expected_text="Literal[3]")


Reassigned = Sentinel("Reassigned")
Reassigned = 3


def func5(value: int | Empty | MISSING) -> None:
    reveal_type(Reassigned, expected_text="int | Reassigned")
    alias = Empty
    if value is alias:
        reveal_type(value, expected_text="Empty")
    else:
        reveal_type(value, expected_text="int | MISSING")
