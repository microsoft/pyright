# This sample tests the specialization of constructors based on
# the expected type specified through either an assignment to
# an annotated variable or by a call where the parameter is
# annotated.

from typing import Generic, TypeVar

T = TypeVar("T", int, str)


class Adder(Generic[T]):
    def add(self, a: T, b: T) -> T:
        return a + b


int_adder: Adder[int] = Adder()
int_adder.add(1, 2)

# This should be an error because "adder"
# should be of type Adder[int].
int_adder.add("1", 2)


def requires_str_adder(str_adder: Adder[str]):
    return str_adder


a = requires_str_adder(Adder())
print(a.add("1", "2"))

# This should be an error because the result
# of the call should be an Adder[str]
print(a.add(1, "2"))


generic_adder = Adder()
generic_adder.add(1, 2)
generic_adder.add("a", "b")

# Since the type has an Unknown type argument,
# the following should not generate an error.
generic_adder.add(1, "b")
