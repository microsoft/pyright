from _typeshed import Incomplete

from pony.orm.core import Database, Entity

db: Database

class Faculty(Entity):
    number: Incomplete
    name: Incomplete
    departments: Incomplete

class Department(Entity):
    number: Incomplete
    name: Incomplete
    faculty: Incomplete
    teachers: Incomplete
    majors: Incomplete
    groups: Incomplete

class Group(Entity):
    number: Incomplete
    grad_year: Incomplete
    department: Incomplete
    lessons: Incomplete
    students: Incomplete

class Student(Entity):
    name: Incomplete
    scholarship: Incomplete
    group: Incomplete
    grades: Incomplete

class Major(Entity):
    name: Incomplete
    department: Incomplete
    courses: Incomplete

class Subject(Entity):
    name: Incomplete
    courses: Incomplete
    teachers: Incomplete

class Course(Entity):
    major: Incomplete
    subject: Incomplete
    semester: Incomplete
    lect_hours: Incomplete
    pract_hours: Incomplete
    credit: Incomplete
    lessons: Incomplete
    grades: Incomplete

class Lesson(Entity):
    day_of_week: Incomplete
    meeting_time: Incomplete
    classroom: Incomplete
    course: Incomplete
    teacher: Incomplete
    groups: Incomplete

class Grade(Entity):
    student: Incomplete
    course: Incomplete
    teacher: Incomplete
    date: Incomplete
    value: Incomplete

class Teacher(Entity):
    name: Incomplete
    degree: Incomplete
    department: Incomplete
    subjects: Incomplete
    lessons: Incomplete
    grades: Incomplete

class Building(Entity):
    number: Incomplete
    description: Incomplete
    classrooms: Incomplete

class Classroom(Entity):
    building: Incomplete
    number: Incomplete
    description: Incomplete
    lessons: Incomplete

def test_queries() -> None: ...
