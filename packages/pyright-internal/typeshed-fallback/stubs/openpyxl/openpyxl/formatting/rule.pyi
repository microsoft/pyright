from _typeshed import Incomplete

from openpyxl.descriptors import Float
from openpyxl.descriptors.serialisable import Serialisable

class ValueDescriptor(Float):
    expected_type: Incomplete
    def __set__(self, instance, value) -> None: ...

class FormatObject(Serialisable):
    tagname: str
    type: Incomplete
    val: Incomplete
    gte: Incomplete
    extLst: Incomplete
    __elements__: Incomplete
    def __init__(
        self, type, val: Incomplete | None = None, gte: Incomplete | None = None, extLst: Incomplete | None = None
    ) -> None: ...

class RuleType(Serialisable):  # type: ignore[misc]
    cfvo: Incomplete

class IconSet(RuleType):
    tagname: str
    iconSet: Incomplete
    showValue: Incomplete
    percent: Incomplete
    reverse: Incomplete
    __elements__: Incomplete
    cfvo: Incomplete
    def __init__(
        self,
        iconSet: Incomplete | None = None,
        showValue: Incomplete | None = None,
        percent: Incomplete | None = None,
        reverse: Incomplete | None = None,
        cfvo: Incomplete | None = None,
    ) -> None: ...

class DataBar(RuleType):
    tagname: str
    minLength: Incomplete
    maxLength: Incomplete
    showValue: Incomplete
    color: Incomplete
    __elements__: Incomplete
    cfvo: Incomplete
    def __init__(
        self,
        minLength: Incomplete | None = None,
        maxLength: Incomplete | None = None,
        showValue: Incomplete | None = None,
        cfvo: Incomplete | None = None,
        color: Incomplete | None = None,
    ) -> None: ...

class ColorScale(RuleType):
    tagname: str
    color: Incomplete
    __elements__: Incomplete
    cfvo: Incomplete
    def __init__(self, cfvo: Incomplete | None = None, color: Incomplete | None = None) -> None: ...

class Rule(Serialisable):
    tagname: str
    type: Incomplete
    dxfId: Incomplete
    priority: Incomplete
    stopIfTrue: Incomplete
    aboveAverage: Incomplete
    percent: Incomplete
    bottom: Incomplete
    operator: Incomplete
    text: Incomplete
    timePeriod: Incomplete
    rank: Incomplete
    stdDev: Incomplete
    equalAverage: Incomplete
    formula: Incomplete
    colorScale: Incomplete
    dataBar: Incomplete
    iconSet: Incomplete
    extLst: Incomplete
    dxf: Incomplete
    __elements__: Incomplete
    __attrs__: Incomplete
    def __init__(
        self,
        type,
        dxfId: Incomplete | None = None,
        priority: int = 0,
        stopIfTrue: Incomplete | None = None,
        aboveAverage: Incomplete | None = None,
        percent: Incomplete | None = None,
        bottom: Incomplete | None = None,
        operator: Incomplete | None = None,
        text: Incomplete | None = None,
        timePeriod: Incomplete | None = None,
        rank: Incomplete | None = None,
        stdDev: Incomplete | None = None,
        equalAverage: Incomplete | None = None,
        formula=(),
        colorScale: Incomplete | None = None,
        dataBar: Incomplete | None = None,
        iconSet: Incomplete | None = None,
        extLst: Incomplete | None = None,
        dxf: Incomplete | None = None,
    ) -> None: ...

def ColorScaleRule(
    start_type: Incomplete | None = None,
    start_value: Incomplete | None = None,
    start_color: Incomplete | None = None,
    mid_type: Incomplete | None = None,
    mid_value: Incomplete | None = None,
    mid_color: Incomplete | None = None,
    end_type: Incomplete | None = None,
    end_value: Incomplete | None = None,
    end_color: Incomplete | None = None,
): ...
def FormulaRule(
    formula: Incomplete | None = None,
    stopIfTrue: Incomplete | None = None,
    font: Incomplete | None = None,
    border: Incomplete | None = None,
    fill: Incomplete | None = None,
): ...
def CellIsRule(
    operator: Incomplete | None = None,
    formula: Incomplete | None = None,
    stopIfTrue: Incomplete | None = None,
    font: Incomplete | None = None,
    border: Incomplete | None = None,
    fill: Incomplete | None = None,
): ...
def IconSetRule(
    icon_style: Incomplete | None = None,
    type: Incomplete | None = None,
    values: Incomplete | None = None,
    showValue: Incomplete | None = None,
    percent: Incomplete | None = None,
    reverse: Incomplete | None = None,
): ...
def DataBarRule(
    start_type: Incomplete | None = None,
    start_value: Incomplete | None = None,
    end_type: Incomplete | None = None,
    end_value: Incomplete | None = None,
    color: Incomplete | None = None,
    showValue: Incomplete | None = None,
    minLength: Incomplete | None = None,
    maxLength: Incomplete | None = None,
): ...
