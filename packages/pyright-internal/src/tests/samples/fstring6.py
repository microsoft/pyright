# This sample tests the parsing and analysis of f-strings with empty {},
# with a backslash in the format specifier, and with a colon in a format
# specifier expression.

msg = "test"
a = f"{}"

message = "hi"
f"{message:\u3000>10}"


x = 0
precision = 3
print(f"{x: .{precision:d}f}")
