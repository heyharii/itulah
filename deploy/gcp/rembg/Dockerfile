# Background removal for catalogue photographs (see app.py).
FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 U2NET_HOME=/models
RUN pip install --no-cache-dir "rembg[cpu]==2.0.*" fastapi "uvicorn[standard]" python-multipart pillow
# The model is baked in: a cold start loads it from disk, it does not download it.
RUN python -c "from rembg import new_session; new_session('u2net')"
WORKDIR /app
COPY app.py .
ENV PORT=8080
CMD ["sh", "-c", "exec uvicorn app:app --host 0.0.0.0 --port ${PORT}"]
