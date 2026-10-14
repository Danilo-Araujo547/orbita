from core.models import Unit
from django.contrib import admin
from django.contrib.auth import get_user_model
from django.test import RequestFactory
from django.urls import reverse
from scheduling.models import Appointment


def test_admin_requires_staff_and_superuser_for_global_data(setup):
    client = setup["client"]
    assert client.get(reverse("admin:index")).status_code == 302
    user = get_user_model().objects.get(username="admin")
    user.is_staff = True
    user.save(update_fields=["is_staff"])
    client.force_login(user)
    request = RequestFactory().get("/admin/")
    request.user = user
    assert not admin.site._registry[Appointment].has_view_permission(request)
    user.is_superuser = True
    user.save(update_fields=["is_superuser"])
    assert client.get(reverse("admin:index")).status_code == 200
    assert client.get(reverse("admin:scheduling_appointment_changelist")).status_code == 200
    assert admin.site._registry[Appointment].has_view_permission(request)
    assert not admin.site._registry[Appointment].has_change_permission(request)
    assert not admin.site._registry[Appointment].has_delete_permission(request)
    assert admin.site._registry[Unit].has_change_permission(request)
