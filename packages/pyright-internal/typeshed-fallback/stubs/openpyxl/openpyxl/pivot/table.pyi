from _typeshed import Incomplete

from openpyxl.descriptors.serialisable import Serialisable

class HierarchyUsage(Serialisable):
    tagname: str
    hierarchyUsage: Incomplete
    def __init__(self, hierarchyUsage: Incomplete | None = None) -> None: ...

class ColHierarchiesUsage(Serialisable):
    tagname: str
    colHierarchyUsage: Incomplete
    __elements__: Incomplete
    __attrs__: Incomplete
    def __init__(self, count: Incomplete | None = None, colHierarchyUsage=()) -> None: ...
    @property
    def count(self): ...

class RowHierarchiesUsage(Serialisable):
    tagname: str
    rowHierarchyUsage: Incomplete
    __elements__: Incomplete
    __attrs__: Incomplete
    def __init__(self, count: Incomplete | None = None, rowHierarchyUsage=()) -> None: ...
    @property
    def count(self): ...

class PivotFilter(Serialisable):
    tagname: str
    fld: Incomplete
    mpFld: Incomplete
    type: Incomplete
    evalOrder: Incomplete
    id: Incomplete
    iMeasureHier: Incomplete
    iMeasureFld: Incomplete
    name: Incomplete
    description: Incomplete
    stringValue1: Incomplete
    stringValue2: Incomplete
    autoFilter: Incomplete
    extLst: Incomplete
    __elements__: Incomplete
    def __init__(
        self,
        fld: Incomplete | None = None,
        mpFld: Incomplete | None = None,
        type: Incomplete | None = None,
        evalOrder: Incomplete | None = None,
        id: Incomplete | None = None,
        iMeasureHier: Incomplete | None = None,
        iMeasureFld: Incomplete | None = None,
        name: Incomplete | None = None,
        description: Incomplete | None = None,
        stringValue1: Incomplete | None = None,
        stringValue2: Incomplete | None = None,
        autoFilter: Incomplete | None = None,
        extLst: Incomplete | None = None,
    ) -> None: ...

class PivotFilters(Serialisable):  # type: ignore[misc]
    count: Incomplete
    filter: Incomplete
    __elements__: Incomplete
    def __init__(self, count: Incomplete | None = None, filter: Incomplete | None = None) -> None: ...

class PivotTableStyle(Serialisable):
    tagname: str
    name: Incomplete
    showRowHeaders: Incomplete
    showColHeaders: Incomplete
    showRowStripes: Incomplete
    showColStripes: Incomplete
    showLastColumn: Incomplete
    def __init__(
        self,
        name: Incomplete | None = None,
        showRowHeaders: Incomplete | None = None,
        showColHeaders: Incomplete | None = None,
        showRowStripes: Incomplete | None = None,
        showColStripes: Incomplete | None = None,
        showLastColumn: Incomplete | None = None,
    ) -> None: ...

class MemberList(Serialisable):
    tagname: str
    level: Incomplete
    member: Incomplete
    __elements__: Incomplete
    def __init__(self, count: Incomplete | None = None, level: Incomplete | None = None, member=()) -> None: ...
    @property
    def count(self): ...

class MemberProperty(Serialisable):
    tagname: str
    name: Incomplete
    showCell: Incomplete
    showTip: Incomplete
    showAsCaption: Incomplete
    nameLen: Incomplete
    pPos: Incomplete
    pLen: Incomplete
    level: Incomplete
    field: Incomplete
    def __init__(
        self,
        name: Incomplete | None = None,
        showCell: Incomplete | None = None,
        showTip: Incomplete | None = None,
        showAsCaption: Incomplete | None = None,
        nameLen: Incomplete | None = None,
        pPos: Incomplete | None = None,
        pLen: Incomplete | None = None,
        level: Incomplete | None = None,
        field: Incomplete | None = None,
    ) -> None: ...

class PivotHierarchy(Serialisable):
    tagname: str
    outline: Incomplete
    multipleItemSelectionAllowed: Incomplete
    subtotalTop: Incomplete
    showInFieldList: Incomplete
    dragToRow: Incomplete
    dragToCol: Incomplete
    dragToPage: Incomplete
    dragToData: Incomplete
    dragOff: Incomplete
    includeNewItemsInFilter: Incomplete
    caption: Incomplete
    mps: Incomplete
    members: Incomplete
    extLst: Incomplete
    __elements__: Incomplete
    def __init__(
        self,
        outline: Incomplete | None = None,
        multipleItemSelectionAllowed: Incomplete | None = None,
        subtotalTop: Incomplete | None = None,
        showInFieldList: Incomplete | None = None,
        dragToRow: Incomplete | None = None,
        dragToCol: Incomplete | None = None,
        dragToPage: Incomplete | None = None,
        dragToData: Incomplete | None = None,
        dragOff: Incomplete | None = None,
        includeNewItemsInFilter: Incomplete | None = None,
        caption: Incomplete | None = None,
        mps=(),
        members: Incomplete | None = None,
        extLst: Incomplete | None = None,
    ) -> None: ...

class Reference(Serialisable):
    tagname: str
    field: Incomplete
    selected: Incomplete
    byPosition: Incomplete
    relative: Incomplete
    defaultSubtotal: Incomplete
    sumSubtotal: Incomplete
    countASubtotal: Incomplete
    avgSubtotal: Incomplete
    maxSubtotal: Incomplete
    minSubtotal: Incomplete
    productSubtotal: Incomplete
    countSubtotal: Incomplete
    stdDevSubtotal: Incomplete
    stdDevPSubtotal: Incomplete
    varSubtotal: Incomplete
    varPSubtotal: Incomplete
    x: Incomplete
    extLst: Incomplete
    __elements__: Incomplete
    def __init__(
        self,
        field: Incomplete | None = None,
        count: Incomplete | None = None,
        selected: Incomplete | None = None,
        byPosition: Incomplete | None = None,
        relative: Incomplete | None = None,
        defaultSubtotal: Incomplete | None = None,
        sumSubtotal: Incomplete | None = None,
        countASubtotal: Incomplete | None = None,
        avgSubtotal: Incomplete | None = None,
        maxSubtotal: Incomplete | None = None,
        minSubtotal: Incomplete | None = None,
        productSubtotal: Incomplete | None = None,
        countSubtotal: Incomplete | None = None,
        stdDevSubtotal: Incomplete | None = None,
        stdDevPSubtotal: Incomplete | None = None,
        varSubtotal: Incomplete | None = None,
        varPSubtotal: Incomplete | None = None,
        x: Incomplete | None = (),
        extLst: Incomplete | None = None,
    ) -> None: ...
    @property
    def count(self): ...

class PivotArea(Serialisable):
    tagname: str
    references: Incomplete
    extLst: Incomplete
    field: Incomplete
    type: Incomplete
    dataOnly: Incomplete
    labelOnly: Incomplete
    grandRow: Incomplete
    grandCol: Incomplete
    cacheIndex: Incomplete
    outline: Incomplete
    offset: Incomplete
    collapsedLevelsAreSubtotals: Incomplete
    axis: Incomplete
    fieldPosition: Incomplete
    __elements__: Incomplete
    def __init__(
        self,
        references=(),
        extLst: Incomplete | None = None,
        field: Incomplete | None = None,
        type: str = "normal",
        dataOnly: bool = True,
        labelOnly: Incomplete | None = None,
        grandRow: Incomplete | None = None,
        grandCol: Incomplete | None = None,
        cacheIndex: Incomplete | None = None,
        outline: bool = True,
        offset: Incomplete | None = None,
        collapsedLevelsAreSubtotals: Incomplete | None = None,
        axis: Incomplete | None = None,
        fieldPosition: Incomplete | None = None,
    ) -> None: ...

class ChartFormat(Serialisable):
    tagname: str
    chart: Incomplete
    format: Incomplete
    series: Incomplete
    pivotArea: Incomplete
    __elements__: Incomplete
    def __init__(
        self,
        chart: Incomplete | None = None,
        format: Incomplete | None = None,
        series: Incomplete | None = None,
        pivotArea: Incomplete | None = None,
    ) -> None: ...

class ConditionalFormat(Serialisable):
    tagname: str
    scope: Incomplete
    type: Incomplete
    priority: Incomplete
    pivotAreas: Incomplete
    extLst: Incomplete
    __elements__: Incomplete
    def __init__(
        self,
        scope: Incomplete | None = "selection",
        type: Incomplete | None = None,
        priority: Incomplete | None = None,
        pivotAreas=(),
        extLst: Incomplete | None = None,
    ) -> None: ...

class Format(Serialisable):
    tagname: str
    action: Incomplete
    dxfId: Incomplete
    pivotArea: Incomplete
    extLst: Incomplete
    __elements__: Incomplete
    def __init__(
        self,
        action: str = "formatting",
        dxfId: Incomplete | None = None,
        pivotArea: Incomplete | None = None,
        extLst: Incomplete | None = None,
    ) -> None: ...

class DataField(Serialisable):
    tagname: str
    name: Incomplete
    fld: Incomplete
    subtotal: Incomplete
    showDataAs: Incomplete
    baseField: Incomplete
    baseItem: Incomplete
    numFmtId: Incomplete
    extLst: Incomplete
    __elements__: Incomplete
    def __init__(
        self,
        name: Incomplete | None = None,
        fld: Incomplete | None = None,
        subtotal: str = "sum",
        showDataAs: str = "normal",
        baseField: int = -1,
        baseItem: int = 1048832,
        numFmtId: Incomplete | None = None,
        extLst: Incomplete | None = None,
    ) -> None: ...

class PageField(Serialisable):
    tagname: str
    fld: Incomplete
    item: Incomplete
    hier: Incomplete
    name: Incomplete
    cap: Incomplete
    extLst: Incomplete
    __elements__: Incomplete
    def __init__(
        self,
        fld: Incomplete | None = None,
        item: Incomplete | None = None,
        hier: Incomplete | None = None,
        name: Incomplete | None = None,
        cap: Incomplete | None = None,
        extLst: Incomplete | None = None,
    ) -> None: ...

class RowColItem(Serialisable):
    tagname: str
    t: Incomplete
    r: Incomplete
    i: Incomplete
    x: Incomplete
    __elements__: Incomplete
    def __init__(self, t: str = "data", r: int = 0, i: int = 0, x=()) -> None: ...

class RowColField(Serialisable):
    tagname: str
    x: Incomplete
    def __init__(self, x: Incomplete | None = None) -> None: ...

class AutoSortScope(Serialisable):  # type: ignore[misc]
    pivotArea: Incomplete
    __elements__: Incomplete
    def __init__(self, pivotArea: Incomplete | None = None) -> None: ...

class FieldItem(Serialisable):
    tagname: str
    n: Incomplete
    t: Incomplete
    h: Incomplete
    s: Incomplete
    sd: Incomplete
    f: Incomplete
    m: Incomplete
    c: Incomplete
    x: Incomplete
    d: Incomplete
    e: Incomplete
    def __init__(
        self,
        n: Incomplete | None = None,
        t: str = "data",
        h: Incomplete | None = None,
        s: Incomplete | None = None,
        sd: bool = True,
        f: Incomplete | None = None,
        m: Incomplete | None = None,
        c: Incomplete | None = None,
        x: Incomplete | None = None,
        d: Incomplete | None = None,
        e: Incomplete | None = None,
    ) -> None: ...

class PivotField(Serialisable):
    tagname: str
    items: Incomplete
    autoSortScope: Incomplete
    extLst: Incomplete
    name: Incomplete
    axis: Incomplete
    dataField: Incomplete
    subtotalCaption: Incomplete
    showDropDowns: Incomplete
    hiddenLevel: Incomplete
    uniqueMemberProperty: Incomplete
    compact: Incomplete
    allDrilled: Incomplete
    numFmtId: Incomplete
    outline: Incomplete
    subtotalTop: Incomplete
    dragToRow: Incomplete
    dragToCol: Incomplete
    multipleItemSelectionAllowed: Incomplete
    dragToPage: Incomplete
    dragToData: Incomplete
    dragOff: Incomplete
    showAll: Incomplete
    insertBlankRow: Incomplete
    serverField: Incomplete
    insertPageBreak: Incomplete
    autoShow: Incomplete
    topAutoShow: Incomplete
    hideNewItems: Incomplete
    measureFilter: Incomplete
    includeNewItemsInFilter: Incomplete
    itemPageCount: Incomplete
    sortType: Incomplete
    dataSourceSort: Incomplete
    nonAutoSortDefault: Incomplete
    rankBy: Incomplete
    defaultSubtotal: Incomplete
    sumSubtotal: Incomplete
    countASubtotal: Incomplete
    avgSubtotal: Incomplete
    maxSubtotal: Incomplete
    minSubtotal: Incomplete
    productSubtotal: Incomplete
    countSubtotal: Incomplete
    stdDevSubtotal: Incomplete
    stdDevPSubtotal: Incomplete
    varSubtotal: Incomplete
    varPSubtotal: Incomplete
    showPropCell: Incomplete
    showPropTip: Incomplete
    showPropAsCaption: Incomplete
    defaultAttributeDrillState: Incomplete
    __elements__: Incomplete
    def __init__(
        self,
        items=(),
        autoSortScope: Incomplete | None = None,
        name: Incomplete | None = None,
        axis: Incomplete | None = None,
        dataField: Incomplete | None = None,
        subtotalCaption: Incomplete | None = None,
        showDropDowns: bool = True,
        hiddenLevel: Incomplete | None = None,
        uniqueMemberProperty: Incomplete | None = None,
        compact: bool = True,
        allDrilled: Incomplete | None = None,
        numFmtId: Incomplete | None = None,
        outline: bool = True,
        subtotalTop: bool = True,
        dragToRow: bool = True,
        dragToCol: bool = True,
        multipleItemSelectionAllowed: Incomplete | None = None,
        dragToPage: bool = True,
        dragToData: bool = True,
        dragOff: bool = True,
        showAll: bool = True,
        insertBlankRow: Incomplete | None = None,
        serverField: Incomplete | None = None,
        insertPageBreak: Incomplete | None = None,
        autoShow: Incomplete | None = None,
        topAutoShow: bool = True,
        hideNewItems: Incomplete | None = None,
        measureFilter: Incomplete | None = None,
        includeNewItemsInFilter: Incomplete | None = None,
        itemPageCount: int = 10,
        sortType: str = "manual",
        dataSourceSort: Incomplete | None = None,
        nonAutoSortDefault: Incomplete | None = None,
        rankBy: Incomplete | None = None,
        defaultSubtotal: bool = True,
        sumSubtotal: Incomplete | None = None,
        countASubtotal: Incomplete | None = None,
        avgSubtotal: Incomplete | None = None,
        maxSubtotal: Incomplete | None = None,
        minSubtotal: Incomplete | None = None,
        productSubtotal: Incomplete | None = None,
        countSubtotal: Incomplete | None = None,
        stdDevSubtotal: Incomplete | None = None,
        stdDevPSubtotal: Incomplete | None = None,
        varSubtotal: Incomplete | None = None,
        varPSubtotal: Incomplete | None = None,
        showPropCell: Incomplete | None = None,
        showPropTip: Incomplete | None = None,
        showPropAsCaption: Incomplete | None = None,
        defaultAttributeDrillState: Incomplete | None = None,
        extLst: Incomplete | None = None,
    ) -> None: ...

class Location(Serialisable):
    tagname: str
    ref: Incomplete
    firstHeaderRow: Incomplete
    firstDataRow: Incomplete
    firstDataCol: Incomplete
    rowPageCount: Incomplete
    colPageCount: Incomplete
    def __init__(
        self,
        ref: Incomplete | None = None,
        firstHeaderRow: Incomplete | None = None,
        firstDataRow: Incomplete | None = None,
        firstDataCol: Incomplete | None = None,
        rowPageCount: Incomplete | None = None,
        colPageCount: Incomplete | None = None,
    ) -> None: ...

class TableDefinition(Serialisable):
    mime_type: str
    rel_type: str
    tagname: str
    cache: Incomplete
    name: Incomplete
    cacheId: Incomplete
    dataOnRows: Incomplete
    dataPosition: Incomplete
    dataCaption: Incomplete
    grandTotalCaption: Incomplete
    errorCaption: Incomplete
    showError: Incomplete
    missingCaption: Incomplete
    showMissing: Incomplete
    pageStyle: Incomplete
    pivotTableStyle: Incomplete
    vacatedStyle: Incomplete
    tag: Incomplete
    updatedVersion: Incomplete
    minRefreshableVersion: Incomplete
    asteriskTotals: Incomplete
    showItems: Incomplete
    editData: Incomplete
    disableFieldList: Incomplete
    showCalcMbrs: Incomplete
    visualTotals: Incomplete
    showMultipleLabel: Incomplete
    showDataDropDown: Incomplete
    showDrill: Incomplete
    printDrill: Incomplete
    showMemberPropertyTips: Incomplete
    showDataTips: Incomplete
    enableWizard: Incomplete
    enableDrill: Incomplete
    enableFieldProperties: Incomplete
    preserveFormatting: Incomplete
    useAutoFormatting: Incomplete
    pageWrap: Incomplete
    pageOverThenDown: Incomplete
    subtotalHiddenItems: Incomplete
    rowGrandTotals: Incomplete
    colGrandTotals: Incomplete
    fieldPrintTitles: Incomplete
    itemPrintTitles: Incomplete
    mergeItem: Incomplete
    showDropZones: Incomplete
    createdVersion: Incomplete
    indent: Incomplete
    showEmptyRow: Incomplete
    showEmptyCol: Incomplete
    showHeaders: Incomplete
    compact: Incomplete
    outline: Incomplete
    outlineData: Incomplete
    compactData: Incomplete
    published: Incomplete
    gridDropZones: Incomplete
    immersive: Incomplete
    multipleFieldFilters: Incomplete
    chartFormat: Incomplete
    rowHeaderCaption: Incomplete
    colHeaderCaption: Incomplete
    fieldListSortAscending: Incomplete
    mdxSubqueries: Incomplete
    customListSort: Incomplete
    autoFormatId: Incomplete
    applyNumberFormats: Incomplete
    applyBorderFormats: Incomplete
    applyFontFormats: Incomplete
    applyPatternFormats: Incomplete
    applyAlignmentFormats: Incomplete
    applyWidthHeightFormats: Incomplete
    location: Incomplete
    pivotFields: Incomplete
    rowFields: Incomplete
    rowItems: Incomplete
    colFields: Incomplete
    colItems: Incomplete
    pageFields: Incomplete
    dataFields: Incomplete
    formats: Incomplete
    conditionalFormats: Incomplete
    chartFormats: Incomplete
    pivotHierarchies: Incomplete
    pivotTableStyleInfo: Incomplete
    filters: Incomplete
    rowHierarchiesUsage: Incomplete
    colHierarchiesUsage: Incomplete
    extLst: Incomplete
    id: Incomplete
    __elements__: Incomplete
    def __init__(
        self,
        name: Incomplete | None = None,
        cacheId: Incomplete | None = None,
        dataOnRows: bool = False,
        dataPosition: Incomplete | None = None,
        dataCaption: Incomplete | None = None,
        grandTotalCaption: Incomplete | None = None,
        errorCaption: Incomplete | None = None,
        showError: bool = False,
        missingCaption: Incomplete | None = None,
        showMissing: bool = True,
        pageStyle: Incomplete | None = None,
        pivotTableStyle: Incomplete | None = None,
        vacatedStyle: Incomplete | None = None,
        tag: Incomplete | None = None,
        updatedVersion: int = 0,
        minRefreshableVersion: int = 0,
        asteriskTotals: bool = False,
        showItems: bool = True,
        editData: bool = False,
        disableFieldList: bool = False,
        showCalcMbrs: bool = True,
        visualTotals: bool = True,
        showMultipleLabel: bool = True,
        showDataDropDown: bool = True,
        showDrill: bool = True,
        printDrill: bool = False,
        showMemberPropertyTips: bool = True,
        showDataTips: bool = True,
        enableWizard: bool = True,
        enableDrill: bool = True,
        enableFieldProperties: bool = True,
        preserveFormatting: bool = True,
        useAutoFormatting: bool = False,
        pageWrap: int = 0,
        pageOverThenDown: bool = False,
        subtotalHiddenItems: bool = False,
        rowGrandTotals: bool = True,
        colGrandTotals: bool = True,
        fieldPrintTitles: bool = False,
        itemPrintTitles: bool = False,
        mergeItem: bool = False,
        showDropZones: bool = True,
        createdVersion: int = 0,
        indent: int = 1,
        showEmptyRow: bool = False,
        showEmptyCol: bool = False,
        showHeaders: bool = True,
        compact: bool = True,
        outline: bool = False,
        outlineData: bool = False,
        compactData: bool = True,
        published: bool = False,
        gridDropZones: bool = False,
        immersive: bool = True,
        multipleFieldFilters: Incomplete | None = None,
        chartFormat: int = 0,
        rowHeaderCaption: Incomplete | None = None,
        colHeaderCaption: Incomplete | None = None,
        fieldListSortAscending: Incomplete | None = None,
        mdxSubqueries: Incomplete | None = None,
        customListSort: Incomplete | None = None,
        autoFormatId: Incomplete | None = None,
        applyNumberFormats: bool = False,
        applyBorderFormats: bool = False,
        applyFontFormats: bool = False,
        applyPatternFormats: bool = False,
        applyAlignmentFormats: bool = False,
        applyWidthHeightFormats: bool = False,
        location: Incomplete | None = None,
        pivotFields=(),
        rowFields=(),
        rowItems=(),
        colFields=(),
        colItems=(),
        pageFields=(),
        dataFields=(),
        formats=(),
        conditionalFormats=None,
        chartFormats=(),
        pivotHierarchies=(),
        pivotTableStyleInfo: Incomplete | None = None,
        filters=(),
        rowHierarchiesUsage: Incomplete | None = None,
        colHierarchiesUsage: Incomplete | None = None,
        extLst: Incomplete | None = None,
        id: Incomplete | None = None,
    ) -> None: ...
    def to_tree(self): ...
    @property
    def path(self): ...
