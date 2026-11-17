# This sample tests disjoint-base narrowing while retaining
# compatible intersections and uncertain runtime membership.

from typing import Any, Callable, TypeIs, assert_never, assert_type, dataclass_transform, disjoint_base, final


@disjoint_base
class Left:
    pass


@disjoint_base
class Right:
    pass


class Child(Left):
    pass


class Plain:
    pass


class OtherPlain:
    pass


class Slots:
    __slots__ = ("x",)


@final
class Final:
    pass


def instance(value: Left):
    if isinstance(value, Right):
        assert_never(value)
    else:
        assert_type(value, Left)


def subclass(value: type[Left]):
    if issubclass(value, Right):
        assert_never(value)
    else:
        assert_type(value, type[Left])


def inherited(value: Child):
    if isinstance(value, Right):
        assert_never(value)
    else:
        assert_type(value, Child)


def slotted(value: Slots):
    if isinstance(value, Left):
        assert_never(value)


def final_class(value: Final):
    if isinstance(value, Right):
        assert_never(value)


def ordinary(value: Plain):
    if isinstance(value, OtherPlain):
        reveal_type(value, expected_text="<subclass of Plain and OtherPlain>")


def ordinary_subclass(value: type[Plain]):
    if issubclass(value, OtherPlain):
        reveal_type(value, expected_text="type[<subclass of Plain and OtherPlain>]")


def mixin(value: Left):
    if isinstance(value, Plain):
        reveal_type(value, expected_text="<subclass of Left and Plain>")


def mixed_filters(value: Left):
    if isinstance(value, (Right, Plain)):
        reveal_type(value, expected_text="<subclass of Left and Plain>")
    if isinstance(value, (Plain, Right)):
        reveal_type(value, expected_text="<subclass of Left and Plain>")


def any_value(value: Any):
    if isinstance(value, Right):
        assert_type(value, Right)
    else:
        assert_type(value, Any)


def unknown_value(value):
    if isinstance(value, Right):
        assert_type(value, Right)
    else:
        reveal_type(value, expected_text="Unknown")


def type_variable[T](value: T, other: T):
    if isinstance(value, Right):
        assert_type(value, Right)
    else:
        assert_type(value, object)


def type_variable_filter[T](value: Left, expected: type[T]):
    if isinstance(value, expected):
        reveal_type(value, expected_text="<subclass of Left and object*>*")


def subclass_inclusive_filter(value: Left, expected: type[Right]):
    if isinstance(value, expected):
        reveal_type(value, expected_text="<subclass of Left and Right>")


def is_right(value: object) -> TypeIs[Right]:
    return isinstance(value, Right)


def type_is(value: Left):
    if is_right(value):
        assert_never(value)
    else:
        assert_type(value, Left)


class MembershipMeta(type):
    def __instancecheck__(cls, value: object) -> bool:
        return True

    def __subclasscheck__(cls, value: type) -> bool:
        return True


@disjoint_base
class Virtual(metaclass=MembershipMeta):
    pass


def virtual_instance(value: Left):
    if isinstance(value, Virtual):
        reveal_type(value, expected_text="<subclass of Left and Virtual>")


def virtual_subclass(value: type[Left]):
    if issubclass(value, Virtual):
        reveal_type(value, expected_text="type[<subclass of Left and Virtual>]")


@dataclass_transform()
def model[T](*, slots: bool = False) -> Callable[[type[T]], type[T]]: ...


@model(slots=True)
class Transformed:
    x: int


def transformed(value: Transformed):
    if isinstance(value, Left):
        assert_never(value)


def accepts_float(value: float) -> None:
    pass


def is_real_number(value: object) -> TypeIs[float]:
    return isinstance(value, (int, float))


def is_int(value: object) -> TypeIs[int]:
    return isinstance(value, int)


def numeric_type_is(value: int):
    accepts_float(value)
    promoted: float = value
    if is_real_number(value):
        assert_type(value, int)
        value.bit_length()
    else:
        assert_never(value)


def numeric_promotion_control(value: float):
    if is_int(value):
        assert_type(value, int)
        value.bit_length()
    else:
        assert_type(value, float)
        value.hex()
