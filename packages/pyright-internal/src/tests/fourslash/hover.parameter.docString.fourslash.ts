/// <reference path="fourslash.ts" />

// @filename: test1.py
//// def foo([|/*marker1*/bar|]: str, [|/*marker2*/baz|]: int) -> str:
////    """ Something about test1
////        
////    Args:
////        bar (str): The bar is in town
////        baz (int): The baz is away
////    
////    Returns:
////        str: Info about the bar and baz
////    """
////    return [|/*marker3*/bar|] + [|/*marker4*/baz|] + hello


// @filename: test2.py
//// from typing import Literal, Union
////
//// A = Union[int, str, None]
////
//// def func([|/*marker5*/param|]: A = None) -> None:
////    """ Something about test2
////        
////    Args:
////        param (A): Info about the param
////    """
////    print([|/*marker6*/param|])

// @filename: testMultiLevelInheritance.py
//// class Base:
////     def method(self, [|/*marker7*/var|]: str):
////        """ Something about method in Base
////        
////        Args:
////            var (str): Info about var in Base
////        """
////        print([|/*marker8*/var|])
////
//// class Derived1(Base):
////     def method(self, [|/*marker9*/var|]: str):
////         pass
////
//// class Derived2(Derived1):
////     def method(self, [|/*marker10*/var|]: str):
////        """ Something about method in Derived2
////        
////        Args:
////            var (str): Info about var in Derived2
////        """
////        print([|/*marker11*/var|])
////

helper.verifyHover('markdown', {
    marker1: '```python\n(parameter) bar: str\n```\n---\nbar (str): The bar is in town',
    marker2: '```python\n(parameter) baz: int\n```\n---\nbaz (int): The baz is away',
    marker3: '```python\n(parameter) bar: str\n```\n---\nbar (str): The bar is in town',
    marker4: '```python\n(parameter) baz: int\n```\n---\nbaz (int): The baz is away',
    marker5: '```python\n(parameter) param: A\n```\n---\nparam (A): Info about the param',
    marker6: '```python\n(parameter) param: A\n```\n---\nparam (A): Info about the param',
    marker7: '```python\n(parameter) var: str\n```\n---\nvar (str): Info about var in Base',
    marker8: '```python\n(parameter) var: str\n```\n---\nvar (str): Info about var in Base',
    marker9: '```python\n(parameter) var: str\n```\n---\nvar (str): Info about var in Base',
    marker10: '```python\n(parameter) var: str\n```\n---\nvar (str): Info about var in Derived2',
    marker11: '```python\n(parameter) var: str\n```\n---\nvar (str): Info about var in Derived2',
});