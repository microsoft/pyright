# Test file for Pyright debugging
# import os
# # import sys

# # Variable with an explicit type annotation
# an_integer: int = 1

# an_integer = '2'
# an_integer = os.getcwd()

# # Using another library
# python_version = sys.version

# print(f"Current working directory: {an_integer}")
# print(f"Python version: {python_version}")

# joined_path = os.path.join("example", "dir")
# print(f"Joined path: {joined_path}")



# import random 

# p = random.randint(1, 10)
# p = '90'


# from icecream import ic

# x = 10
# x = ic(x)


# from ros2cli import command


# @command('circle')
# def circle_command(args: list[str]) -> int:
#     """
#     A command that prints a message indicating it is part of a circle.
#     """
#     print("This is a command in a circular dependency example.")
#     return 0


# use concurrent library to demonstrate a simple example

from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import List, Callable
def square(n: int) -> int:
    """Function to compute the square of a number."""
    return n * n
def compute_squares(numbers: List[int], worker: Callable[[int], int]) -> List[int]:
    """
    Function to compute squares of a list of numbers using a worker function.
    
    Args:
        numbers: List of integers to compute squares for.
        worker: Function that computes the square of a number.
        
    Returns:
        List of squared integers.
    """
    results = []
    with ThreadPoolExecutor() as executor:
        futures = {executor.submit(worker, n): n for n in numbers}
        for future in as_completed(futures):
            results.append(future.result())
    return results







"""
this is the seond file
"""
# """
# This module demonstrates a simple circle class and a function to calculate the area of a circle.
# (Module docstrings are optional but good practice in python)
# # """

# from abc import ABC, abstractmethod
# from enum import Enum
# import math
# import unittest

# # Module-level global var
# RAD = 5


# def calculate_area(radius: float) -> float:
#     """Function to calculate the area of a circle."""
#     return math.pi * radius * radius


# # Multiline comments in python feels like a hack
# """
# Above we have the demonstration of a function to calculate the area of a circle.
# Below we have the demonstration of a class to calculate the area of a circle.
# """


# class ShapeType(Enum):
#     """Enum for shape types"""

#     CIRCLE = "Circle"
#     UNKNOWN = "Unknown"


# class Shape(ABC):
#     """Base class for a shape."""

#     def __init__(self, shape_type: ShapeType):
#         self.shape_type = shape_type

#     @abstractmethod
#     def area(self) -> float:
#         """Abstract method to calculate the area of a shape."""
#         pass


# class Circle(Shape):
#     """Circle class inherits from Shape."""

#     def __init__(self, radius: float):
#         super().__init__(ShapeType.CIRCLE)
#         self.radius = radius

#     def area(self) -> float:
#         """Overridden method to calculate the area of the circle."""
#         return math.pi * self.radius * self.radius


# c = Circle(RAD)

# if __name__ == "__main__":
#     # To run the program functionality
#     print(f"Area of a circle with radius {RAD} using function: {calculate_area(RAD)}")
#     print(f"Area of a {c.shape_type.value} with radius {RAD} using class: {c.area()}")

#     # Uncomment the next line if you want to run the unit tests
#     # run_tests()


# # Unit Tests!
# class TestShapesFunctions(unittest.TestCase):
#     def test_calculate_area(self) -> None:
#         expected_area = 78.53981633974483
#         self.assertAlmostEqual(calculate_area(RAD), expected_area)

#     def test_circle_area(self) -> None:
#         c = Circle(RAD)
#         expected_area = 78.53981633974483
#         self.assertAlmostEqual(c.area(), expected_area)

#     def test_circle_type(self) -> None:
#         c = Circle(RAD)
#         self.assertEqual(c.shape_type, ShapeType.CIRCLE)
