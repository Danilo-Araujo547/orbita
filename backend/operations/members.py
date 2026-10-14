from core.models import Audit, Membership
from core.permissions import get_unit
from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as PasswordError
from drf_spectacular.utils import extend_schema
from rest_framework import serializers
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError

from operations.services import Conflict
from operations.views import ScopedRead


class MemberSerializer(serializers.ModelSerializer):
    username = serializers.CharField(source="user.username", read_only=True)
    active = serializers.BooleanField(source="user.is_active", read_only=True)

    class Meta:
        model = Membership
        fields = ["id", "user", "username", "role", "active"]


class MemberInput(serializers.Serializer):
    username = serializers.RegexField(r"^[\w.@+-]{3,150}$")
    password = serializers.CharField(write_only=True, min_length=12, max_length=200)
    role = serializers.ChoiceField(choices=Membership.Role.choices)


class MemberViewSet(ScopedRead):
    queryset = Membership.objects.select_related("user").order_by("user__username")
    serializer_class = MemberSerializer

    def get_queryset(self):
        get_unit(self.request, ["admin"])
        return super().get_queryset()

    @extend_schema(request=MemberInput, responses=MemberSerializer)
    def create(self, request):
        unit = get_unit(request, ["admin"])
        values = MemberInput(data=request.data)
        values.is_valid(raise_exception=True)

        def execute():
            data = values.validated_data
            if get_user_model().objects.filter(username=data["username"]).exists():
                raise ValidationError(
                    "Nome de usuário indisponível. O cadastro não vincula contas de outras unidades."
                )
            try:
                validate_password(data["password"])
            except PasswordError:
                raise ValidationError("Senha não atende aos requisitos de segurança.") from None
            user = get_user_model().objects.create_user(data["username"], password=data["password"])
            member = Membership.objects.create(unit=unit, user=user, role=data["role"])
            Audit.objects.create(
                unit=unit, actor=request.user, action="member.created", object_id=str(member.pk)
            )
            return self.get_serializer(member).data

        return self.once(request, execute)

    @action(detail=True, methods=["post"])
    def role(self, request, pk=None):
        unit = get_unit(request, ["admin"])

        def execute():
            member = self.get_object()
            if member.user_id == request.user.pk:
                raise ValidationError("Não altere o próprio perfil por este endpoint.")
            role = request.data.get("role")
            if role not in Membership.Role.values:
                raise ValidationError("Perfil inválido.")
            if not Membership.objects.filter(pk=member.pk, role=request.data.get("expected_role")).update(
                role=role
            ):
                raise Conflict()
            member.refresh_from_db()
            Audit.objects.create(
                unit=unit,
                actor=request.user,
                action="member.role_changed",
                object_id=str(member.pk),
                details={"role": role},
            )
            return self.get_serializer(member).data

        return self.once(request, execute)
