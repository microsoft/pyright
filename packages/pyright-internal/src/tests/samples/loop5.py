# This sample tests a case where a potential type alias
# ("a") is involved in a recursive type dependency
# ("a" depends on "test" which depends on "a").

# pyright: strict


test = {"key": "value"}

while True:
    a = test
    reveal_type(a, expected_text="dict[str, str]")
    test = a.copy()
    reveal_type(test, expected_text="dict[str, str]")
