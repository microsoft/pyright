# This sample tests that the negative filtering for the 'isinstance'
# narrowing logic properly preserves a TypeVar.

from typing import Literal, TypeVar, Generic


class Operator:
    ...


OpType = TypeVar("OpType", bound=Operator)


class BasePipeline(Operator, Generic[OpType]):
    def __init__(
        self,
        step: OpType,
    ) -> None:
        if isinstance(step, BasePipeline):
            t1: Literal["BasePipeline[Unknown]"] = reveal_type(step)
        else:
            t2: Literal["OpType@BasePipeline"] = reveal_type(step)


T1 = TypeVar("T1", int, str)


def do_nothing1(x: T1) -> T1:
    if isinstance(x, int):
        return x
    return x
