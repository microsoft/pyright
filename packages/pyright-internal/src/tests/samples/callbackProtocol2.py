# This sample tests the case where an object is assigned to a
# callback protocol and the object's "__call__" has unannotated
# or "Any" parameter types.

from typing import Any, Protocol, TypeVar

InputT = TypeVar("InputT", contravariant=True)
OutputT = TypeVar("OutputT", covariant=True)


class MyCallable(Protocol[InputT, OutputT]):
    def __call__(self, inputs: InputT) -> OutputT: ...


class Class1:
    def __call__(self, inputs) -> int:
        return 5


g1: MyCallable[int, int] = Class1()


class Class2:
    def __call__(self, inputs: Any) -> int:
        return 5


g2: MyCallable[int, int] = Class2()
