FROM tensorflow/tensorflow:2.17.0

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV TF_CPP_MIN_LOG_LEVEL=2

RUN apt-get update \
    && apt-get install -y --no-install-recommends gcc libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
# blinker 1.4 trong TF base image la distutils package, pip khong the go binh thuong.
# Force-reinstall rieng truoc, sau do cai phan con lai binh thuong.
RUN pip install --no-cache-dir --ignore-installed blinker \
    && pip install --no-cache-dir -r requirements.txt

COPY app.py ./

EXPOSE 5001
CMD ["python", "app.py"]
