# This sample tests the special-case logic for the "tuple"
# constructor. Rather than generating type "tuple[T]" as
# would be expected from the constructor, we actually
# generate "tuple[T, ...]".

# pyright: strict

str_list = ["1", "2", "3"]
left, right = tuple(str_list)

check1: tuple[str, str] = (left, right)

# This should generate an error
check2: tuple[str, int] = (left, right)
