# This sample tests type inference for variables reassigned inside a while
# loop using a list comprehension. This is a regression test for
# https://github.com/microsoft/pyright/issues/11321.

# In this case, `lines` should remain `list[str]` throughout the loop,
# because the list comprehension iterates over `lines[1:]` whose element
# type is `str`.

lines = ["ab", "bc", "ac", "ca"]
reveal_type(lines, expected_text="list[str]")

while lines:
    reveal_type(lines, expected_text="list[str]")
    lines = [item for item in lines[1:]]
