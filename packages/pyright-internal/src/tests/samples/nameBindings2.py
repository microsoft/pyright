# This test covers the case where a nonlocal reference
# is made to a symbol that doesn't exist in an outer
# scope but is then assigned to.


class Test:
    def test(self):
        nonlocal missing_symbol
        missing_symbol = 4
