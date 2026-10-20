FROM python:3.12-slim-bookworm
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends curl unzip libaio1 libnsl2 \
    && mkdir -p /opt/oracle \
    && curl -fsSL https://download.oracle.com/otn_software/linux/instantclient/1932000/instantclient-basiclite-linux.x64-19.32.0.0.0dbru.zip -o /tmp/instantclient.zip \
    && echo '16947fc0fa55b861903aad6f9d2ddee7b4fedaf789a175ee36b46b82ec64fcbd  /tmp/instantclient.zip' | sha256sum -c - \
    && unzip -q /tmp/instantclient.zip -d /opt/oracle \
    && echo '/opt/oracle/instantclient_19_32' > /etc/ld.so.conf.d/oracle-instantclient.conf \
    && ldconfig && rm /tmp/instantclient.zip && rm -rf /var/lib/apt/lists/*
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt && pip install --no-cache-dir gunicorn==23.0.0
RUN useradd --create-home app && chown app:app /app
COPY --chown=app:app . .
USER app
EXPOSE 8000
