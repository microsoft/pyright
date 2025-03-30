# This sample tests type checking support for "Literal"

from typing import Literal

ValidResponses = Literal["a", b"b", Literal["cc", True, None]]


def foo(a: ValidResponses):
    pass


foo("a")
foo(b"b")
foo("cc")
foo(True)
foo(None)

# This should generate an error because 'b'
# isn't a valid literal value.
foo("b")

# This should generate an error because 'cc'
# isn't a valid literal value.
foo("c")

# This should generate an error because False
# isn't a valid literal value.
foo(False)

# This should generate an error because 3
# isn't a valid literal value.
foo(3)


# This should generate an error because floats
# cannot be used as literals.
invalidType = 3  # type: Literal[3.4]

# This should generate an error because 2
# is not a valid literal value.
mismatch = 2  # type: Literal[3, 4, '5']

a: Literal[+3] = -(-(+++3))
b: Literal[-2] = +-+2

# This should generate an error because literals are
# not instantiable.
c = Literal[1]()


bytes1 = b"\x7f"
reveal_type(bytes1, expected_text='Literal[b"\\x7f"]')
bytes2 = b"\x20"
reveal_type(bytes2, expected_text='Literal[b" "]')
bytes3 = b'"'
reveal_type(bytes3, expected_text='Literal[b"\\""]')
bytes4 = b"'"
reveal_type(bytes4, expected_text='Literal[b"\'"]')


t1 = [Literal[1], Literal[2]]
reveal_type(t1, expected_text="list[type[Literal]]")

t2 = Literal[*(1, 2)]
reveal_type(t2, expected_text="Literal")

values = ("a", "b", "c")
t3 = Literal[values]
reveal_type(t3, expected_text="Literal")
