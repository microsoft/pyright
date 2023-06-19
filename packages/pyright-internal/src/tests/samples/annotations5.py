# This sample tests the handling of tuple expressions within a subscript
# when used with type annotations.

a1: dict[(str, str)] = {"hi": "there"}

# This should generate an error because there are too many type arguments.
a2: dict[(str, str, str)] = {"hi": "there"}

b1: list[(int,)] = [3, 4, 5]
