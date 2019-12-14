# This tests f-strings with format expressions.

# pyright: strict

def return_right_aligned_string():
    some_length = 10
    some_string = "some string to print"

    string_right_aligned = f"{some_length:>{some_string}}"
    return string_right_aligned

