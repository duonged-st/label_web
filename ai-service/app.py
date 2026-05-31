import gc
import hashlib
import os
import tempfile
import threading
import time
from typing import Any, Dict, List, Optional

from flask import Flask, jsonify, request

try:
    import torch  # type: ignore
except Exception:  # pragma: no cover
    torch = None

try:
    from minio import Minio  # type: ignore
except Exception:  # pragma: no cover
    Minio = None

app = Flask(__name__)

# =========================
# CẤU HÌNH CHÍNH
# =========================
MAX_SLOTS = 3
MODEL_IDLE_SECONDS = 30 * 60  
CLEANUP_INTERVAL_SECONDS = 60
active_models: Dict[str, Dict[str, Any]] = {}
models_lock = threading.RLock()

# =========================
# MINIO (TÙY CHỌN)
# =========================
MINIO_ENDPOINT = os.getenv("MINIO_ENDPOINT", "minio")
MINIO_PORT = int(os.getenv("MINIO_PORT", "9000"))
MINIO_ACCESS_KEY = os.getenv("MINIO_ACCESS_KEY", "admin")
MINIO_SECRET_KEY = os.getenv("MINIO_SECRET_KEY", "admin123")
MINIO_SECURE = os.getenv("MINIO_SECURE", "false").lower() == "true"
MINIO_BUCKET = os.getenv("MINIO_BUCKET", "aimodels")
MINIO_CACHE_DIR = os.getenv("MINIO_CACHE_DIR", os.path.join(tempfile.gettempdir(), "ai-service-model-cache"))

if Minio is not None:
    try:
        minio_client = Minio(
            MINIO_ENDPOINT,
            port=MINIO_PORT,
            access_key=MINIO_ACCESS_KEY,
            secret_key=MINIO_SECRET_KEY,
            secure=MINIO_SECURE,
        )
    except Exception:
        minio_client = None
else:
    minio_client = None

os.makedirs(MINIO_CACHE_DIR, exist_ok=True)


# =========================
# HÀM TIỆN ÍCH
# =========================
def now_ts() -> float:
    return time.time()


def safe_torch_empty_cache() -> None:
    """Nhả bộ nhớ GPU nếu torch/cuda có sẵn."""
    try:
        if torch is not None and hasattr(torch, "cuda") and torch.cuda.is_available():
            torch.cuda.empty_cache()
    except Exception:
        pass


def release_model_memory(model_entry: Dict[str, Any]) -> None:
    """
    Giải phóng hoàn toàn RAM/VRAM:
    - del object model
    - gc.collect()
    - torch.cuda.empty_cache()
    """
    try:
        model_obj = model_entry.get("model_object")
        if model_obj is not None:
            del model_obj
    except Exception:
        pass

    try:
        model_entry["model_object"] = None
    except Exception:
        pass

    try:
        gc.collect()
    except Exception:
        pass

    safe_torch_empty_cache()


def prune_expired_models() -> List[str]:
    """
    Dọn các model:
    - user_count == 0
    - hoặc quá idle 30 phút
    """
    removed_keys: List[str] = []
    current_ts = now_ts()

    with models_lock:
        candidates = list(active_models.items())
        for minio_path, entry in candidates:
            try:
                user_count = int(entry.get("user_count", 0))
                last_used = float(entry.get("last_used", 0))
                is_idle = (current_ts - last_used) >= MODEL_IDLE_SECONDS

                if user_count <= 0 or is_idle:
                    release_model_memory(entry)
                    removed_keys.append(minio_path)
                    active_models.pop(minio_path, None)
            except Exception:
                try:
                    release_model_memory(entry)
                except Exception:
                    pass
                active_models.pop(minio_path, None)
                removed_keys.append(minio_path)

    return removed_keys


def cleanup_worker() -> None:
    """Luồng nền dọn model idle để không giữ RAM/VRAM quá lâu."""
    while True:
        try:
            prune_expired_models()
        except Exception:
            pass
        time.sleep(CLEANUP_INTERVAL_SECONDS)


def ensure_capacity_or_cleanup(target_minio_path: str) -> None:
    """
    Trước khi nạp model mới:
    - dọn model idle/không còn user
    - kiểm tra còn slot hay không
    """
    prune_expired_models()

    with models_lock:
        if target_minio_path in active_models:
            return
        if len(active_models) >= MAX_SLOTS:
            raise RuntimeError("MAX_SLOTS_REACHED")


def download_model_from_minio(minio_path: str) -> str:
    """
    Hàm giả lập tải model từ MinIO.
    Production hook:
    - nếu có minio_client và bucket hợp lệ, tải object về local cache
    - sau đó model loader (YOLO / Torch) sẽ load từ file local đó
    """
    safe_name = hashlib.sha256(minio_path.encode("utf-8")).hexdigest()[:16]
    local_path = os.path.join(MINIO_CACHE_DIR, f"{safe_name}.pt")

    if minio_client is not None:
        try:
            minio_client.stat_object(MINIO_BUCKET, minio_path)
            minio_client.fget_object(MINIO_BUCKET, minio_path, local_path)
            return local_path
        except Exception:
            pass

    try:
        with open(local_path, "wb") as f:
            f.write(b"FAKE_MODEL_CONTENT")
    except Exception:
        pass

    return local_path


def load_model_object(minio_path: str) -> Any:
    """
    Giả lập nạp model vào RAM/VRAM.
    Có thể thay bằng YOLO / PyTorch loader thực tế.
    """
    local_model_path = download_model_from_minio(minio_path)

    # Nếu có torch thì thử tạo tensor/placeholder trên GPU nếu có CUDA,
    # nhưng không bắt buộc để service chạy được.
    model_obj: Dict[str, Any] = {
        "minio_path": minio_path,
        "local_model_path": local_model_path,
        "backend": "fake-yolo",
        "loaded_at": now_ts(),
    }

    # Hook để sau này thay bằng thực tế:
    # from ultralytics import YOLO
    # model_obj = YOLO(local_model_path)
    return model_obj


def get_or_create_model_entry(minio_path: str) -> Dict[str, Any]:
    with models_lock:
        entry = active_models.get(minio_path)
        if entry is not None:
            entry["user_count"] = int(entry.get("user_count", 0)) + 1
            entry["last_used"] = now_ts()
            return entry

    ensure_capacity_or_cleanup(minio_path)

    with models_lock:
        entry = active_models.get(minio_path)
        if entry is not None:
            entry["user_count"] = int(entry.get("user_count", 0)) + 1
            entry["last_used"] = now_ts()
            return entry

        model_object = load_model_object(minio_path)
        new_entry = {
            "model_object": model_object,
            "user_count": 1,
            "last_used": now_ts(),
        }
        active_models[minio_path] = new_entry
        return new_entry


def unload_model(minio_path: str) -> bool:
    with models_lock:
        entry = active_models.get(minio_path)
        if entry is None:
            return False

        current_count = int(entry.get("user_count", 0))
        current_count -= 1
        entry["user_count"] = current_count
        entry["last_used"] = now_ts()

        if current_count <= 0:
            # Khi không còn user nào dùng model này nữa:
            # 1) del object
            # 2) gc.collect()
            # 3) torch.cuda.empty_cache()
            release_model_memory(entry)
            active_models.pop(minio_path, None)

            # Dọn thêm một vòng để nhường slot cho project khác nếu có model idle
            try:
                prune_expired_models()
            except Exception:
                pass

        return True


def simulate_prediction(minio_path: str, image_url: str) -> List[Dict[str, Any]]:
    """Giả lập kết quả AI bounding boxes."""
    seed = int(hashlib.sha256(f"{minio_path}|{image_url}".encode("utf-8")).hexdigest()[:8], 16)
    conf_base = 0.88 + ((seed % 10) / 100.0)
    bbox_x = 10 + (seed % 30)
    bbox_y = 20 + (seed % 25)
    bbox_w = 100 + (seed % 80)
    bbox_h = 200 + (seed % 60)
    return [
        {
            "label": "person",
            "confidence": round(min(conf_base, 0.99), 2),
            "bbox": [bbox_x, bbox_y, bbox_w, bbox_h],
        },
        {
            "label": "car",
            "confidence": 0.76,
            "bbox": [bbox_x + 50, bbox_y + 30, bbox_w + 40, bbox_h + 20],
        },
    ]


# =========================
# API ENDPOINTS
# =========================
@app.route("/load-model", methods=["POST"])
def load_model_api():
    try:
        payload = request.get_json(silent=True) or {}
        minio_path = str(payload.get("minio_path", "")).strip()

        if not minio_path:
            return jsonify({"message": "minio_path is required"}), 400

        try:
            entry = get_or_create_model_entry(minio_path)
        except RuntimeError as exc:
            if str(exc) == "MAX_SLOTS_REACHED":
                return jsonify({
                    "message": "Đã đầy 3 slot model trong RAM. Vui lòng unload model khác trước khi load model mới.",
                    "max_slots": MAX_SLOTS,
                    "active_models": list(active_models.keys()),
                }), 429
            raise

        return jsonify({
            "message": "Model đã sẵn sàng trong RAM/VRAM",
            "minio_path": minio_path,
            "user_count": int(entry.get("user_count", 0)),
            "active_slots": len(active_models),
            "max_slots": MAX_SLOTS,
        }), 200

    except Exception as exc:
        app.logger.exception("Lỗi load-model")
        return jsonify({"message": "Lỗi server khi load model", "error": str(exc)}), 500


@app.route("/unload-model", methods=["POST"])
def unload_model_api():
    try:
        payload = request.get_json(silent=True) or {}
        minio_path = str(payload.get("minio_path", "")).strip()

        if not minio_path:
            return jsonify({"message": "minio_path is required"}), 400

        with models_lock:
            entry = active_models.get(minio_path)
            if entry is None:
                return jsonify({"message": "Model chưa được load"}), 404

        unloaded = unload_model(minio_path)
        if not unloaded:
            return jsonify({"message": "Model chưa được load"}), 404

        return jsonify({
            "message": "Đã unload model thành công",
            "minio_path": minio_path,
            "active_slots": len(active_models),
            "max_slots": MAX_SLOTS,
        }), 200

    except Exception as exc:
        app.logger.exception("Lỗi unload-model")
        return jsonify({"message": "Lỗi server khi unload model", "error": str(exc)}), 500


@app.route("/predict", methods=["POST"])
def predict_api():
    try:
        payload = request.get_json(silent=True) or {}
        minio_path = str(payload.get("minio_path", "")).strip()
        image_url = str(payload.get("image_url", "")).strip()

        if not minio_path or not image_url:
            return jsonify({"message": "minio_path và image_url là bắt buộc"}), 400

        with models_lock:
            entry = active_models.get(minio_path)
            if entry is None:
                return jsonify({
                    "message": "Model chưa được nạp hoặc đã bị dọn khỏi RAM. Vui lòng load lại model.",
                    "minio_path": minio_path,
                }), 409
            entry["last_used"] = now_ts()

        predictions = simulate_prediction(minio_path, image_url)

        return jsonify({
            "message": "Predict thành công",
            "minio_path": minio_path,
            "image_url": image_url,
            "predictions": predictions,
        }), 200

    except Exception as exc:
        app.logger.exception("Lỗi predict")
        return jsonify({"message": "Lỗi server khi predict", "error": str(exc)}), 500


@app.route("/health", methods=["GET"])
def health_api():
    try:
        return jsonify({
            "status": "ok",
            "active_slots": len(active_models),
            "max_slots": MAX_SLOTS,
            "models": list(active_models.keys()),
        }), 200
    except Exception as exc:
        return jsonify({"status": "error", "error": str(exc)}), 500


# =========================
# STARTUP
# =========================
cleanup_thread = threading.Thread(target=cleanup_worker, daemon=True)
cleanup_thread.start()


if __name__ == "__main__":
    # Chạy độc lập trong Docker/microservice
    app.run(host="0.0.0.0", port=5001, debug=False, threaded=True)
