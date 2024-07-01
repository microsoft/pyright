# This sample tests a loop that involves assignment of a tuple
# within a loop.

# pyright: strict

var = 0
while True:
    if var and True:
        break
    else:
        var, _ = var + 1, 0
