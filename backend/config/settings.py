import os
from pathlib import Path

from config.local_env import load_local_env

load_local_env()

BASE_DIR = Path(__file__).resolve().parent.parent
DEBUG = os.getenv("DEBUG", "0") == "1"
SECRET_KEY = os.getenv("DJANGO_SECRET_KEY", "local-development-only-change-before-exposing")
if not DEBUG and SECRET_KEY.startswith("local-development") and os.getenv("DATABASE_HOST"):
    raise RuntimeError("Configure DJANGO_SECRET_KEY antes de iniciar o ambiente Docker.")
ALLOWED_HOSTS = os.getenv("ALLOWED_HOSTS", "localhost,127.0.0.1,testserver").split(",")
INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "rest_framework",
    "drf_spectacular",
    "corsheaders",
    "core",
    "scheduling",
    "messaging",
    "responses",
    "operations",
]
MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "core.federation_auth.FederationContextMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
]
ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"
TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
                "django.template.context_processors.request",
            ]
        },
    }
]
if os.getenv("DATABASE_ENGINE", "postgresql") == "postgresql":
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.postgresql",
            "HOST": os.getenv("DATABASE_HOST", "127.0.0.1"),
            "NAME": os.getenv("DATABASE_NAME", "orbita"),
            "USER": os.getenv("DATABASE_USER", "orbita"),
            "PASSWORD": os.getenv("DATABASE_PASSWORD", ""),
            "PORT": os.getenv("DATABASE_PORT", "5432"),
            "CONN_MAX_AGE": 60,
        }
    }
elif os.getenv("DATABASE_ENGINE") == "sqlite":
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.sqlite3",
            "NAME": os.getenv("SQLITE_PATH", str(BASE_DIR / "local.sqlite3")),
            "OPTIONS": {"timeout": 30},
        }
    }
else:
    raise RuntimeError("DATABASE_ENGINE deve ser postgresql ou sqlite (somente desenvolvimento explícito).")
LANGUAGE_CODE = "pt-br"
TIME_ZONE = "America/Sao_Paulo"
USE_TZ = True
DATA_UPLOAD_MAX_MEMORY_SIZE = 8 * 1024 * 1024
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
REST_FRAMEWORK = {
    "EXCEPTION_HANDLER": "core.exceptions.api_exception_handler",
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "core.federation_auth.InstanceKeyAuthentication",
        "rest_framework.authentication.SessionAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": ["core.access.SectionPermission"],
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
    "DEFAULT_PAGINATION_CLASS": "rest_framework.pagination.PageNumberPagination",
    "PAGE_SIZE": 50,
}
SPECTACULAR_SETTINGS = {
    "TITLE": "SCV  API",
    "VERSION": "1.0.0",
    "SERVE_PERMISSIONS": ["rest_framework.permissions.IsAuthenticated"],
    "ENUM_NAME_OVERRIDES": {
        "MembershipRoleEnum": [("admin", "Administrador"), ("operator", "Operador"), ("viewer", "Consulta")],
        "AppointmentKindEnum": [("consultation", "Consulta"), ("exam", "Exame"), ("lab", "Laboratório"), ("postprocedure", "Busca ativa - pós procedimento")],
        "SourceKindEnum": [
            ("consultation", "Consulta"),
            ("exam", "Exame"),
            ("lab", "Laboratório"),
            ("postoperative", "Pós-cirúrgico"),
        ],
        "MovementKindEnum": [
            ("cancel", "Cancelamento"),
            ("reschedule", "Reagendamento"),
            ("transfer", "Transferência"),
        ],
        "CommunicationPurposeEnum": [
            ("appointment", "Confirmação de agendamento"),
            ("waitlist", "Permanência na fila CDR"),
            ("summons", "Convocação CDR"),
            ("postoperative", "Acompanhamento pós-cirúrgico"),
            ("absence", "Motivo da ausência"),
            ("movement", "Movimentação de agenda"),
            ("report", "Relatório"),
        ],
        "CDRImportPurposeEnum": ["waitlist", "summons"],
    },
}
CORS_ALLOWED_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"]
CSRF_TRUSTED_ORIGINS = os.getenv(
    "CSRF_TRUSTED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173,http://localhost:8080"
).split(",")
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = "Lax"
SESSION_COOKIE_SECURE = os.getenv("SECURE_COOKIES", "0") == "1"
CSRF_COOKIE_SECURE = SESSION_COOKIE_SECURE
SECURE_CONTENT_TYPE_NOSNIFF = True
X_FRAME_OPTIONS = "DENY"
CELERY_BROKER_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
CELERY_RESULT_BACKEND = None
CELERY_TASK_IGNORE_RESULT = True
ASYNC_TASKS = bool(os.getenv("REDIS_URL"))
CELERY_TASK_ALWAYS_EAGER = os.getenv("CELERY_TASK_ALWAYS_EAGER", "0") == "1"
CELERY_TIMEZONE = TIME_ZONE
CELERY_BEAT_SCHEDULE = {
    "bed-snapshots": {"task": "operations.tick_bed_snapshots", "schedule": 30.0},
    "tick": {"task": "scheduling.tick", "schedule": 60.0},
    "dispatch": {"task": "messaging.dispatch_due", "schedule": 1.0},
    "operations": {"task": "operations.tick", "schedule": 60.0},
}
SEND_MODE = os.getenv("SEND_MODE", "simulated")
META_REAL_ENABLED = os.getenv("META_REAL_ENABLED", "0") == "1"
META_PILOT_TEMPLATE = os.getenv("META_PILOT_TEMPLATE", "")
META_PILOT_DAILY_LIMIT = int(os.getenv("META_PILOT_DAILY_LIMIT", "30"))
META_INBOX_SSH_HOST = os.getenv("META_INBOX_SSH_HOST", "")
META_INBOX_SSH_USER = os.getenv("META_INBOX_SSH_USER", "root")
META_INBOX_CONTAINER = os.getenv("META_INBOX_CONTAINER", "meta-whatsapp-webhook")
SIMULATED_SQLITE_PATH = os.getenv("SIMULATED_SQLITE_PATH", "")
SIMULATED_SQLITE_UNIT = os.getenv("SIMULATED_SQLITE_UNIT", "ame")
META_ACCESS_TOKEN = os.getenv("META_ACCESS_TOKEN", "")
META_PHONE_NUMBER_ID = os.getenv("META_PHONE_NUMBER_ID", "")
META_DISPLAY_PHONE_NUMBER = os.getenv("META_DISPLAY_PHONE_NUMBER", "")
META_APP_SECRET = os.getenv("META_APP_SECRET", "")
META_VERIFY_TOKEN = os.getenv("META_VERIFY_TOKEN", "")
META_API_VERSION = os.getenv("META_API_VERSION", "v24.0")
META_UNIT_SLUG = os.getenv("META_UNIT_SLUG", "ame")
TEST_RECIPIENTS = tuple(p.strip() for p in os.getenv("TEST_RECIPIENTS", "").split(",") if p.strip())
ORACLE_DSN = os.getenv("ORACLE_DSN", "")
ORACLE_USER = os.getenv("ORACLE_USER", "")
ORACLE_PASSWORD = os.getenv("ORACLE_PASSWORD", "")
ORACLE_THICK = os.getenv("ORACLE_THICK", "0") == "1"
ORACLE_CLIENT_DIR = os.getenv("ORACLE_CLIENT_DIR", "")
ORACLE_CALL_TIMEOUT_MS = int(os.getenv("ORACLE_CALL_TIMEOUT_MS", "120000"))
AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator", "OPTIONS": {"min_length": 12}}
]

# Dedicated Fernet key: credential storage is independent of Django signing keys.
META_CREDENTIALS_KEY = os.getenv("META_CREDENTIALS_KEY", "")
INSTANCE_CREDENTIALS_KEY = os.getenv("INSTANCE_CREDENTIALS_KEY", "")
ORACLE_CREDENTIALS_KEY = os.getenv("ORACLE_CREDENTIALS_KEY", "")
ORBITA_INSTANCE_ID = os.getenv("ORBITA_INSTANCE_ID", "")

# Report-only WhatsApp Web transport. Independent from Meta notification policies.
REPORT_BAILEYS_URL = os.getenv("REPORT_BAILEYS_URL", "http://baileys:9322")
REPORT_BAILEYS_TOKEN = os.getenv("REPORT_BAILEYS_TOKEN", "")
REPORT_BAILEYS_ALLOW_SENDS = os.getenv("REPORT_BAILEYS_ALLOW_SENDS", "0") == "1"
