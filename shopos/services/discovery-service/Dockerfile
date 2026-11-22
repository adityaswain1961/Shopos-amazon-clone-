FROM python:3.11-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PYTHONPATH=/app/src
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt && useradd -r -u 1001 app
COPY src ./src
# numeric uid: Kubernetes runAsNonRoot cannot verify a named user
USER 1001
EXPOSE 3010
# One worker per CPU you give the pod; scale out with more pods.
ENV WEB_CONCURRENCY=2
CMD ["sh", "-c", "exec uvicorn main:app --host 0.0.0.0 --port ${PORT:-3010} --app-dir src --workers ${WEB_CONCURRENCY} --no-access-log --timeout-graceful-shutdown 20"]
