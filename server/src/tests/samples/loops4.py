# This sample tests a loop with self-references.

a = False
x = 0

while True:
    x += 43
    if a:
        print("")
    x += 44
