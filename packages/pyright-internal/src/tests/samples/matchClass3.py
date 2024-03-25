# This sample tests class-based pattern matching when the class is
# marked final and can be discriminated based on the argument patterns.

from typing import final, Protocol, runtime_checkable
from dataclasses import dataclass


class A:
    title: str


class B:
    name: str


class C:
    name: str


def func1(r: A | B | C):
    match r:
        case object(title=_):
            reveal_type(r, expected_text="A | B | C")

        case object(name=_):
            reveal_type(r, expected_text="A | B | C")

        case _:
            reveal_type(r, expected_text="A | B | C")


@final
class AFinal:
    title: str


@final
class BFinal:
    name: str


@final
class CFinal:
    name: str


@final
class DFinal:
    nothing: str


def func2(r: AFinal | BFinal | CFinal | DFinal):
    match r:
        case object(title=_):
            reveal_type(r, expected_text="AFinal")

        case object(name=_):
            reveal_type(r, expected_text="BFinal | CFinal")

        case _:
            reveal_type(r, expected_text="DFinal")


@runtime_checkable
class ProtoE(Protocol):
    __match_args__ = ("x",)
    x: int


@dataclass
class E:
    x: int


match E(1):
    case ProtoE(x):
        pass

    case y:
        reveal_type(y, expected_text="Never")
