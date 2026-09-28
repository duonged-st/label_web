FROM tensorflow/tensorflow:2.17.0

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV TF_CPP_MIN_LOG_LEVEL=2

RUN rm -f /etc/apt/sources.list.d/cuda*.list /etc/apt/sources.list.d/nvidia*.list \
    && apt-get update -o Acquire::Retries=5 \
    && apt-get install -y --no-install-recommends gcc libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./

RUN pip install --no-cache-dir --ignore-installed blinker \
    && pip install --no-cache-dir -r requirements.txt

COPY app.py ./

EXPOSE 5001
CMD ["python", "app.py"]
