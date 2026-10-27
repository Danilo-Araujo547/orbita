from operations.report_app_api import AppConnectionViewSet
from django.contrib import admin
from django.urls import include, path
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView
from rest_framework.routers import DefaultRouter

from core import views
from core.agenda import AgendaViewSet
from core.federation import (
    InstanceKeyViewSet,
    ManifestView,
    RemoteInstanceViewSet,
    RemoteProxyView,
)
from core.logs import LogViewSet
from core.oracle_config import OracleConfigurationViewSet
from core.users import UserViewSet
from messaging.costs import MetaCostView
from messaging.groups import AppointmentGroupViewSet
from messaging.meta_config import MetaConfigurationViewSet
from operations import snapshot_api
from operations import report_api
from operations import views as operations
from operations.members import MemberViewSet
from operations.report_whatsapp import (
    ReportWhatsAppAuthorizeView,
    ReportWhatsAppInboundView,
    ReportWhatsAppView,
)
from scheduling.agenda_api import OracleAgendaViewSet

router = DefaultRouter()
for prefix, view in [
    ("oracle-agendas", OracleAgendaViewSet),
    ("oracle-configuration", OracleConfigurationViewSet),
    ("users", UserViewSet),
    ("instance-keys", InstanceKeyViewSet),
    ("remote-instances", RemoteInstanceViewSet),
    ("meta-configuration", MetaConfigurationViewSet),
    ("appointment-groups", AppointmentGroupViewSet),
    ("appointments", views.AppointmentViewSet),
    ("agenda-items", AgendaViewSet),
    ("messages", views.MessageViewSet),
    ("replies", views.ReplyViewSet),
    ("issues", views.IssueViewSet),
    ("rules", views.RuleViewSet),
    ("templates", views.TemplateViewSet),
    ("imports", views.ImportViewSet),
    ("audit", views.AuditViewSet),
    ("logs", LogViewSet),
    ("cases", operations.CaseViewSet),
    ("contacts", operations.ContactViewSet),
    ("movements", operations.MovementViewSet),
    ("preparations", operations.PreparationViewSet),
    ("layouts", operations.LayoutViewSet),
    ("policies", operations.PolicyViewSet),
    ("sheet-imports", operations.SheetViewSet),
    ("campaigns", operations.CampaignViewSet),
    ("reports", report_api.CatalogViewSet),
    ("report-access", operations.ReportAccessViewSet),
    ("report-connections", report_api.ConnectionViewSet),
    ("report-app-connections", AppConnectionViewSet),
    ("report-recipients", report_api.RecipientViewSet),
    ("report-grants", report_api.GrantViewSet),
    ("report-automations", report_api.AutomationViewSet),
    ("report-executions", report_api.ExecutionViewSet),
    ("report-snapshots", snapshot_api.SnapshotConfigurationViewSet),
    ("report-snapshot-runs", snapshot_api.SnapshotRunViewSet),
    ("report-requests", operations.ReportRequestViewSet),
    ("report-schedules", operations.ReportScheduleViewSet),
    ("sources", operations.SourceConfigurationViewSet),
    ("flow-rules", operations.FlowRuleViewSet),
    ("flow-runs", operations.FlowRunViewSet),
    ("units", operations.UnitViewSet),
    ("members", MemberViewSet),
]:
    router.register(prefix, view, basename=prefix)

urlpatterns = [
    path("api/v1/report-whatsapp/authorize/", ReportWhatsAppAuthorizeView.as_view()),
    path("api/v1/report-whatsapp/", ReportWhatsAppView.as_view()),
    path("api/v1/report-whatsapp/inbound/", ReportWhatsAppInboundView.as_view()),
    path("admin/", admin.site.urls),
    path("api/v1/meta-costs/", MetaCostView.as_view()),
    path("api/v1/", include(router.urls)),
    path("api/v1/federation/manifest/", ManifestView.as_view()),
    path(
        "api/v1/remote/<uuid:connection_id>/<path:resource>", RemoteProxyView.as_view()
    ),
    path("api/v1/auth/csrf/", views.csrf),
    path("api/v1/auth/login/", views.LoginView.as_view()),
    path("api/v1/auth/session/", views.session),
    path("api/v1/control/", views.control),
    path("api/v1/workspace/", views.workspace),
    path("api/v1/indicators/", views.indicators),
    path("api/v1/tests/appointments/", views.test_appointment),
    path("api/v1/tests/process/", views.process_test),
    path("api/v1/schema/", SpectacularAPIView.as_view(), name="schema"),
    path("api/v1/docs/", SpectacularSwaggerView.as_view(url_name="schema")),
    path("webhooks/whatsapp/", views.webhook),
    path("health/", views.health),
]
