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
