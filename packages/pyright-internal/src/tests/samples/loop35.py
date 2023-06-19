# This sample tests that code flow analysis of a list comprehension
# within a loop eliminates any Unknowns.

# pyright: strict

lst = [1]
while True:
    lst = [val for val in lst]
