# This sample tests that the negative filtering for the 'isinstance'
# narrowing logic properly preserves a TypeVar.

from typing import TypeVar, Generic


class Operator: ...


OpType = TypeVar("OpType", bound=Operator)


class BasePipeline(Operator, Generic[OpType]):
    def __init__(
        self,
        step: OpType,
    ) -> None:
        if isinstance(step, BasePipeline):
            reveal_type(step, expected_text="BasePipeline[Unknown]*")
        else:
            reveal_type(step, expected_text="Operator*")


T1 = TypeVar("T1", int, str)


def do_nothing1(x: T1) -> T1:
    if isinstance(x, int):
        return x
    return x


T2 = TypeVar("T2")


def func2(arg: T2) -> T2:
    if isinstance(arg, str):
        reveal_type(arg, expected_text="str*")

    reveal_type(arg, expected_text="str* | object*")
    return arg
