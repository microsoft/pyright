# This sample tests a nested loop containing an augmented assignment.

count = 0

for x in range(1):
    for y in range(1):
        count += 1

reveal_type(count, expected_text="int")
