from core import views
from core.federation import InstanceKeyViewSet, ManifestView, RemoteInstanceViewSet, RemoteProxyView
from core.oracle_config import OracleConfigurationViewSet
from core.users import UserViewSet
from django.contrib import admin
from django.urls import include, path
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView
from messaging.groups import AppointmentGroupViewSet
from messaging.meta_config import MetaConfigurationViewSet
from operations import views as operations
from operations.members import MemberViewSet
from rest_framework.routers import DefaultRouter

router = DefaultRouter()
for prefix, view in [
    ("oracle-configuration", OracleConfigurationViewSet),
    ("users", UserViewSet),
    ("instance-keys", InstanceKeyViewSet),
    ("remote-instances", RemoteInstanceViewSet),
    ("meta-configuration", MetaConfigurationViewSet),
    ("appointment-groups", AppointmentGroupViewSet),
    ("appointments", views.AppointmentViewSet),
    ("messages", views.MessageViewSet),
    ("replies", views.ReplyViewSet),
    ("issues", views.IssueViewSet),
    ("rules", views.RuleViewSet),
    ("templates", views.TemplateViewSet),
    ("imports", views.ImportViewSet),
    ("audit", views.AuditViewSet),
    ("cases", operations.CaseViewSet),
    ("contacts", operations.ContactViewSet),
    ("movements", operations.MovementViewSet),
    ("preparations", operations.PreparationViewSet),
    ("layouts", operations.LayoutViewSet),
    ("policies", operations.PolicyViewSet),
    ("sheet-imports", operations.SheetViewSet),
    ("campaigns", operations.CampaignViewSet),
    ("reports", operations.ReportViewSet),
    ("report-access", operations.ReportAccessViewSet),
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
    path("admin/", admin.site.urls),
    path("api/v1/", include(router.urls)),
    path("api/v1/federation/manifest/", ManifestView.as_view()),
    path("api/v1/remote/<uuid:connection_id>/<path:resource>", RemoteProxyView.as_view()),
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
