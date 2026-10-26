# This sample tests that method aliases retain inherited callable contracts.


class Base:
    def convert(self, value: int) -> str:
        return str(value)


class Derived(Base):
    def helper(self, value):
        return str(value)

    convert = helper


class TypedDerived(Base):
    def helper(self, value: int) -> str:
        return str(value)

    convert = helper


class GenericBase[T]:
    def copy(self, value: T) -> T:
        return value


class GenericDerived[T](GenericBase[T]):
    def helper(self, value):
        return value

    copy = helper


def consumers(value: Derived, typed: TypedDerived, base: Base, generic: GenericDerived[str]):
    reveal_type(value.convert, expected_text="(value: int) -> str")
    reveal_type(value.convert(1), expected_text="str")
    reveal_type(typed.convert, expected_text="(value: int) -> str")
    reveal_type(generic.copy("ok"), expected_text="str")

    # These should generate errors because the inherited parameter types are retained.
    value.convert("bad")
    typed.convert("bad")
    base.convert("bad")
    generic.copy(1)
