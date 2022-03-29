def my_cool_function(a: str) -> str:
#   ^^^^^^^^^^^^^^^^ definition  src/single_function 0.1 my_cool_function().
#                    ^ definition  src/single_function 0.1 my_cool_function().(a)
    return a
#          ^ reference  src/single_function 0.1 my_cool_function().(a)

if True:
    my_cool_function("hello")
#   ^^^^^^^^^^^^^^^^ reference  src/single_function 0.1 my_cool_function().

