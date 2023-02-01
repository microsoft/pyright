# This sample tests the case where an assignment expression
# is used within a looping construct such that the assigned
# value is initially unknown.

# pyright: strict

from typing import Iterator

for _ in ["1"]:
    old_lines: Iterator[str] = iter(["2", "3"])

    try:
        while True:
            line = next(old_lines)
            count = 1
            if count:
                while True:
                    if not (line := next(old_lines)):
                        pass
                    elif line.startswith(""):
                        print(line.removeprefix(""))
                    else:
                        old_lines = iter([line] + list(old_lines))
                        break

    except StopIteration:
        pass
