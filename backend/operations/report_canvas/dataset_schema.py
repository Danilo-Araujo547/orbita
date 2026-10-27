"""Column contract shared by the editor and native dataset adapters.

Every dataset declares either its columns or a pure date -> columns function.
Do not execute queries to discover headers or accept an unknown/partial schema.
"""
from .schema import fail


def resolve_columns(specs, reference_date):
    result={}
    for name,spec in specs.items():
        columns=spec(reference_date) if callable(spec) else spec
        if (not isinstance(columns,list) or not 1 <= len(columns) <= 100
            or any(not isinstance(c,str) or not c or len(c)>100 for c in columns)
            or len(set(columns))!=len(columns)):
            fail("Declare todas as colunas do conjunto de dados: "+str(name))
        result[name]=list(columns)
    return result
