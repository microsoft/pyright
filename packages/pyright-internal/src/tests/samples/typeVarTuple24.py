# This sample tests the handling of `Union[*Ts]` in certain cases.

# Enable experimental features to support Union[*Ts].
# pyright: enableExperimentalFeatures=true

from typing import Generic, TypeVarTuple, Union

Ts = TypeVarTuple("Ts")


class ClassA(Generic[*Ts]):
    def __init__(self) -> None:
        self.x: list[Union[*Ts]] = []

        reveal_type(self.x, expected_text="list[Union[*Ts@ClassA]]")

    def method(self) -> Union[*Ts]: ...


a1 = ClassA[int, bool, str]()

reveal_type(a1.method(), expected_text="int | bool | str")
reveal_type(a1.x, expected_text="list[int | bool | str]")


def func1(t0: tuple[*Ts], t1: tuple[*Ts]):
    return all(v0 == v1 for v0, v1 in zip(t0, t1))
