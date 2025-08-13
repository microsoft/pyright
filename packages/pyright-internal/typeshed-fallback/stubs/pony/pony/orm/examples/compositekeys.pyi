from _typeshed import Incomplete

from pony.orm.core import Database, Entity

db: Database

class Group(Entity):
    dept: Incomplete
    year: Incomplete
    spec: Incomplete
    students: Incomplete
    courses: Incomplete
    lessons: Incomplete

class Department(Entity):
    number: Incomplete
    faculty: Incomplete
    name: Incomplete
    groups: Incomplete
    teachers: Incomplete

class Faculty(Entity):
    number: Incomplete
    name: Incomplete
    depts: Incomplete

class Student(Entity):
    name: Incomplete
    group: Incomplete
    dob: Incomplete
    grades: Incomplete

class Grade(Entity):
    student: Incomplete
    task: Incomplete
    date: Incomplete
    value: Incomplete

class Task(Entity):
    course: Incomplete
    type: Incomplete
    number: Incomplete
    descr: Incomplete
    grades: Incomplete

class Course(Entity):
    subject: Incomplete
    semester: Incomplete
    groups: Incomplete
    tasks: Incomplete
    lessons: Incomplete
    teachers: Incomplete

class Subject(Entity):
    name: Incomplete
    descr: Incomplete
    courses: Incomplete

class Room(Entity):
    building: Incomplete
    number: Incomplete
    floor: Incomplete
    schedules: Incomplete

class Teacher(Entity):
    dept: Incomplete
    name: Incomplete
    courses: Incomplete
    lessons: Incomplete

class Lesson(Entity):
    groups: Incomplete
    course: Incomplete
    room: Incomplete
    teacher: Incomplete
    date: Incomplete

def test_queries() -> None: ...
