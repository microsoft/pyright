# This sample tests equivalence between enum classes and complete unions of
# their literal members.

from enum import Enum, EnumType, Flag, IntEnum, IntFlag, StrEnum, auto
from typing import Literal, assert_type


class Color(Enum):
    RED = 1
    GREEN = 2
    BLUE = 3


ColorLiterals = Literal[Color.RED, Color.GREEN, Color.BLUE]


def test_simple_equivalence(color: Color, literal_color: ColorLiterals) -> None:
    value1: ColorLiterals = color
    value2: Color = literal_color
    assert_type(color, ColorLiterals)
    assert_type(literal_color, Color)


PartialColorLiterals = Literal[Color.RED, Color.GREEN]
ColorLiteralSuperset = Literal[Color.RED, Color.GREEN, Color.BLUE, 0]


def test_incomplete_and_superset_unions(
    color: Color,
    partial_color: PartialColorLiterals,
    color_superset: ColorLiteralSuperset,
    color_list: list[Color],
    partial_color_list: list[PartialColorLiterals],
    color_superset_list: list[ColorLiteralSuperset],
) -> None:
    partial: PartialColorLiterals = color  # This should generate an error
    superset: ColorLiteralSuperset = color
    enum_value: Color = partial_color
    assert_type(color, PartialColorLiterals)  # This should generate an error
    assert_type(partial_color, Color)  # This should generate an error
    assert_type(color, ColorLiteralSuperset)  # This should generate an error
    assert_type(superset, Color)
    assert_type(color_superset, Color)  # This should generate an error

    partial_list1: list[PartialColorLiterals] = color_list  # This should generate an error
    partial_list2: list[Color] = partial_color_list  # This should generate an error
    superset_list1: list[ColorLiteralSuperset] = color_list  # This should generate an error
    superset_list2: list[Color] = color_superset_list  # This should generate an error


class Single(Enum):
    ONLY = 1


SingleLiteral = Literal[Single.ONLY]


def test_single_member_equivalence(single: Single, literal_single: SingleLiteral) -> None:
    value1: SingleLiteral = single
    value2: Single = literal_single
    assert_type(single, SingleLiteral)
    assert_type(literal_single, Single)


def test_union_equivalence(
    color_or_int: Color | int, literal_color_or_int: ColorLiterals | int
) -> None:
    value1: ColorLiterals | int = color_or_int
    value2: Color | int = literal_color_or_int
    assert_type(color_or_int, ColorLiterals | int)
    assert_type(literal_color_or_int, Color | int)


def test_invariant_identity(
    color_list: list[Color],
    color_dict: dict[Color, int],
    color_or_int_list: list[Color | int],
) -> None:
    value1: list[Color] = color_list
    value2: dict[Color, int] = color_dict
    value3: list[Color | int] = color_or_int_list
    assert_type(color_list, list[Color])
    assert_type(color_dict, dict[Color, int])
    assert_type(color_or_int_list, list[Color | int])


def test_invariant_equivalence(
    color_list: list[Color],
    literal_color_list: list[ColorLiterals],
    color_dict: dict[Color, int],
    literal_color_dict: dict[ColorLiterals, int],
    color_or_int_list: list[Color | int],
    literal_color_or_int_list: list[ColorLiterals | int],
) -> None:
    value1: list[ColorLiterals] = color_list
    value2: list[Color] = literal_color_list
    value3: dict[ColorLiterals, int] = color_dict
    value4: dict[Color, int] = literal_color_dict
    value5: list[ColorLiterals | int] = color_or_int_list
    value6: list[Color | int] = literal_color_or_int_list
    assert_type(color_list, list[ColorLiterals])
    assert_type(literal_color_list, list[Color])
    assert_type(color_dict, dict[ColorLiterals, int])
    assert_type(literal_color_dict, dict[Color, int])
    assert_type(color_or_int_list, list[ColorLiterals | int])
    assert_type(literal_color_or_int_list, list[Color | int])


class Number(IntEnum):
    ONE = 1
    TWO = 2


NumberLiterals = Literal[Number.ONE, Number.TWO]


class Text(StrEnum):
    FIRST = "first"
    SECOND = "second"


TextLiterals = Literal[Text.FIRST, Text.SECOND]


def test_non_flag_enum_subclasses(
    number: Number, literal_number: NumberLiterals, text: Text, literal_text: TextLiterals
) -> None:
    number_value1: NumberLiterals = number
    number_value2: Number = literal_number
    text_value1: TextLiterals = text
    text_value2: Text = literal_text
    assert_type(number, NumberLiterals)
    assert_type(literal_number, Number)
    assert_type(text, TextLiterals)
    assert_type(literal_text, Text)


class Automatic(Enum):
    FIRST = auto()
    SECOND = auto()


AutomaticLiterals = Literal[Automatic.FIRST, Automatic.SECOND]


def test_auto_values(
    value: Automatic, literal_value: AutomaticLiterals
) -> None:
    value1: AutomaticLiterals = value
    value2: Automatic = literal_value
    assert_type(value, AutomaticLiterals)
    assert_type(literal_value, Automatic)


class DirectFlags(Flag):
    FIRST = 1
    SECOND = 2


DirectFlagLiterals = Literal[DirectFlags.FIRST, DirectFlags.SECOND]


class IntegerFlags(IntFlag):
    FIRST = 1
    SECOND = 2


IntegerFlagLiterals = Literal[IntegerFlags.FIRST, IntegerFlags.SECOND]


class FlagBase(Flag):
    pass


class IndirectFlags(FlagBase):
    FIRST = 1
    SECOND = 2


IndirectFlagLiterals = Literal[IndirectFlags.FIRST, IndirectFlags.SECOND]


def test_flag_narrowing(
    direct: DirectFlags, integer: IntegerFlags, indirect: IndirectFlags
) -> None:
    if direct is DirectFlags.FIRST:
        pass
    else:
        assert_type(direct, DirectFlags)

    if integer is IntegerFlags.FIRST:
        pass
    else:
        assert_type(integer, IntegerFlags)

    if indirect is IndirectFlags.FIRST:
        pass
    else:
        assert_type(indirect, IndirectFlags)


direct_combination = DirectFlags.FIRST | DirectFlags.SECOND
integer_combination = IntegerFlags.FIRST | IntegerFlags.SECOND
indirect_combination = IndirectFlags.FIRST | IndirectFlags.SECOND

# These should generate errors because arbitrary combined flag values are not
# equivalent to a union of the declared flag members.
direct_literal: DirectFlagLiterals = direct_combination  # This should generate an error
integer_literal: IntegerFlagLiterals = integer_combination  # This should generate an error
indirect_literal: IndirectFlagLiterals = indirect_combination  # This should generate an error


def infer_optional[T](value: T | None) -> T:
    assert value is not None
    return value


def choose[T](left: T, right: T) -> T:
    return left


def test_type_var_inference(color: Color, literal_color: ColorLiterals) -> None:
    assert_type(infer_optional(color), Color)
    assert_type(choose(color, literal_color), Color)
    assert_type(choose(literal_color, color), Color)


def return_bound_enum[T: Color](value: T, other: T) -> ColorLiterals:
    return value


def test_type_var_invariant_source[T: Color, U: int](
    enum_bound_list: list[T],
    unrelated_list: list[U],
    literal_color_list: list[ColorLiterals],
) -> None:
    # A source TypeVar bound to the enum expands in an invariant position, so
    # list[T] and list[ColorLiterals] are treated as equivalent in both
    # directions.
    to_literals: list[ColorLiterals] = enum_bound_list
    assert_type(enum_bound_list, list[T])

    # An unrelated source TypeVar must not be collapsed to its bound while
    # probing for enum expansion, so the invariant comparison still fails and
    # the TypeVar remains intact.
    bad_to_literals: list[ColorLiterals] = unrelated_list  # This should generate an error
    bad_from_literals: list[U] = literal_color_list  # This should generate an error
    assert_type(unrelated_list, list[U])


def test_assignment_narrowing() -> None:
    color: Color = Color.RED
    assert_type(color, Literal[Color.RED])


class Aliased(Enum):
    FIRST = 1
    ALSO_FIRST = FIRST
    SECOND = 2


AliasedLiterals = Literal[Aliased.FIRST, Aliased.SECOND]


def test_aliases(value: Aliased, literal_value: AliasedLiterals) -> None:
    value1: AliasedLiterals = value
    value2: Aliased = literal_value
    assert_type(value, AliasedLiterals)
    assert_type(literal_value, Aliased)


def get_unknown_value() -> object:
    return object()


class UnknownValues(Enum):
    FIRST = get_unknown_value()
    SECOND = get_unknown_value()


UnknownValueLiterals = Literal[UnknownValues.FIRST, UnknownValues.SECOND]


def test_unknown_values(
    value: UnknownValues, literal_value: UnknownValueLiterals
) -> None:
    value1: UnknownValueLiterals = value
    value2: UnknownValues = literal_value
    assert_type(value, UnknownValueLiterals)
    assert_type(literal_value, UnknownValues)


class Empty(Enum):
    pass


def test_empty_enum(value: Empty) -> None:
    value2: Empty = value
    assert_type(value, Empty)


class DynamicBody(Enum):
    FIRST = 1
    locals()["SECOND"] = 2


DynamicBodyLiteral = Literal[DynamicBody.FIRST]


def test_dynamic_body(value: DynamicBody) -> None:
    # The indexed assignment is visible to static analysis, so the known
    # member subset is not treated as complete.
    dynamic_literal: DynamicBodyLiteral = value  # This should generate an error

    if value is DynamicBody.FIRST:
        pass
    else:
        assert_type(value, DynamicBody)


class CustomEnumType(EnumType):
    pass


class CustomMetaEnum(Enum, metaclass=CustomEnumType):
    FIRST = 1
    SECOND = 2


CustomMetaEnumLiterals = Literal[CustomMetaEnum.FIRST, CustomMetaEnum.SECOND]


def test_custom_metaclass(value: CustomMetaEnum) -> None:
    custom_literal: CustomMetaEnumLiterals = value  # This should generate an error

    if value is CustomMetaEnum.FIRST:
        pass
    else:
        assert_type(value, CustomMetaEnum)
