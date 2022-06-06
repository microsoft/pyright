import sys

from .case import (
    FunctionTestCase as FunctionTestCase,
    SkipTest as SkipTest,
    TestCase as TestCase,
    expectedFailure as expectedFailure,
    skip as skip,
    skipIf as skipIf,
    skipUnless as skipUnless,
)
from .loader import (
    TestLoader as TestLoader,
    defaultTestLoader as defaultTestLoader,
    findTestCases as findTestCases,
    getTestCaseNames as getTestCaseNames,
    makeSuite as makeSuite,
)
from .main import TestProgram as TestProgram, main as main
from .result import TestResult as TestResult
from .runner import TextTestResult as TextTestResult, TextTestRunner as TextTestRunner
from .signals import (
    installHandler as installHandler,
    registerResult as registerResult,
    removeHandler as removeHandler,
    removeResult as removeResult,
)
from .suite import BaseTestSuite as BaseTestSuite, TestSuite as TestSuite

if sys.version_info >= (3, 8):
    from unittest.async_case import *

    from .case import addModuleCleanup as addModuleCleanup

if sys.version_info >= (3, 11):
    from .case import doModuleCleanups as doModuleCleanups, enterModuleContext as enterModuleContext

if sys.version_info >= (3, 11):
    __all__ = [
        "TestResult",
        "TestCase",
        "IsolatedAsyncioTestCase",
        "TestSuite",
        "TextTestRunner",
        "TestLoader",
        "FunctionTestCase",
        "main",
        "defaultTestLoader",
        "SkipTest",
        "skip",
        "skipIf",
        "skipUnless",
        "expectedFailure",
        "TextTestResult",
        "installHandler",
        "registerResult",
        "removeResult",
        "removeHandler",
        "addModuleCleanup",
        "doModuleCleanups",
        "enterModuleContext",
        "getTestCaseNames",
        "makeSuite",
        "findTestCases",
    ]

elif sys.version_info >= (3, 8):
    __all__ = [
        "TestResult",
        "TestCase",
        "IsolatedAsyncioTestCase",
        "TestSuite",
        "TextTestRunner",
        "TestLoader",
        "FunctionTestCase",
        "main",
        "defaultTestLoader",
        "SkipTest",
        "skip",
        "skipIf",
        "skipUnless",
        "expectedFailure",
        "TextTestResult",
        "installHandler",
        "registerResult",
        "removeResult",
        "removeHandler",
        "addModuleCleanup",
        "getTestCaseNames",
        "makeSuite",
        "findTestCases",
    ]

else:
    __all__ = [
        "TestResult",
        "TestCase",
        "TestSuite",
        "TextTestRunner",
        "TestLoader",
        "FunctionTestCase",
        "main",
        "defaultTestLoader",
        "SkipTest",
        "skip",
        "skipIf",
        "skipUnless",
        "expectedFailure",
        "TextTestResult",
        "installHandler",
        "registerResult",
        "removeResult",
        "removeHandler",
        "getTestCaseNames",
        "makeSuite",
        "findTestCases",
    ]

def load_tests(loader: TestLoader, tests: TestSuite, pattern: str | None) -> TestSuite: ...
