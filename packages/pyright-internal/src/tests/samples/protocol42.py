# This sample tests the case where a protocol implementation uses a
# method-scoped type variable.

from typing import Protocol, Sequence, TypeVar

Input = TypeVar("Input", contravariant=True)
Output = TypeVar("Output", covariant=True)
T = TypeVar("T")


class ProtoA(Protocol[Input, Output]):
    def __call__(self, input: Input) -> Output:
        raise NotImplementedError


class ImplA:
    def __call__(self, input: Sequence[T]) -> T:
        return input[0]


v1: ProtoA[Sequence[int], int] = ImplA()
