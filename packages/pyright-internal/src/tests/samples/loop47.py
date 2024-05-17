# This sample tests a case where there are dependencies between
# variables within a loop.

a = None
b = False

for _ in []:
    if b > 0:
        pass
    if a:
        reveal_type(a, expected_text="int")
    c = int(a or 1)
    a = c
    c.is_integer()
