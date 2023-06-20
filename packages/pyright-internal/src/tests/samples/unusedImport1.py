# This sample tests the reportUnusedImport diagnostic rule.
import sys as sys  # Assumes export
import os as os2  # Should error
from sys import path as p  # Should error
from os import environ as environ  # Assumes export
