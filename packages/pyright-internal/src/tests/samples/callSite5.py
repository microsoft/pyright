# This sample tests receiver binding during call-site return type inference.

from typing import Generic, TypeVar


class Base:
    @property
    def label(self) -> object:
        return ""

    def pick(self, argument):
        if argument:
            return self
        return argument

    def read_label(self, argument):
        if argument:
            return self.label
        return argument

    @classmethod
    def make(cls, argument):
        if argument:
            return cls()
        return argument

    @staticmethod
    def identity(argument):
        return argument


class Derived(Base):
    @property
    def label(self) -> str:
        return "derived"

    def derived_only(self) -> int:
        return 42

    def forwarded(self):
        return self.pick(1)


class Other(Base):
    @property
    def label(self) -> int:
        return 42


class Further(Derived):
    pass


def demonstrate(value: Derived, other: Other):
    selected = value.pick(1)
    reveal_type(selected, expected_text="Derived")
    selected.derived_only()

    reveal_type(other.pick(1), expected_text="Other")
    reveal_type(value.pick(1), expected_text="Derived")
    reveal_type(other.pick(0), expected_text="Other | Literal[0]")
    reveal_type(value.pick(""), expected_text="Derived | Literal['']")
    reveal_type(other.pick(1), expected_text="Other")

    reveal_type(value.read_label(1), expected_text="str")
    reveal_type(other.read_label(1), expected_text="int")
    reveal_type(value.read_label(1), expected_text="str")

    reveal_type(Base.pick(value, 1), expected_text="Derived")
    reveal_type(Base.pick(other, 1), expected_text="Other")
    reveal_type(value.identity(1), expected_text="Unknown")

    # Decorated methods cannot use call-site inference, but the cached
    # inferred return type must still retain its receiver specialization.
    reveal_type(Derived.make(1), expected_text="Derived | Unknown")
    reveal_type(Other.make(1), expected_text="Other | Unknown")
    reveal_type(Derived.make(1), expected_text="Derived | Unknown")
    reveal_type(Further().forwarded(), expected_text="Further")


def unknown_argument(value: Derived, other: Other, argument):
    reveal_type(value.pick(argument), expected_text="Derived | Unknown")
    reveal_type(other.pick(argument), expected_text="Other | Unknown")
    reveal_type(value.pick(argument), expected_text="Derived | Unknown")


def union_receiver(value: Derived | Other):
    # This should generate an error because Other.read_label returns int.
    value.read_label(1).upper()


T = TypeVar("T")


class GenericBase(Generic[T]):
    def __init__(self, value: T):
        self.value = value

    def pick(self, argument):
        if argument:
            return self
        return argument

    def read_value(self, argument):
        if argument:
            return self.value
        return argument


class GenericDerived(GenericBase[T]):
    pass


def generic_receivers(first: GenericDerived[int], second: GenericDerived[str]):
    reveal_type(first.pick(1), expected_text="GenericDerived[int]")
    reveal_type(second.pick(1), expected_text="GenericDerived[str]")
    reveal_type(first.pick(1), expected_text="GenericDerived[int]")
    reveal_type(first.read_value(1), expected_text="int")
    reveal_type(second.read_value(1), expected_text="str")
    reveal_type(first.read_value(1), expected_text="int")


class PowerBase:
    def __pow__(self, exponent):
        if exponent < 0:
            return NotImplemented
        if exponent > 2:
            return exponent
        return self


class PowerDerived(PowerBase):
    pass


def power_receiver(value: PowerDerived):
    reveal_type(value.__pow__(2), expected_text="NotImplementedType | PowerDerived | Literal[2]")
    reveal_type(value ** 2, expected_text="NotImplementedType | Unknown | PowerDerived")


# Speculative overload arguments must not leak between receiver contexts.
class PrinterBase:
    human: bool = True

    def format_code(self, lines):
        raise NotImplementedError

    def print_code(self, content, assign_to=None):
        lines = ["one", "two"]
        if self.human:
            lines = self.format_code(lines)
            result = "\n".join(lines)
        else:
            lines = self.format_code(lines)
            result = (set(), set(), "\n".join(lines))
        return result


class CPrinter(PrinterBase):
    def format_code(self, lines):
        return self.indent_code(lines)

    def indent_code(self, code):
        if isinstance(code, str):
            return "".join(self.indent_code(code.splitlines(True)))
        return [str(line) for line in code]


class PythonPrinter(PrinterBase):
    def format_code(self, lines):
        return lines


def print_c(content, printer_type=CPrinter):
    reveal_type(printer_type().print_code(content), expected_text="str | tuple[set[Unknown], set[Unknown], str]")


def print_python(content):
    reveal_type(PythonPrinter().print_code(content), expected_text="str | tuple[set[Unknown], set[Unknown], str]")
    reveal_type(CPrinter().print_code(content), expected_text="str | tuple[set[Unknown], set[Unknown], str]")
    reveal_type(PythonPrinter().print_code(content), expected_text="str | tuple[set[Unknown], set[Unknown], str]")
