# This sample tests the handling of a TypedDict used as a bound
# for a TypeVar.


from typing import Generic, TypeVar, TypedDict


class TD1(TypedDict):
    a: str


T1 = TypeVar("T1", bound=TD1)


class A(Generic[T1]):
    def method1(self) -> T1:
        # This should generate an error.
        return {"a": ""}
