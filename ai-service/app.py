import gc
import hashlib
import io
import os
import tempfile
import threading
import time
from typing import Any, Dict, List, Optional
import requests as http_requests
from flask import Flask, jsonify, request
from PIL import Image
# ── TensorFlow GPU setup (chạy trước khi import torch/ort) ───────────────────
try:
    import tensorflow as tf  # type: ignore
    # Bật memory growth để TF không chiếm hết VRAM ngay từ đầu
    gpus = tf.config.list_physical_devices('GPU')
    for gpu in gpus:
        try:
            tf.config.experimental.set_memory_growth(gpu, True)
        except RuntimeError:
            pass
    TF_AVAILABLE = True
    TF_GPU_COUNT = len(gpus)
    
    # Patch Keras Layer.__init__ để bỏ qua các tham số không tương thích khi load model từ bản khác
    try:
        import keras  # type: ignore
        original_layer_init = keras.src.layers.Layer.__init__
        def patched_layer_init(self, *args, **kwargs):
            kwargs.pop('quantization_config', None)
            kwargs.pop('value_range', None)
            kwargs.pop('data_format', None)
            original_layer_init(self, *args, **kwargs)
        keras.src.layers.Layer.__init__ = patched_layer_init
    except Exception:
        pass
except Exception:
    tf = None
    TF_AVAILABLE = False
    TF_GPU_COUNT = 0

# ── Optional imports ──────────────────────────────────────────────────────────
try:
    from ultralytics import YOLO  # type: ignore
    YOLO_AVAILABLE = True
except Exception:
    YOLO = None
    YOLO_AVAILABLE = False

try:
    import torch  # type: ignore
    TORCH_AVAILABLE = True
except Exception:
    torch = None
    TORCH_AVAILABLE = False

try:
    import onnxruntime as ort  # type: ignore
    ORT_AVAILABLE = True
except Exception:
    ort = None
    ORT_AVAILABLE = False

try:
    import numpy as np  # type: ignore
    NUMPY_AVAILABLE = True
except Exception:
    np = None
    NUMPY_AVAILABLE = False

try:
    from minio import Minio  # type: ignore
except Exception:
    Minio = None

# ── GPU info (log lúc startup) ────────────────────────────────────────────────
def _gpu_info() -> Dict:
    info = {"tf_gpus": TF_GPU_COUNT, "cuda_available": False, "ort_gpu": False}
    if TORCH_AVAILABLE and torch is not None:
        info["cuda_available"] = torch.cuda.is_available()
        if torch.cuda.is_available():
            info["cuda_device"] = torch.cuda.get_device_name(0)
    if ORT_AVAILABLE and ort is not None:
        info["ort_gpu"] = "CUDAExecutionProvider" in ort.get_available_providers()
    return info

app = Flask(__name__)

# ── Cấu hình ──────────────────────────────────────────────────────────────────
MAX_SLOTS = 3
MODEL_IDLE_SECONDS = 30 * 60
CLEANUP_INTERVAL_SECONDS = 60
active_models: Dict[str, Dict[str, Any]] = {}
models_lock = threading.RLock()

MINIO_ENDPOINT  = os.getenv("MINIO_ENDPOINT",  "minio")
MINIO_PORT      = int(os.getenv("MINIO_PORT",  "9000"))
MINIO_ACCESS_KEY= os.getenv("MINIO_ACCESS_KEY","admin")
MINIO_SECRET_KEY= os.getenv("MINIO_SECRET_KEY","admin123")
MINIO_SECURE    = os.getenv("MINIO_SECURE","false").lower() == "true"
MINIO_BUCKET    = os.getenv("MINIO_BUCKET", "aimodels")
MINIO_CACHE_DIR = os.getenv(
    "MINIO_CACHE_DIR",
    os.path.join(tempfile.gettempdir(), "ai-service-model-cache"),
)

if Minio is not None:
    try:
        # Minio SDK v7.2+ không còn nhận 'port' riêng — phải dùng "host:port"
        _minio_endpoint_str = f"{MINIO_ENDPOINT}:{MINIO_PORT}"
        minio_client = Minio(
            _minio_endpoint_str,
            access_key=MINIO_ACCESS_KEY,
            secret_key=MINIO_SECRET_KEY,
            secure=MINIO_SECURE,
        )
        # Kiểm tra kết nối thực sự bằng cách list buckets
        minio_client.list_buckets()
        print(f"[MinIO] Kết nối OK: {_minio_endpoint_str}", flush=True)
    except Exception as _e:
        print(f"[MinIO] Lỗi kết nối ({_minio_endpoint_str}): {_e}", flush=True)
        minio_client = None
else:
    minio_client = None

os.makedirs(MINIO_CACHE_DIR, exist_ok=True)


# ── ModelWrapper ──────────────────────────────────────────────────────────────
class ModelWrapper:
    """
    Bọc model từ bất kỳ backend nào vào một giao diện thống nhất.
    backend: 'yolo' | 'onnx' | 'torch' | 'keras' | 'sklearn' | 'unsupported'
    """

    # Preprocessing chuẩn ImageNet (dùng cho ONNX / torch thuần)
    IMAGENET_MEAN = [0.485, 0.456, 0.406]
    IMAGENET_STD  = [0.229, 0.224, 0.225]

    def __init__(self, backend: str, model_obj: Any, names: Dict[int, str] = None):
        self.backend    = backend
        self.model_obj  = model_obj
        self.names      = names or {}   # {0: "cat", 1: "dog", ...}

    # ── Dự đoán công khai ─────────────────────────────────────────────────────
    def predict(
        self,
        pil_image: Image.Image,
        class_names: Optional[List[str]] = None,
    ) -> List[Dict[str, Any]]:
        """
        Chạy inference và trả về [{label, confidence, bbox?}].
        class_names: danh sách nhãn từ project — dùng để map index → tên
                     khi model không có tên nhúng sẵn (ONNX, torch thuần, ...).
        """
        if self.backend == "yolo":
            return self._predict_yolo(pil_image)
        if self.backend == "onnx":
            return self._predict_onnx(pil_image, class_names)
        if self.backend == "torch":
            return self._predict_torch(pil_image, class_names)
        if self.backend == "keras":
            return self._predict_keras(pil_image, class_names)
        if self.backend == "sklearn":
            raise RuntimeError(
                "Model scikit-learn không hỗ trợ inference ảnh trực tiếp. "
                "Hãy chuyển sang ONNX (.onnx) để dùng với ảnh."
            )
        raise RuntimeError(f"Backend '{self.backend}' chưa được hỗ trợ.")

    # ── YOLO (ultralytics) ────────────────────────────────────────────────────
    def _predict_yolo(self, pil_image: Image.Image) -> List[Dict]:
        results = self.model_obj(pil_image, verbose=False)
        predictions: List[Dict] = []

        for result in results:
            # ── Chế độ classification (yolov8-cls) ──────────────────────────
            if hasattr(result, "probs") and result.probs is not None:
                probs = result.probs
                for idx in probs.top5:
                    label = self.model_obj.names.get(idx, str(idx))
                    confidence = round(float(probs.data[idx].item()), 4)
                    if confidence > 0.01:
                        predictions.append({"label": label, "confidence": confidence})

            # ── Chế độ detection (yolov8n / yolov8s ...) ────────────────────
            elif hasattr(result, "boxes") and result.boxes is not None:
                # Gộp theo class, lấy confidence cao nhất mỗi class
                best_per_class: Dict[str, float] = {}
                for box in result.boxes:
                    cls_id    = int(box.cls[0].item())
                    label     = self.model_obj.names.get(cls_id, str(cls_id))
                    confidence= round(float(box.conf[0].item()), 4)
                    xyxy      = [round(v, 2) for v in box.xyxy[0].tolist()]
                    if confidence > best_per_class.get(label, 0):
                        best_per_class[label] = confidence
                        predictions = [p for p in predictions if p["label"] != label]
                        predictions.append({
                            "label": label,
                            "confidence": confidence,
                            "bbox": xyxy,
                        })

        predictions.sort(key=lambda p: p["confidence"], reverse=True)
        return predictions

    # ── ONNX ──────────────────────────────────────────────────────────────────
    def _predict_onnx(
        self,
        pil_image: Image.Image,
        class_names: Optional[List[str]] = None,
    ) -> List[Dict]:
        if not ORT_AVAILABLE or np is None:
            raise RuntimeError("onnxruntime hoặc numpy chưa được cài đặt.")

        session: "ort.InferenceSession" = self.model_obj
        input_info = session.get_inputs()[0]

        # Đọc kích thước đầu vào từ model metadata
        shape = input_info.shape
        h = shape[2] if (isinstance(shape, (list, tuple)) and len(shape) >= 4
                         and isinstance(shape[2], int) and shape[2] > 0) else 224
        w = shape[3] if (isinstance(shape, (list, tuple)) and len(shape) >= 4
                         and isinstance(shape[3], int) and shape[3] > 0) else 224

        img = pil_image.resize((w, h))
        arr = np.array(img, dtype=np.float32) / 255.0
        mean = np.array(self.IMAGENET_MEAN, dtype=np.float32)
        std  = np.array(self.IMAGENET_STD,  dtype=np.float32)
        arr  = (arr - mean) / std
        arr  = arr.transpose(2, 0, 1)[np.newaxis, ...]

        outputs = session.run(None, {input_info.name: arr})
        logits  = outputs[0][0]

        # Softmax
        e = np.exp(logits - logits.max())
        probs = e / e.sum()

        names = self._resolve_names(probs.shape[0], class_names)

        # Top-k (tất cả có prob > 1%)
        top_indices = np.argsort(probs)[::-1]
        predictions = []
        for idx in top_indices:
            conf = round(float(probs[idx]), 4)
            if conf < 0.01:
                break
            label = names.get(int(idx), f"class_{idx}")
            predictions.append({"label": label, "confidence": conf})
        return predictions

    def _predict_torch(
        self,
        pil_image: Image.Image,
        class_names: Optional[List[str]] = None,
    ) -> List[Dict]:
        if not TORCH_AVAILABLE or np is None:
            raise RuntimeError("torch chưa được cài đặt.")

        model = self.model_obj
        model.eval()

        img = pil_image.resize((224, 224))
        arr = np.array(img, dtype=np.float32) / 255.0
        mean = np.array(self.IMAGENET_MEAN, dtype=np.float32)
        std  = np.array(self.IMAGENET_STD,  dtype=np.float32)
        arr  = (arr - mean) / std
        tensor = torch.tensor(arr.transpose(2, 0, 1)).unsqueeze(0)

        with torch.no_grad():
            out = model(tensor)

        # out có thể là tensor [1, num_classes] hoặc tuple
        if isinstance(out, (tuple, list)):
            out = out[0]
        logits = out[0].cpu().numpy()

        e = np.exp(logits - logits.max())
        probs = e / e.sum()

        names = self._resolve_names(probs.shape[0], class_names)
        top_indices = np.argsort(probs)[::-1]
        predictions = []
        for idx in top_indices:
            conf = round(float(probs[idx]), 4)
            if conf < 0.01:
                break
            label = names.get(int(idx), f"class_{idx}")
            predictions.append({"label": label, "confidence": conf})
        return predictions

    # ── Keras / TensorFlow ────────────────────────────────────────────────────
    def _predict_keras(
        self,
        pil_image: Image.Image,
        class_names: Optional[List[str]] = None,
    ) -> List[Dict]:
        try:
            import numpy as _np  # type: ignore
        except ImportError:
            raise RuntimeError("numpy chưa được cài đặt.")

        model = self.model_obj

        # Lấy input shape từ model
        try:
            _, h, w, _ = model.input_shape
            if not (isinstance(h, int) and h > 0): h = 224
            if not (isinstance(w, int) and w > 0): w = 224
        except Exception:
            h, w = 224, 224

        img = pil_image.resize((w, h))
        arr = _np.array(img, dtype=_np.float32) / 255.0
        arr = arr[_np.newaxis, ...]

        probs = model.predict(arr, verbose=0)[0]

        names = self._resolve_names(probs.shape[0], class_names)
        top_indices = _np.argsort(probs)[::-1]
        predictions = []
        for idx in top_indices:
            conf = round(float(probs[idx]), 4)
            if conf < 0.01:
                break
            label = names.get(int(idx), f"class_{idx}")
            predictions.append({"label": label, "confidence": conf})
        return predictions

    # ── Helpers ───────────────────────────────────────────────────────────────
    def _resolve_names(
        self, num_classes: int, class_names: Optional[List[str]]
    ) -> Dict[int, str]:
        """
        Ưu tiên: model.names → class_names từ project → fallback class_N.
        """
        if self.names:
            return self.names
        if class_names:
            return {i: n for i, n in enumerate(class_names)}
        return {}


# ── Loader ────────────────────────────────────────────────────────────────────
def _ext(path: str) -> str:
    return os.path.splitext(path)[1].lower()


def _load_yolo(path: str) -> ModelWrapper:
    if not YOLO_AVAILABLE:
        raise RuntimeError("ultralytics chưa được cài đặt.")
    model = YOLO(path)
    names = model.names if hasattr(model, "names") else {}
    app.logger.info(f"[YOLO] Nạp thành công. Classes: {names}")
    return ModelWrapper("yolo", model, names)


def _load_onnx(path: str) -> ModelWrapper:
    if not ORT_AVAILABLE:
        raise RuntimeError("onnxruntime chưa được cài đặt.")
    # Ưu tiên CUDA, fallback CPU
    available = ort.get_available_providers()
    providers  = (["CUDAExecutionProvider", "CPUExecutionProvider"]
                  if "CUDAExecutionProvider" in available
                  else ["CPUExecutionProvider"])
    session = ort.InferenceSession(path, providers=providers)
    used = session.get_providers()[0]
    app.logger.info(f"[ONNX] Nạp thành công. Provider: {used}. Inputs: {[i.name for i in session.get_inputs()]}")
    return ModelWrapper("onnx", session)


def _load_torch(path: str) -> ModelWrapper:
    if not TORCH_AVAILABLE:
        raise RuntimeError("torch chưa được cài đặt.")
    
    # Thử nạp dưới dạng TorchScript trước
    try:
        model = torch.jit.load(path, map_location="cpu")
        app.logger.info(f"[TorchScript] Nạp thành công: {type(model).__name__}")
        return ModelWrapper("torch", model)
    except Exception:
        pass

    # Nạp PyTorch thông thường
    obj = torch.load(path, map_location="cpu", weights_only=False)
    # torch.load có thể trả về model hoặc state_dict
    if isinstance(obj, dict):
        raise RuntimeError(
            "File .pt này chứa state_dict (chỉ có trọng số), không phải full model. "
            "Hãy export model sang định dạng .onnx (khuyên dùng) hoặc save bằng TorchScript (torch.jit.save)."
        )
    app.logger.info(f"[Torch] Nạp thành công: {type(obj).__name__}")
    return ModelWrapper("torch", obj)


def _load_keras(path: str) -> ModelWrapper:
    if not TF_AVAILABLE or tf is None:
        raise RuntimeError(
            "TensorFlow chưa khả dụng. "
            "Đảm bảo dùng base image tensorflow/tensorflow:* và cài đúng requirements."
        )
    
    custom_objects = {}
    try:
        # Hỗ trợ chức năng tiền xử lý chuẩn của ImageNet / ResNet
        custom_objects['preprocess_input'] = tf.keras.applications.imagenet_utils.preprocess_input
    except Exception:
        pass

    try:
        # Load model không compile (để tránh lỗi custom loss/metric) và dùng custom objects
        model = tf.keras.models.load_model(path, custom_objects=custom_objects, compile=False)
    except Exception as e:
        try:
            # Thử lại với safe_mode=False nếu cần thiết
            model = tf.keras.models.load_model(path, custom_objects=custom_objects, compile=False, safe_mode=False)
        except Exception:
            raise e

    gpu_list = tf.config.list_physical_devices('GPU')
    app.logger.info(f"[Keras/TF] Nạp thành công. TF GPUs: {[g.name for g in gpu_list]}")
    return ModelWrapper("keras", model)


def _load_sklearn(path: str) -> ModelWrapper:
    try:
        import joblib  # type: ignore
    except ImportError:
        import pickle as joblib  # type: ignore  # noqa: PLC0415
    obj = joblib.load(path)
    app.logger.info(f"[sklearn] Nạp thành công: {type(obj).__name__}")
    return ModelWrapper("sklearn", obj)


# Bảng quyết định: extension → danh sách loader thử lần lượt
LOADER_MAP: Dict[str, List] = {
    ".pt":          [_load_yolo, _load_torch],
    ".pth":         [_load_yolo, _load_torch],
    ".onnx":        [_load_onnx],
    ".h5":          [_load_keras],
    ".keras":       [_load_keras],
    ".pkl":         [_load_sklearn],
    ".joblib":      [_load_sklearn],
    ".safetensors": [_load_torch],   # HF safetensors → torch.load hoặc tương lai
    ".bin":         [_load_torch],
    ".npy":         [],              # không dùng cho inference ảnh
}


def load_model_object(minio_path: str) -> ModelWrapper:
    local_path = _download(minio_path)
    ext        = _ext(local_path)
    loaders    = LOADER_MAP.get(ext, [_load_yolo, _load_torch])

    if not loaders:
        raise RuntimeError(f"Định dạng '{ext}' không hỗ trợ inference ảnh.")

    # Tìm file companion JSON chứa nhãn (labels)
    names = {}
    json_minio_path = os.path.splitext(minio_path)[0] + ".json"
    try:
        json_local_path = os.path.splitext(local_path)[0] + ".json"
        # Thử tải từ MinIO nếu chưa có ở local cache
        if not os.path.exists(json_local_path) and minio_client is not None:
            try:
                minio_client.stat_object(MINIO_BUCKET, json_minio_path)
                minio_client.fget_object(MINIO_BUCKET, json_minio_path, json_local_path)
            except Exception:
                pass
        
        # Đọc file nhãn nếu tồn tại ở local cache
        if os.path.exists(json_local_path):
            with open(json_local_path, "r", encoding="utf-8") as f:
                import json
                raw_names = json.load(f)
                names = {int(k): str(v) for k, v in raw_names.items()}
                app.logger.info(f"[Labels] Đã nạp file nhãn bổ trợ: {names}")
    except Exception as label_err:
        app.logger.warning(f"[Labels] Không thể load file nhãn bổ trợ: {label_err}")

    last_err: Exception = RuntimeError("Không có loader phù hợp.")
    for loader_fn in loaders:
        try:
            wrapper = loader_fn(local_path)
            if names:
                wrapper.names = names
            return wrapper
        except Exception as e:
            app.logger.warning(f"[Loader] {loader_fn.__name__} thất bại: {e}")
            last_err = e

    raise RuntimeError(
        f"Không thể nạp model '{minio_path}' với định dạng '{ext}'. "
        f"Lỗi cuối: {last_err}"
    )


# ── MinIO download ─────────────────────────────────────────────────────────────
def _download(minio_path: str) -> str:
    safe_hash    = hashlib.sha256(minio_path.encode()).hexdigest()[:16]
    original_name= minio_path.split("-", 5)[-1] if "-" in minio_path else minio_path
    local_path   = os.path.join(MINIO_CACHE_DIR, f"{safe_hash}_{original_name}")

    if os.path.exists(local_path) and os.path.getsize(local_path) > 0:
        app.logger.info(f"[MinIO] Dùng cache: {local_path}")
        return local_path

    if minio_client is None:
        raise RuntimeError("Không có kết nối MinIO và không có cache local.")

    try:
        minio_client.stat_object(MINIO_BUCKET, minio_path)
        minio_client.fget_object(MINIO_BUCKET, minio_path, local_path)
        app.logger.info(f"[MinIO] Đã tải: {minio_path} → {local_path}")
        return local_path
    except Exception as e:
        raise RuntimeError(f"Không thể tải model từ MinIO: {e}")


# ── Memory management ─────────────────────────────────────────────────────────
def now_ts() -> float:
    return time.time()


def _safe_cuda_empty():
    try:
        if torch is not None and hasattr(torch, "cuda") and torch.cuda.is_available():
            torch.cuda.empty_cache()
    except Exception:
        pass


def _release(entry: Dict):
    try:
        del entry["model_object"]
    except Exception:
        pass
    entry["model_object"] = None
    gc.collect()
    _safe_cuda_empty()


def prune_expired_models() -> List[str]:
    removed: List[str] = []
    now = now_ts()
    with models_lock:
        for path, entry in list(active_models.items()):
            try:
                idle = (now - float(entry.get("last_used", 0))) >= MODEL_IDLE_SECONDS
                if int(entry.get("user_count", 0)) <= 0 or idle:
                    _release(entry)
                    active_models.pop(path, None)
                    removed.append(path)
            except Exception:
                active_models.pop(path, None)
                removed.append(path)
    return removed


def _cleanup_worker():
    while True:
        try:
            prune_expired_models()
        except Exception:
            pass
        time.sleep(CLEANUP_INTERVAL_SECONDS)


def get_or_create_entry(minio_path: str) -> Dict:
    with models_lock:
        e = active_models.get(minio_path)
        if e:
            e["user_count"] = int(e.get("user_count", 0)) + 1
            e["last_used"]  = now_ts()
            return e

    prune_expired_models()

    with models_lock:
        e = active_models.get(minio_path)
        if e:
            e["user_count"] = int(e.get("user_count", 0)) + 1
            e["last_used"]  = now_ts()
            return e

        if len(active_models) >= MAX_SLOTS:
            raise RuntimeError("MAX_SLOTS_REACHED")

        wrapper = load_model_object(minio_path)
        new_entry = {"model_object": wrapper, "user_count": 1, "last_used": now_ts()}
        active_models[minio_path] = new_entry
        return new_entry


def unload_model(minio_path: str) -> bool:
    with models_lock:
        e = active_models.get(minio_path)
        if e is None:
            return False
        e["user_count"] = int(e.get("user_count", 0)) - 1
        e["last_used"]  = now_ts()
        if e["user_count"] <= 0:
            _release(e)
            active_models.pop(minio_path, None)
    return True


# ── Image fetching ────────────────────────────────────────────────────────────
def _fetch_image(image_url: str) -> Image.Image:
    if "/minio-storage/" in image_url:
        image_url = image_url.replace(
            "/minio-storage/",
            f"http://{MINIO_ENDPOINT}:{MINIO_PORT}/",
        )
    resp = http_requests.get(image_url, timeout=15)
    resp.raise_for_status()
    return Image.open(io.BytesIO(resp.content)).convert("RGB")


# ── API ───────────────────────────────────────────────────────────────────────
@app.route("/load-model", methods=["POST"])
def load_model_api():
    try:
        payload     = request.get_json(silent=True) or {}
        minio_path  = str(payload.get("minio_path", "")).strip()
        if not minio_path:
            return jsonify({"message": "minio_path is required"}), 400

        try:
            entry = get_or_create_entry(minio_path)
        except RuntimeError as exc:
            msg = str(exc)
            if msg == "MAX_SLOTS_REACHED":
                return jsonify({
                    "message": "Đã đầy 3 slot model trong RAM. Vui lòng unload model khác trước.",
                    "max_slots": MAX_SLOTS,
                    "active_models": list(active_models.keys()),
                }), 429
            app.logger.exception("load-model error")
            return jsonify({"message": msg}), 500

        wrapper: ModelWrapper = entry["model_object"]
        return jsonify({
            "message":      "Model đã sẵn sàng",
            "minio_path":   minio_path,
            "backend":      wrapper.backend,
            "model_classes":list(wrapper.names.values()),
            "user_count":   entry["user_count"],
            "active_slots": len(active_models),
            "max_slots":    MAX_SLOTS,
        }), 200

    except Exception as exc:
        app.logger.exception("load-model error")
        return jsonify({"message": str(exc)}), 500


@app.route("/unload-model", methods=["POST"])
def unload_model_api():
    try:
        payload    = request.get_json(silent=True) or {}
        minio_path = str(payload.get("minio_path", "")).strip()
        if not minio_path:
            return jsonify({"message": "minio_path is required"}), 400

        with models_lock:
            if active_models.get(minio_path) is None:
                return jsonify({"message": "Model chưa được load"}), 404

        unload_model(minio_path)
        return jsonify({
            "message":      "Đã unload model thành công",
            "minio_path":   minio_path,
            "active_slots": len(active_models),
        }), 200

    except Exception as exc:
        app.logger.exception("unload-model error")
        return jsonify({"message": str(exc)}), 500


@app.route("/predict", methods=["POST"])
def predict_api():
    try:
        payload     = request.get_json(silent=True) or {}
        minio_path  = str(payload.get("minio_path", "")).strip()
        image_url   = str(payload.get("image_url", "")).strip()
        # class_names truyền từ project (dùng cho model không có tên nhúng sẵn)
        class_names: Optional[List[str]] = payload.get("class_names") or None
        if isinstance(class_names, list):
            class_names = [str(c) for c in class_names if c]

        if not minio_path or not image_url:
            return jsonify({"message": "minio_path và image_url là bắt buộc"}), 400

        with models_lock:
            entry = active_models.get(minio_path)
            if entry is None:
                return jsonify({
                    "message": "Model chưa được nạp. Vui lòng load lại model.",
                    "minio_path": minio_path,
                }), 409
            entry["last_used"] = now_ts()
            wrapper: ModelWrapper = entry["model_object"]

        pil_image   = _fetch_image(image_url)
        predictions = wrapper.predict(pil_image, class_names=class_names)

        return jsonify({
            "message":     "Predict thành công",
            "backend":     wrapper.backend,
            "minio_path":  minio_path,
            "image_url":   image_url,
            "predictions": predictions,
        }), 200

    except Exception as exc:
        app.logger.exception("predict error")
        return jsonify({"message": str(exc)}), 500


@app.route("/health", methods=["GET"])
def health_api():
    try:
        models_info = {}
        with models_lock:
            for path, entry in active_models.items():
                w: ModelWrapper = entry.get("model_object")
                models_info[path] = {
                    "backend":    w.backend if w else "?",
                    "classes":    list(w.names.values()) if w else [],
                    "user_count": entry.get("user_count", 0),
                }
        return jsonify({
            "status":          "ok",
            "gpu":             _gpu_info(),
            "tf_available":    TF_AVAILABLE,
            "yolo_available":  YOLO_AVAILABLE,
            "ort_available":   ORT_AVAILABLE,
            "torch_available": TORCH_AVAILABLE,
            "active_slots":    len(active_models),
            "max_slots":       MAX_SLOTS,
            "models":          models_info,
        }), 200
    except Exception as exc:
        return jsonify({"status": "error", "error": str(exc)}), 500


# ── Startup ───────────────────────────────────────────────────────────────────
threading.Thread(target=_cleanup_worker, daemon=True).start()

if __name__ == "__main__":
    import logging
    logging.basicConfig(level=logging.INFO)
    _logger = logging.getLogger(__name__)
    _logger.info(f"[Startup] GPU info: {_gpu_info()}")
    _logger.info(f"[Startup] TF={TF_AVAILABLE}({TF_GPU_COUNT} GPU) | "
                 f"YOLO={YOLO_AVAILABLE} | ORT={ORT_AVAILABLE} | Torch={TORCH_AVAILABLE}")
    app.run(host="0.0.0.0", port=5001, debug=False, threaded=True)
