import json
from django.db.models import Q
from drf_spectacular.utils import extend_schema
from rest_framework import serializers
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from core.models import Unit,RemoteInstance
from core.permissions import get_unit
from operations.models import ReportApplicationConnection
from operations.serializers import model_serializer
from operations.views import ConfigViewSet
from operations.reporting import is_admin

class AppDataResponseSchema(serializers.Serializer):
    protocol=serializers.CharField()
    unit=serializers.CharField()
    columns=serializers.ListField(child=serializers.CharField())
    rows=serializers.ListField(child=serializers.ListField(child=serializers.JSONField()))

class AppConnectionOptionsSchema(serializers.Serializer):
    units=serializers.ListField(child=serializers.DictField())
    remote_instances=serializers.ListField(child=serializers.DictField())

class AppConnectionSerializer(model_serializer(ReportApplicationConnection,["version"])):
    source_name=serializers.SerializerMethodField()
    state=serializers.SerializerMethodField()

    def get_source_name(self,obj)->str:
        return obj.local_unit.name if obj.mode=="local" and obj.local_unit_id else obj.remote_instance.name if obj.remote_instance_id else "Pendente"

    def get_state(self,obj)->str:
        if not obj.enabled:return "disabled"
        if obj.mode=="local":return "local" if obj.local_unit_id else "pending"
        return obj.remote_instance.state if obj.remote_instance_id else "pending"

    def validate(self,attrs):
        attrs=super().validate(attrs)
        def value(k,default=None):return attrs.get(k,getattr(self.instance,k,default))
        mode=value("mode","local");local=value("local_unit");remote=value("remote_instance");enabled=value("enabled",False)
        request=self.context["request"];unit=get_unit(request,["admin"])
        if mode=="local":
            if remote:raise ValidationError("Conexão local não usa instância remota.")
            if local and not is_admin(request.user,local):raise ValidationError("Sem permissão administrativa na unidade de origem.")
            if enabled and not local:raise ValidationError("Selecione a unidade de origem.")
        elif mode=="remote":
            if local:raise ValidationError("Conexão remota não usa unidade local.")
            if remote and remote.local_unit_id!=unit.pk:raise ValidationError("Instância de outra unidade.")
            if enabled and (not remote or not remote.enabled or remote.state!="connected" or remote.remote_role!="admin"):raise ValidationError("Selecione uma instância conectada com chave administrativa.")
        return attrs

class AppConnectionViewSet(ConfigViewSet):
    queryset=ReportApplicationConnection.objects.select_related("local_unit","remote_instance")
    serializer_class=AppConnectionSerializer

    def get_queryset(self):
        return self.queryset.filter(unit=get_unit(self.request,["admin"])).order_by("name")

    @extend_schema(responses=AppConnectionOptionsSchema)
    @action(detail=False,methods=["get"])
    def options(self,request):
        unit=get_unit(request,["admin"])
        units=Unit.objects.all() if request.user.is_superuser else Unit.objects.filter(membership__user=request.user,membership__role="admin")
        return Response({"units":list(units.values("id","name","slug")),"remote_instances":list(RemoteInstance.objects.filter(local_unit=unit).values("id","name","base_url","state","enabled","remote_unit_slug"))})

    def validate_config(self,obj):
        pass


def app_data(request):
    from operations.app_reporting import local_data
    unit=get_unit(request,["admin"])
    try:filters=json.loads(request.query_params.get("filters","{}"))
    except (ValueError,TypeError):raise ValidationError("Filtros inválidos.")
    values={k:request.query_params[k] for k in ["start","end"] if k in request.query_params}
    columns,rows=local_data(unit,request.query_params.get("metric",""),values,filters)
    return Response({"protocol":"scv-app-reports/1","unit":unit.slug,"columns":columns,"rows":rows})
