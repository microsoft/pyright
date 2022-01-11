def my_cool_function(a: str) -> str:
#   ^^^^^^^^^^^^^^^^ definition lsif-pyright pypi src.single_function 0.0 my_cool_function().
#                    ^ definition lsif-pyright pypi src.single_function 0.0 my_cool_function().(a)
#                       ^^^ reference lsif-pyright pypi python 3.9 str.
#                               ^^^ reference lsif-pyright pypi python 3.9 str.
    return a
#          ^ reference lsif-pyright pypi src.single_function 0.0 my_cool_function().(a)

if True:
    my_cool_function("hello")
#   ^^^^^^^^^^^^^^^^ reference lsif-pyright pypi src.single_function 0.0 my_cool_function().

