# This sample covers a case that resulted in a crash due to infinite
# recursion within the code flow engine and type narrowing logic.


def func():
    c = None

    while True:
        if a:  # type: ignore
            if c:
                pass

        a = c == c.foo
