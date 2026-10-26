# This sample tests inference for a bounded TypeVar used with a contravariant
# generic and an additional unrelated union subtype.

from typing import Generic, TypeVar

T_contra = TypeVar("T_contra", contravariant=True)


class Box(Generic[T_contra]): ...


class Base: ...


class A(Base): ...


class B(Base): ...


class Other: ...


def take[K: Base](box: Box[K], value: K) -> None: ...


take(Box[A | B](), B())
take(Box[A | B | Other](), B())


def return_value[K: Base](box: Box[K], value: K) -> K:
    return value


reveal_type(return_value(Box[A | B](), B()), expected_text="B")
reveal_type(return_value(Box[A | B | Other](), B()), expected_text="B")


# This should generate an error because Other does not satisfy the bound.
take(Box[A | B | Other](), Other())
