from _typeshed import Incomplete

from openpyxl.descriptors.serialisable import Serialisable

class MeasureDimensionMap(Serialisable):
    tagname: str
    measureGroup: Incomplete
    dimension: Incomplete
    def __init__(self, measureGroup: Incomplete | None = None, dimension: Incomplete | None = None) -> None: ...

class MeasureGroup(Serialisable):
    tagname: str
    name: Incomplete
    caption: Incomplete
    def __init__(self, name: Incomplete | None = None, caption: Incomplete | None = None) -> None: ...

class PivotDimension(Serialisable):
    tagname: str
    measure: Incomplete
    name: Incomplete
    uniqueName: Incomplete
    caption: Incomplete
    def __init__(
        self,
        measure: Incomplete | None = None,
        name: Incomplete | None = None,
        uniqueName: Incomplete | None = None,
        caption: Incomplete | None = None,
    ) -> None: ...

class CalculatedMember(Serialisable):
    tagname: str
    name: Incomplete
    mdx: Incomplete
    memberName: Incomplete
    hierarchy: Incomplete
    parent: Incomplete
    solveOrder: Incomplete
    set: Incomplete
    extLst: Incomplete
    __elements__: Incomplete
    def __init__(
        self,
        name: Incomplete | None = None,
        mdx: Incomplete | None = None,
        memberName: Incomplete | None = None,
        hierarchy: Incomplete | None = None,
        parent: Incomplete | None = None,
        solveOrder: Incomplete | None = None,
        set: Incomplete | None = None,
        extLst: Incomplete | None = None,
    ) -> None: ...

class CalculatedItem(Serialisable):
    tagname: str
    field: Incomplete
    formula: Incomplete
    pivotArea: Incomplete
    extLst: Incomplete
    __elements__: Incomplete
    def __init__(
        self,
        field: Incomplete | None = None,
        formula: Incomplete | None = None,
        pivotArea: Incomplete | None = None,
        extLst: Incomplete | None = None,
    ) -> None: ...

class ServerFormat(Serialisable):
    tagname: str
    culture: Incomplete
    format: Incomplete
    def __init__(self, culture: Incomplete | None = None, format: Incomplete | None = None) -> None: ...

class ServerFormatList(Serialisable):
    tagname: str
    serverFormat: Incomplete
    __elements__: Incomplete
    __attrs__: Incomplete
    def __init__(self, count: Incomplete | None = None, serverFormat: Incomplete | None = None) -> None: ...
    @property
    def count(self): ...

class Query(Serialisable):
    tagname: str
    mdx: Incomplete
    tpls: Incomplete
    __elements__: Incomplete
    def __init__(self, mdx: Incomplete | None = None, tpls: Incomplete | None = None) -> None: ...

class QueryCache(Serialisable):
    tagname: str
    count: Incomplete
    query: Incomplete
    __elements__: Incomplete
    def __init__(self, count: Incomplete | None = None, query: Incomplete | None = None) -> None: ...

class OLAPSet(Serialisable):
    tagname: str
    count: Incomplete
    maxRank: Incomplete
    setDefinition: Incomplete
    sortType: Incomplete
    queryFailed: Incomplete
    tpls: Incomplete
    sortByTuple: Incomplete
    __elements__: Incomplete
    def __init__(
        self,
        count: Incomplete | None = None,
        maxRank: Incomplete | None = None,
        setDefinition: Incomplete | None = None,
        sortType: Incomplete | None = None,
        queryFailed: Incomplete | None = None,
        tpls: Incomplete | None = None,
        sortByTuple: Incomplete | None = None,
    ) -> None: ...

class OLAPSets(Serialisable):  # type: ignore[misc]
    count: Incomplete
    set: Incomplete
    __elements__: Incomplete
    def __init__(self, count: Incomplete | None = None, set: Incomplete | None = None) -> None: ...

class PCDSDTCEntries(Serialisable):
    tagname: str
    count: Incomplete
    m: Incomplete
    n: Incomplete
    e: Incomplete
    s: Incomplete
    __elements__: Incomplete
    def __init__(
        self,
        count: Incomplete | None = None,
        m: Incomplete | None = None,
        n: Incomplete | None = None,
        e: Incomplete | None = None,
        s: Incomplete | None = None,
    ) -> None: ...

class TupleCache(Serialisable):
    tagname: str
    entries: Incomplete
    sets: Incomplete
    queryCache: Incomplete
    serverFormats: Incomplete
    extLst: Incomplete
    __elements__: Incomplete
    def __init__(
        self,
        entries: Incomplete | None = None,
        sets: Incomplete | None = None,
        queryCache: Incomplete | None = None,
        serverFormats: Incomplete | None = None,
        extLst: Incomplete | None = None,
    ) -> None: ...

class PCDKPI(Serialisable):
    tagname: str
    uniqueName: Incomplete
    caption: Incomplete
    displayFolder: Incomplete
    measureGroup: Incomplete
    parent: Incomplete
    value: Incomplete
    goal: Incomplete
    status: Incomplete
    trend: Incomplete
    weight: Incomplete
    time: Incomplete
    def __init__(
        self,
        uniqueName: Incomplete | None = None,
        caption: Incomplete | None = None,
        displayFolder: Incomplete | None = None,
        measureGroup: Incomplete | None = None,
        parent: Incomplete | None = None,
        value: Incomplete | None = None,
        goal: Incomplete | None = None,
        status: Incomplete | None = None,
        trend: Incomplete | None = None,
        weight: Incomplete | None = None,
        time: Incomplete | None = None,
    ) -> None: ...

class GroupMember(Serialisable):
    tagname: str
    uniqueName: Incomplete
    group: Incomplete
    def __init__(self, uniqueName: Incomplete | None = None, group: Incomplete | None = None) -> None: ...

class GroupMembers(Serialisable):  # type: ignore[misc]
    count: Incomplete
    groupMember: Incomplete
    __elements__: Incomplete
    def __init__(self, count: Incomplete | None = None, groupMember: Incomplete | None = None) -> None: ...

class LevelGroup(Serialisable):
    tagname: str
    name: Incomplete
    uniqueName: Incomplete
    caption: Incomplete
    uniqueParent: Incomplete
    id: Incomplete
    groupMembers: Incomplete
    __elements__: Incomplete
    def __init__(
        self,
        name: Incomplete | None = None,
        uniqueName: Incomplete | None = None,
        caption: Incomplete | None = None,
        uniqueParent: Incomplete | None = None,
        id: Incomplete | None = None,
        groupMembers: Incomplete | None = None,
    ) -> None: ...

class Groups(Serialisable):
    tagname: str
    count: Incomplete
    group: Incomplete
    __elements__: Incomplete
    def __init__(self, count: Incomplete | None = None, group: Incomplete | None = None) -> None: ...

class GroupLevel(Serialisable):
    tagname: str
    uniqueName: Incomplete
    caption: Incomplete
    user: Incomplete
    customRollUp: Incomplete
    groups: Incomplete
    extLst: Incomplete
    __elements__: Incomplete
    def __init__(
        self,
        uniqueName: Incomplete | None = None,
        caption: Incomplete | None = None,
        user: Incomplete | None = None,
        customRollUp: Incomplete | None = None,
        groups: Incomplete | None = None,
        extLst: Incomplete | None = None,
    ) -> None: ...

class GroupLevels(Serialisable):  # type: ignore[misc]
    count: Incomplete
    groupLevel: Incomplete
    __elements__: Incomplete
    def __init__(self, count: Incomplete | None = None, groupLevel: Incomplete | None = None) -> None: ...

class FieldUsage(Serialisable):
    tagname: str
    x: Incomplete
    def __init__(self, x: Incomplete | None = None) -> None: ...

class FieldsUsage(Serialisable):  # type: ignore[misc]
    count: Incomplete
    fieldUsage: Incomplete
    __elements__: Incomplete
    def __init__(self, count: Incomplete | None = None, fieldUsage: Incomplete | None = None) -> None: ...

class CacheHierarchy(Serialisable):
    tagname: str
    uniqueName: Incomplete
    caption: Incomplete
    measure: Incomplete
    set: Incomplete
    parentSet: Incomplete
    iconSet: Incomplete
    attribute: Incomplete
    time: Incomplete
    keyAttribute: Incomplete
    defaultMemberUniqueName: Incomplete
    allUniqueName: Incomplete
    allCaption: Incomplete
    dimensionUniqueName: Incomplete
    displayFolder: Incomplete
    measureGroup: Incomplete
    measures: Incomplete
    count: Incomplete
    oneField: Incomplete
    memberValueDatatype: Incomplete
    unbalanced: Incomplete
    unbalancedGroup: Incomplete
    hidden: Incomplete
    fieldsUsage: Incomplete
    groupLevels: Incomplete
    extLst: Incomplete
    __elements__: Incomplete
    def __init__(
        self,
        uniqueName: str = "",
        caption: Incomplete | None = None,
        measure: Incomplete | None = None,
        set: Incomplete | None = None,
        parentSet: Incomplete | None = None,
        iconSet: int = 0,
        attribute: Incomplete | None = None,
        time: Incomplete | None = None,
        keyAttribute: Incomplete | None = None,
        defaultMemberUniqueName: Incomplete | None = None,
        allUniqueName: Incomplete | None = None,
        allCaption: Incomplete | None = None,
        dimensionUniqueName: Incomplete | None = None,
        displayFolder: Incomplete | None = None,
        measureGroup: Incomplete | None = None,
        measures: Incomplete | None = None,
        count: Incomplete | None = None,
        oneField: Incomplete | None = None,
        memberValueDatatype: Incomplete | None = None,
        unbalanced: Incomplete | None = None,
        unbalancedGroup: Incomplete | None = None,
        hidden: Incomplete | None = None,
        fieldsUsage: Incomplete | None = None,
        groupLevels: Incomplete | None = None,
        extLst: Incomplete | None = None,
    ) -> None: ...

class GroupItems(Serialisable):
    tagname: str
    m: Incomplete
    n: Incomplete
    b: Incomplete
    e: Incomplete
    s: Incomplete
    d: Incomplete
    __elements__: Incomplete
    __attrs__: Incomplete
    def __init__(self, count: Incomplete | None = None, m=(), n=(), b=(), e=(), s=(), d=()) -> None: ...
    @property
    def count(self): ...

class DiscretePr(Serialisable):
    tagname: str
    count: Incomplete
    x: Incomplete
    __elements__: Incomplete
    def __init__(self, count: Incomplete | None = None, x: Incomplete | None = None) -> None: ...

class RangePr(Serialisable):
    tagname: str
    autoStart: Incomplete
    autoEnd: Incomplete
    groupBy: Incomplete
    startNum: Incomplete
    endNum: Incomplete
    startDate: Incomplete
    endDate: Incomplete
    groupInterval: Incomplete
    def __init__(
        self,
        autoStart: bool = True,
        autoEnd: bool = True,
        groupBy: str = "range",
        startNum: Incomplete | None = None,
        endNum: Incomplete | None = None,
        startDate: Incomplete | None = None,
        endDate: Incomplete | None = None,
        groupInterval: int = 1,
    ) -> None: ...

class FieldGroup(Serialisable):
    tagname: str
    par: Incomplete
    base: Incomplete
    rangePr: Incomplete
    discretePr: Incomplete
    groupItems: Incomplete
    __elements__: Incomplete
    def __init__(
        self,
        par: Incomplete | None = None,
        base: Incomplete | None = None,
        rangePr: Incomplete | None = None,
        discretePr: Incomplete | None = None,
        groupItems: Incomplete | None = None,
    ) -> None: ...

class SharedItems(Serialisable):
    tagname: str
    m: Incomplete
    n: Incomplete
    b: Incomplete
    e: Incomplete
    s: Incomplete
    d: Incomplete
    containsSemiMixedTypes: Incomplete
    containsNonDate: Incomplete
    containsDate: Incomplete
    containsString: Incomplete
    containsBlank: Incomplete
    containsMixedTypes: Incomplete
    containsNumber: Incomplete
    containsInteger: Incomplete
    minValue: Incomplete
    maxValue: Incomplete
    minDate: Incomplete
    maxDate: Incomplete
    longText: Incomplete
    __attrs__: Incomplete
    def __init__(
        self,
        _fields=(),
        containsSemiMixedTypes: Incomplete | None = None,
        containsNonDate: Incomplete | None = None,
        containsDate: Incomplete | None = None,
        containsString: Incomplete | None = None,
        containsBlank: Incomplete | None = None,
        containsMixedTypes: Incomplete | None = None,
        containsNumber: Incomplete | None = None,
        containsInteger: Incomplete | None = None,
        minValue: Incomplete | None = None,
        maxValue: Incomplete | None = None,
        minDate: Incomplete | None = None,
        maxDate: Incomplete | None = None,
        count: Incomplete | None = None,
        longText: Incomplete | None = None,
    ) -> None: ...
    @property
    def count(self): ...

class CacheField(Serialisable):
    tagname: str
    sharedItems: Incomplete
    fieldGroup: Incomplete
    mpMap: Incomplete
    extLst: Incomplete
    name: Incomplete
    caption: Incomplete
    propertyName: Incomplete
    serverField: Incomplete
    uniqueList: Incomplete
    numFmtId: Incomplete
    formula: Incomplete
    sqlType: Incomplete
    hierarchy: Incomplete
    level: Incomplete
    databaseField: Incomplete
    mappingCount: Incomplete
    memberPropertyField: Incomplete
    __elements__: Incomplete
    def __init__(
        self,
        sharedItems: Incomplete | None = None,
        fieldGroup: Incomplete | None = None,
        mpMap: Incomplete | None = None,
        extLst: Incomplete | None = None,
        name: Incomplete | None = None,
        caption: Incomplete | None = None,
        propertyName: Incomplete | None = None,
        serverField: Incomplete | None = None,
        uniqueList: bool = True,
        numFmtId: Incomplete | None = None,
        formula: Incomplete | None = None,
        sqlType: int = 0,
        hierarchy: int = 0,
        level: int = 0,
        databaseField: bool = True,
        mappingCount: Incomplete | None = None,
        memberPropertyField: Incomplete | None = None,
    ) -> None: ...

class RangeSet(Serialisable):
    tagname: str
    i1: Incomplete
    i2: Incomplete
    i3: Incomplete
    i4: Incomplete
    ref: Incomplete
    name: Incomplete
    sheet: Incomplete
    def __init__(
        self,
        i1: Incomplete | None = None,
        i2: Incomplete | None = None,
        i3: Incomplete | None = None,
        i4: Incomplete | None = None,
        ref: Incomplete | None = None,
        name: Incomplete | None = None,
        sheet: Incomplete | None = None,
    ) -> None: ...

class PageItem(Serialisable):
    tagname: str
    name: Incomplete
    def __init__(self, name: Incomplete | None = None) -> None: ...

class Page(Serialisable):
    tagname: str
    pageItem: Incomplete
    __elements__: Incomplete
    def __init__(self, count: Incomplete | None = None, pageItem: Incomplete | None = None) -> None: ...
    @property
    def count(self): ...

class Consolidation(Serialisable):
    tagname: str
    autoPage: Incomplete
    pages: Incomplete
    rangeSets: Incomplete
    __elements__: Incomplete
    def __init__(self, autoPage: Incomplete | None = None, pages=(), rangeSets=()) -> None: ...

class WorksheetSource(Serialisable):
    tagname: str
    ref: Incomplete
    name: Incomplete
    sheet: Incomplete
    def __init__(
        self, ref: Incomplete | None = None, name: Incomplete | None = None, sheet: Incomplete | None = None
    ) -> None: ...

class CacheSource(Serialisable):
    tagname: str
    type: Incomplete
    connectionId: Incomplete
    worksheetSource: Incomplete
    consolidation: Incomplete
    extLst: Incomplete
    __elements__: Incomplete
    def __init__(
        self,
        type: Incomplete | None = None,
        connectionId: Incomplete | None = None,
        worksheetSource: Incomplete | None = None,
        consolidation: Incomplete | None = None,
        extLst: Incomplete | None = None,
    ) -> None: ...

class CacheDefinition(Serialisable):
    mime_type: str
    rel_type: str
    records: Incomplete
    tagname: str
    invalid: Incomplete
    saveData: Incomplete
    refreshOnLoad: Incomplete
    optimizeMemory: Incomplete
    enableRefresh: Incomplete
    refreshedBy: Incomplete
    refreshedDate: Incomplete
    refreshedDateIso: Incomplete
    backgroundQuery: Incomplete
    missingItemsLimit: Incomplete
    createdVersion: Incomplete
    refreshedVersion: Incomplete
    minRefreshableVersion: Incomplete
    recordCount: Incomplete
    upgradeOnRefresh: Incomplete
    tupleCache: Incomplete
    supportSubquery: Incomplete
    supportAdvancedDrill: Incomplete
    cacheSource: Incomplete
    cacheFields: Incomplete
    cacheHierarchies: Incomplete
    kpis: Incomplete
    calculatedItems: Incomplete
    calculatedMembers: Incomplete
    dimensions: Incomplete
    measureGroups: Incomplete
    maps: Incomplete
    extLst: Incomplete
    id: Incomplete
    __elements__: Incomplete
    def __init__(
        self,
        invalid: Incomplete | None = None,
        saveData: Incomplete | None = None,
        refreshOnLoad: Incomplete | None = None,
        optimizeMemory: Incomplete | None = None,
        enableRefresh: Incomplete | None = None,
        refreshedBy: Incomplete | None = None,
        refreshedDate: Incomplete | None = None,
        refreshedDateIso: Incomplete | None = None,
        backgroundQuery: Incomplete | None = None,
        missingItemsLimit: Incomplete | None = None,
        createdVersion: Incomplete | None = None,
        refreshedVersion: Incomplete | None = None,
        minRefreshableVersion: Incomplete | None = None,
        recordCount: Incomplete | None = None,
        upgradeOnRefresh: Incomplete | None = None,
        tupleCache: Incomplete | None = None,
        supportSubquery: Incomplete | None = None,
        supportAdvancedDrill: Incomplete | None = None,
        cacheSource: Incomplete | None = None,
        cacheFields=(),
        cacheHierarchies=(),
        kpis=(),
        calculatedItems=(),
        calculatedMembers=(),
        dimensions=(),
        measureGroups=(),
        maps=(),
        extLst: Incomplete | None = None,
        id: Incomplete | None = None,
    ) -> None: ...
    def to_tree(self): ...
    @property
    def path(self): ...
