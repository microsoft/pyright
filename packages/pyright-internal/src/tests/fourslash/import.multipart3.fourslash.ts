/// <reference path="typings/fourslash.d.ts" />

// @filename: mylib/__init__.py
////

// @filename: mylib/a.py
//// def do_something(value: str) -> None:
////     pass

// @filename: mylib/b.py
//// def do_other() -> None:
////     pass

// @filename: my_common_stuffs.py
//// import mylib.b
//// BLA = '123'

// @filename: test.py
//// import mylib.a
////
//// from my_common_stuffs import *
////
//// mylib.a.do_something(BLA)
//// mylib.b.do_other()

// @filename: nestedlib/__init__.py
////

// @filename: nestedlib/alpha/__init__.py
////

// @filename: nestedlib/alpha/left.py
//// def left_func() -> None:
////     pass

// @filename: nestedlib/alpha/right.py
//// def right_func() -> None:
////     pass

// @filename: nested_common.py
//// import nestedlib.alpha.right

// @filename: nested_clone_test.py
//// from nested_common import *
////
//// nestedlib.alpha.right.right_func()

// @filename: nested_merge_test.py
//// import nestedlib.alpha.left
////
//// from nested_common import *
////
//// nestedlib.alpha.left.left_func()
//// nestedlib.alpha.right.right_func()

helper.verifyDiagnostics();
