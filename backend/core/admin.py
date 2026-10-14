from django.apps import apps
from django.contrib import admin

admin.site.site_header = "Órbita · Administração"
admin.site.site_title = "Órbita Admin"
admin.site.index_title = "Administração do sistema"


class SystemAdmin(admin.ModelAdmin):
    """Global system administration is restricted to superusers."""

    list_per_page = 50

    def has_module_permission(self, request):
        return request.user.is_active and request.user.is_superuser

    def has_view_permission(self, request, obj=None):
        return self.has_module_permission(request)

    def has_add_permission(self, request):
        return self.has_module_permission(request)

    def has_change_permission(self, request, obj=None):
        return self.has_module_permission(request)

    def has_delete_permission(self, request, obj=None):
        return self.has_module_permission(request)


class OperationalAdmin(SystemAdmin):
    """Inspect operational history; changes go through the audited application flows."""

    actions = None

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


CONFIGURATION_MODELS = {
    "core.Unit",
    "core.Membership",
    "scheduling.Rule",
    "messaging.Template",
    "operations.Preparation",
    "operations.ImportLayout",
    "operations.PurposePolicy",
    "operations.ReportDefinition",
    "operations.ReportAccess",
    "operations.ReportSchedule",
    "operations.SourceConfiguration",
    "operations.FlowRule",
}


def register_app_models(app_label):
    for model in apps.get_app_config(app_label).get_models():
        fields = {field.name: field for field in model._meta.fields}
        display = tuple(
            name
            for name in (
                "id",
                "name",
                "code",
                "external_id",
                "patient",
                "unit",
                "kind",
                "state",
                "created_at",
            )
            if name in fields
        )
        search = tuple(
            name
            for name in ("name", "code", "external_id", "patient", "phone", "recipient", "provider_id")
            if name in fields
        )
        filters = tuple(name for name in ("unit", "kind", "state", "synthetic") if name in fields)
        base = SystemAdmin if model._meta.label in CONFIGURATION_MODELS else OperationalAdmin
        model_admin = type(
            f"{model.__name__}Admin",
            (base,),
            {
                "list_display": display,
                "search_fields": search,
                "list_filter": filters,
                "list_select_related": True,
            },
        )
        admin.site.register(model, model_admin)


register_app_models("core")
