def my_cool_function(a: str) -> str:
#   ^^^^^^^^^^^^^^^^ definition  snapshot-util 0.1 `src.single_function`/my_cool_function().
#                    ^ definition  snapshot-util 0.1 `src.single_function`/my_cool_function().(a)
#                       ^^^ reference  python-stdlib 3.10 builtins/str#
#                               ^^^ reference  python-stdlib 3.10 builtins/str#
    x = ", world"
#   ^ definition local 0
    return a + x
#          ^ reference  snapshot-util 0.1 `src.single_function`/my_cool_function().(a)
#              ^ reference local 0

def my_cool_function_2(a: str):
#   ^^^^^^^^^^^^^^^^^^ definition  snapshot-util 0.1 `src.single_function`/my_cool_function_2().
#                      ^ definition  snapshot-util 0.1 `src.single_function`/my_cool_function_2().(a)
#                         ^^^ reference  python-stdlib 3.10 builtins/str#
    x = ", world"
#   ^ definition local 1
    return (lambda y: a + x + y)("oh no")
#                  ^ definition local 2(y)
#                     ^ reference  snapshot-util 0.1 `src.single_function`/my_cool_function_2().(a)
#                         ^ reference local 1
#                             ^ reference local 2(y)

def next_level():
#   ^^^^^^^^^^ definition  snapshot-util 0.1 `src.single_function`/next_level().
    return my_cool_function
#          ^^^^^^^^^^^^^^^^ reference  snapshot-util 0.1 `src.single_function`/my_cool_function().

my_cool_function("hello")
#^^^^^^^^^^^^^^^ reference  snapshot-util 0.1 `src.single_function`/my_cool_function().
next_level()(a = "wow")
#^^^^^^^^^ reference  snapshot-util 0.1 `src.single_function`/next_level().
#            ^ reference  snapshot-util 0.1 `src.single_function`/my_cool_function().(a)

