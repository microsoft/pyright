# This sample tests string concatenation.

v1 = "a" "b" r"c" R"""d""" "e" "f"
reveal_type(v1, expected_text="Literal['abcdef']")

v2 = b"a" b"b" rb"c" Rb"d"
reveal_type(v2, expected_text='Literal[b"abcd"]')

# This should generate an error.
v3 = "a" b"b"

# This should generate an error.
v4 = b"a" f""

# This should generate a warning.
v5 = b"\u00FF"
