# This sample tests type evaluation in a nested loop.

a: int | None = None

for _ in range(1):
    for i in range(1):
        a = i
    j = a

reveal_type(a, expected_type=int | None)
