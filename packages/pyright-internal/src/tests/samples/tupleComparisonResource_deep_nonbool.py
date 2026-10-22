from typing import Literal, assert_type, reveal_type
reveal_type(0)
class Value:
    def __lt__(self, other: object) -> str: return "text"
type D0 = tuple[Value]
type D1 = tuple[D0, D0]
type D2 = tuple[D1, D1]
type D3 = tuple[D2, D2]
type D4 = tuple[D3, D3]
type D5 = tuple[D4, D4]
type D6 = tuple[D5, D5]
type D7 = tuple[D6, D6]
type D8 = tuple[D7, D7]
type D9 = tuple[D8, D8]
type D10 = tuple[D9, D9]
type D11 = tuple[D10, D10]
type D12 = tuple[D11, D11]
type D13 = tuple[D12, D12]
type D14 = tuple[D13, D13]
type D15 = tuple[D14, D14]
type D16 = tuple[D15, D15]
type D17 = tuple[D16, D16]
type D18 = tuple[D17, D17]
type D19 = tuple[D18, D18]
type D20 = tuple[D19, D19]
type D21 = tuple[D20, D20]
type D22 = tuple[D21, D21]
type D23 = tuple[D22, D22]
type D24 = tuple[D23, D23]
type D25 = tuple[D24, D24]
type D26 = tuple[D25, D25]
type D27 = tuple[D26, D26]
type D28 = tuple[D27, D27]
type D29 = tuple[D28, D28]
type D30 = tuple[D29, D29]
type D31 = tuple[D30, D30]
type D32 = tuple[D31, D31]
def compare(left: D32, right: D32) -> str | bool:
    result = left < right
    assert_type(result, str | bool)
    return result
