from datetime import date, datetime

def display(value):
    if value is None:return ""
    if isinstance(value,datetime):return value.strftime("%d/%m/%Y %H:%M:%S")
    if isinstance(value,date):return value.strftime("%d/%m/%Y")
    return str(value)
