FROM tensorflow/tensorflow:2.17.0

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV TF_CPP_MIN_LOG_LEVEL=2

RUN rm -f /etc/apt/sources.list.d/cuda*.list /etc/apt/sources.list.d/nvidia*.list \
    && apt-get update -o Acquire::Retries=5 \
    && apt-get install -y --no-install-recommends gcc libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

ENV PIP_DEFAULT_TIMEOUT=120 \
    PIP_RETRIES=10 \
    PIP_RESUME_RETRIES=10 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# Keep downloads outside image layers and reuse them if a build is interrupted.
RUN --mount=type=cache,target=/root/.cache/pip \
    python -m pip install --upgrade "pip>=25.2,<27" \
    && python -m pip install --ignore-installed blinker

# Install the matching CPU wheels from PyTorch's own index first. Lock the
# selected versions so the general dependency resolver cannot replace them
# with CUDA builds while installing Ultralytics.
COPY requirements-cpu.txt ./
RUN --mount=type=cache,target=/root/.cache/pip \
    python -m pip install -r requirements-cpu.txt \
    && python -c "from importlib.metadata import version; from pathlib import Path; Path('torch-cpu-constraints.txt').write_text(''.join(name + '==' + version(name) + '\n' for name in ('torch', 'torchvision')))"

COPY requirements.txt ./
RUN --mount=type=cache,target=/root/.cache/pip \
    python -m pip install -c torch-cpu-constraints.txt -r requirements.txt \
    && python -m pip check \
    && python -c "import tensorflow, torch, torchvision, onnxruntime; from ultralytics import YOLO; assert torch.version.cuda is None, 'Expected CPU-only PyTorch'"

COPY app.py ./

EXPOSE 5001
CMD ["python", "app.py"]
