# This sample tests the handling of `Union[*Ts]` in certain cases.


from typing import Generic, TypeVarTuple, Union

Ts = TypeVarTuple("Ts")


class ClassA(Generic[*Ts]):
    def __init__(self) -> None:
        self.x: list[Union[*Ts]] = []

        reveal_type(self.x, expected_text="list[Union[*Ts@ClassA]]")

    def method(self) -> Union[*Ts]:
        ...


a1 = ClassA[int, bool, str]()

reveal_type(a1.method(), expected_text="int | bool | str")
reveal_type(a1.x, expected_text="list[int | bool | str]")
