# This sample tests a series of nested loops containing variables
# with significant dependencies.

for val1 in range(10):
    cnt1 = 4
    for val2 in range(10 - val1):
        cnt2 = 4
        if val2 == val1:
            cnt2 -= 1
        for val3 in range(10 - val1 - val2):
            cnt3 = 4
            if val3 == val1:
                cnt3 -= 1
            if val3 == val2:
                cnt3 -= 1
            for val4 in range(10 - val1 - val2 - val3):
                cnt4 = 4
                if val4 == val1:
                    cnt4 -= 1
                if val4 == val2:
                    cnt4 -= 1
                if val4 == val3:
                    cnt4 -= 1
                for val5 in range(10 - val1 - val2 - val3 - val4):
                    cnt5 = 4
                    if val5 == val1:
                        cnt5 -= 1
                    if val5 == val2:
                        cnt5 -= 1
                    if val5 == val3:
                        cnt5 -= 1
                    if val5 == val4:
                        cnt5 -= 1
                    val6 = 10 - val1 - val2 - val3 - val4 - val5
                    cnt6 = 4
                    if val6 == val1:
                        cnt6 -= 1
                    if val6 == val2:
                        cnt6 -= 1
                    if val6 == val3:
                        cnt6 -= 1
                    if val6 == val4:
                        cnt6 -= 1
                    if val6 == val5:
                        cnt6 -= 1
