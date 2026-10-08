FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app.py etf_com.py ./
# Reachable from the other containers on the compose network, never published to the host
ENV HOST=0.0.0.0 PORT=3101
USER nobody
EXPOSE 3101
CMD ["python", "app.py"]
