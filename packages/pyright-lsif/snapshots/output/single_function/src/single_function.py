def my_cool_function(a: str) -> str:
#   ^^^^^^^^^^^^^^^^ definition  src/single_function test my_cool_function().
#                    ^ definition  src/single_function test my_cool_function().(a)
#                       ^^^ reference  builtins 3.9 str#
#                               ^^^ reference  builtins 3.9 str#
    return a
#          ^ reference  src/single_function test my_cool_function().(a)

if True:
    my_cool_function("hello")
#   ^^^^^^^^^^^^^^^^ reference  src/single_function test my_cool_function().

