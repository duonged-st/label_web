FROM tensorflow/tensorflow:2.17.0-gpu

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
# Tắt warning TF về GPU allocation (tùy chọn)
ENV TF_CPP_MIN_LOG_LEVEL=2

RUN apt-get update \
    && apt-get install -y --no-install-recommends gcc libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
# blinker 1.4 trong TF base image là distutils package → pip không thể gỡ bình thường
# Phải force-reinstall riêng trước, sau đó cài phần còn lại bình thường
RUN pip install --no-cache-dir --ignore-installed blinker \
    && pip install --no-cache-dir -r requirements.txt

COPY app.py ./

EXPOSE 5001
CMD ["python", "app.py"]
