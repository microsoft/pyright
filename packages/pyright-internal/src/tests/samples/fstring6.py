# This sample tests the parsing and analysis of f-strings with empty {}
# and with a backslash in the format specifier.

msg = "test"
a = f"{}"

message = "hi"
f"{message:\u3000>10}"
