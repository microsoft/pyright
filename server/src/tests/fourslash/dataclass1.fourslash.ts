/// <reference path="fourslash.ts" />

// @filename: dataclass1.py
//// # This sample validates the Python 3.7 data class feature.
////
//// from typing import NamedTuple, Optional
////
//// class Other:
////     pass
////
//// class DataTuple(NamedTuple):
////     def _m(self):
////         pass
////     id: int
////     aid: Other
////     valll: str = ''
////     name: Optional[str] = None
////
//// d1 = DataTuple(id=1, aid=Other())
//// d2 = DataTuple(id=1, aid=Other(), valll='v')
//// d3 = DataTuple(id=1, aid=Other(), name='hello')
//// d4 = DataTuple(id=1, aid=Other(), name=None)
//// id = d1.id
////
//// # This should generate an error because the name argument
//// # is the incorrect type.
//// d5 = DataTuple(id=1, aid=Other(), name=[|{|"category": "error"|}3|])
////
//// # This should generate an error because aid is a required
//// # parameter and is missing an argument here.
//// d6 = [|{|"category": "error"|}DataTuple(id=1, name=None|])

helper.verifyDiagnostics();
