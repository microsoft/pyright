# This tests f-strings with format expressions.

# pyright: strict


def return_right_aligned_string():
    some_length = 10
    some_length2 = 2
    some_string = "some string to print"

    string_right_aligned = f"{some_string:>{some_length - 2} {some_length2: 3}}"
    return string_right_aligned
