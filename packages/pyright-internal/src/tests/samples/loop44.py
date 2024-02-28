# This sample tests the case where a variable assigned within a loop
# initially appears to be unreachable (while some variable types are
# incomplete) but is later determined to be reachable.


def func(lines: list[str], val: list[str] | None):
    for line in lines:
        if val is None:
            if line == "":
                val = []
            continue
        match = line
        match.encode()
