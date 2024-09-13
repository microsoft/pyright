# This sample tests a doubly-nested loop that was incorrectly evaluated.

a = b = c = 0

while True:
    if a < 0:
        c += b - 1
        a = b

    while a != (d := a + 1):
        b = max(b, d)
        c += abs(a - d)
        a = d
