# This sample tests reflected operator priority for class-object operands
# whose metaclasses have a proper subclass relationship.

from types import NotImplementedType


class Meta(type):
    def __or__(cls, other: object) -> int:
        return 7

    def __ror__(cls, other: object) -> object:
        return "base reflected"

    def __add__(cls, other: object) -> int:
        return 7


class SubMeta(Meta):
    def __ror__(cls, other: object) -> str:
        return "reflected"

    def __radd__(cls, other: object) -> str:
        return "reflected"


class NoOverrideMeta(Meta): ...


class AliasMeta(Meta):
    __ror__ = Meta.__ror__


class DifferentAliasMeta(Meta):
    def reflected(cls, other: object) -> str:
        return "different"

    __ror__ = reflected


class DecliningMeta(Meta):
    def __ror__(cls, other: object) -> NotImplementedType:
        return NotImplemented


class PartlyDecliningMeta(Meta):
    def __ror__(cls, other: object) -> str | NotImplementedType:
        return "reflected"


class UnrelatedMeta(type):
    def __ror__(cls, other: object) -> str:
        return "unrelated"


class Left(metaclass=Meta): ...


class Right(metaclass=SubMeta): ...


class OtherRight(metaclass=SubMeta): ...


class NoOverride(metaclass=NoOverrideMeta): ...


class Alias(metaclass=AliasMeta): ...


class DifferentAlias(metaclass=DifferentAliasMeta): ...


class Declines(metaclass=DecliningMeta): ...


class PartlyDeclines(metaclass=PartlyDecliningMeta): ...


class Unrelated(metaclass=UnrelatedMeta): ...


class Plain: ...


def func1() -> str:
    reveal_type(Left | Right, expected_text="str")
    reveal_type(Left + Right, expected_text="str")
    reveal_type(Right | Left, expected_text="int")
    reveal_type(Left | Left, expected_text="int")
    reveal_type(Right | OtherRight, expected_text="int")
    reveal_type(Left | NoOverride, expected_text="int")
    reveal_type(Left | Alias, expected_text="int")
    reveal_type(Left | DifferentAlias, expected_text="str")
    reveal_type(Left | Unrelated, expected_text="int")
    reveal_type(Plain | Right, expected_text="str")
    reveal_type(Right | Plain, expected_text="int")
    reveal_type(int | str, expected_text="UnionType")
    return (Left | Right).upper()


def func2(left: type[Left], right: type[Right], alternative: type[Right] | type[NoOverride]):
    reveal_type(left | right, expected_text="str")
    reveal_type(left | alternative, expected_text="str | int")
    reveal_type(left | Declines, expected_text="int")
    reveal_type(left | PartlyDeclines, expected_text="str | int")
    reveal_type(Declines.__ror__(left), expected_text="NotImplementedType")


def invalid_reflected_result():
    # This should generate an error because the reflected operation returns str.
    return (Left | Right).bit_length()


def invalid_same_metaclass_result():
    # This should generate an error because normal priority returns int.
    return (Left | Left).upper()
